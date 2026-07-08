package com.frtbarabanki.frt_calling

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.telephony.TelephonyManager
import org.json.JSONObject

class IncomingCallReceiver : BroadcastReceiver() {
    companion object {
        var activeDataId: String? = null
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != TelephonyManager.ACTION_PHONE_STATE_CHANGED) return

        val state = intent.getStringExtra(TelephonyManager.EXTRA_STATE)
        val incomingNumber = intent.getStringExtra(TelephonyManager.EXTRA_INCOMING_NUMBER)

        if (state == TelephonyManager.EXTRA_STATE_RINGING && incomingNumber != null) {
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
                    activeDataId = infoObj.optString("dataid", null)
                } catch (e: Exception) {
                    activeDataId = null
                }
                // Match found or default created, start the overlay service
                IncomingCallService.start(context, info)
            } catch (e: Exception) {
                // Ignore parsing errors
            }
        } else if (state == TelephonyManager.EXTRA_STATE_IDLE) {
            // Call answered or missed/rejected, stop the overlay and launch app
            IncomingCallService.stop(context, activeDataId)
            activeDataId = null
        }
    }
}
