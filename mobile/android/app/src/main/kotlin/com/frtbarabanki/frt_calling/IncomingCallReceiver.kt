package com.frtbarabanki.frt_calling

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.telephony.TelephonyManager
import org.json.JSONObject

class IncomingCallReceiver : BroadcastReceiver() {
    companion object {
        // Guard: only handle IDLE if we actually saw a RINGING event first.
        // Without this, every outgoing call's IDLE also triggers the receiver
        // and launches the app with no tracking context → "fake" blank log entry.
        // We use a counter instead of a boolean so concurrent calls don't prematurely
        // block subsequent IDLE events.
        private var ringingCount = 0

        // OFFHOOK seen while an incoming call was ringing = it was answered.
        // Without this a missed/declined call would open the log form with a
        // misleading "Connected" default.
        private var sawOffhook = false

        // Wall-clock of the first OFFHOOK (pickup) while ringing. For an incoming
        // call OFFHOOK→IDLE is exactly the talk time (there is no dial/ring phase
        // once answered), so (IDLE − OFFHOOK) is the conversation duration the
        // report screen shows. 0 = not answered yet. With concurrent calls (call
        // waiting) this is an approximation, shared across the batch — same
        // caveat the `sawOffhook` flag already carries.
        private var offhookAtMs = 0L

        // Stack of dataids for currently ringing/active incoming calls.
        // Uses a list so that back-to-back concurrent calls (call waiting)
        // don't overwrite each other.
        private val activeDataIds = java.util.ArrayDeque<String>()
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != TelephonyManager.ACTION_PHONE_STATE_CHANGED) return

        val state = intent.getStringExtra(TelephonyManager.EXTRA_STATE)
        val incomingNumber = intent.getStringExtra(TelephonyManager.EXTRA_INCOMING_NUMBER)

        if (state == TelephonyManager.EXTRA_STATE_RINGING && incomingNumber != null) {
            val cleanNumber = incomingNumber.replace(Regex("\\D"), "")
            // Increment only after the number checks pass: for a skipped ring the
            // service is never started either, so the later IDLE must not try to
            // stop a service that doesn't exist (startForegroundService on a dead
            // service risks a RemoteServiceException).
            if (cleanNumber.isEmpty()) return
            ringingCount++
            val key = if (cleanNumber.length > 10) cleanNumber.substring(cleanNumber.length - 10) else cleanNumber

            val prefs = context.getSharedPreferences("FlutterSharedPreferences", Context.MODE_PRIVATE)
            val mapJson = prefs.getString("flutter.caller_id_map", "{}") ?: "{}"

            try {
                val map = JSONObject(mapJson)
                val info = if (map.has(key)) {
                    map.getString(key)
                } else {
                    val defaultObj = JSONObject()
                    defaultObj.put("consumer_name", "Unknown Consumer")
                    defaultObj.put("remarks", "inki complaint last 1 month main nhi mili")
                    defaultObj.put("total_complaints", 0)
                    defaultObj.toString()
                }

                try {
                    val infoObj = JSONObject(info)
                    // optString can return the literal string "null" when the JSON
                    // value is a JSON null — guard against that with takeIf.
                    val parsedDataId = infoObj.optString("dataid", "")
                        .takeIf { it.isNotEmpty() && it != "null" }
                    if (parsedDataId != null) {
                        activeDataIds.addLast(parsedDataId)
                    }
                } catch (e: Exception) {
                    // Ignore
                }
                // Match found or default created, start the overlay service
                IncomingCallService.start(context, info)
            } catch (e: Exception) {
                // Ignore parsing errors
            }

        } else if (state == TelephonyManager.EXTRA_STATE_OFFHOOK) {
            // Only meaningful while an incoming call is ringing; OFFHOOK from a
            // plain outgoing call (no ring first) is ignored.
            if (ringingCount > 0) {
                sawOffhook = true
                if (offhookAtMs == 0L) offhookAtMs = System.currentTimeMillis()
            }

        } else if (state == TelephonyManager.EXTRA_STATE_IDLE) {
            // Only handle IDLE if we saw RINGING — this prevents outgoing-call
            // IDLE events from incorrectly launching the app with a blank form.
            if (ringingCount <= 0) return
            ringingCount--

            // Was this call answered? With concurrent calls (call waiting) this
            // is an approximation — the flag is shared across the batch.
            val answered = sawOffhook
            // Talk time = OFFHOOK→IDLE. Only meaningful when answered; a missed
            // call (no OFFHOOK) has no talk time, so send 0.
            val durationSeconds = if (answered && offhookAtMs > 0L) {
                ((System.currentTimeMillis() - offhookAtMs) / 1000L).toInt().coerceAtLeast(0)
            } else {
                0
            }
            if (ringingCount == 0) {
                sawOffhook = false
                offhookAtMs = 0L
            }

            // Pop the most recent call's dataid from the stack
            val dataId = if (activeDataIds.isNotEmpty()) activeDataIds.removeLast() else null

            // Enqueue BEFORE stopping so the value is guaranteed on disk by the
            // time Flutter's _checkPendingIncomingCall() runs on resume.
            if (dataId != null) {
                PendingCallQueue.enqueue(context, dataId, answered, durationSeconds)
            }

            // Stop the overlay bubble and, if we have a known consumer to log,
            // bring the app to the foreground.
            IncomingCallService.stop(context, launchApp = dataId != null)
        }
    }
}
