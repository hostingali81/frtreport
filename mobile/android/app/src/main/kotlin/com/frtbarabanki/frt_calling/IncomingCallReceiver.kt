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
                if (map.has(key)) {
                    val info = map.getString(key)
                    try {
                        val infoObj = JSONObject(info)
                        activeDataId = infoObj.optString("dataid", null)
                    } catch (e: Exception) {
                        activeDataId = null
                    }
                    // Match found, start the overlay service
                    IncomingCallService.start(context, info)
                }
            } catch (e: Exception) {
                // Ignore parsing errors
            }
        } else if (state == TelephonyManager.EXTRA_STATE_IDLE || state == TelephonyManager.EXTRA_STATE_OFFHOOK) {
            // Call answered or missed/rejected, stop the overlay
            IncomingCallService.stop(context)

            if (state == TelephonyManager.EXTRA_STATE_IDLE && activeDataId != null) {
                // Call ended, save to SharedPreferences for Flutter to pick up
                val prefs = context.getSharedPreferences("FlutterSharedPreferences", Context.MODE_PRIVATE)
                prefs.edit().putString("flutter.pending_incoming_call_dataid", activeDataId).apply()
                
                // Launch the app
                val launchIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)
                if (launchIntent != null) {
                    launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                    context.startActivity(launchIntent)
                }
                activeDataId = null
            }
        }
    }
}
