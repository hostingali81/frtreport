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
            ringingCount++
            val cleanNumber = incomingNumber.replace(Regex("\\D"), "")
            if (cleanNumber.isEmpty()) return
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

        } else if (state == TelephonyManager.EXTRA_STATE_IDLE) {
            // Only handle IDLE if we saw RINGING — this prevents outgoing-call
            // IDLE events from incorrectly launching the app with a blank form.
            if (ringingCount <= 0) return
            ringingCount--

            // Pop the most recent call's dataid from the stack
            val dataId = if (activeDataIds.isNotEmpty()) activeDataIds.removeLast() else null

            // Enqueue BEFORE stopping so the value is guaranteed on disk by the
            // time Flutter's _checkPendingIncomingCall() runs on resume.
            if (dataId != null) {
                PendingCallQueue.enqueue(context, dataId)
            }

            // Stop the overlay bubble and, if we have a known consumer to log,
            // bring the app to the foreground.
            IncomingCallService.stop(context, launchApp = dataId != null)
        }
    }
}
