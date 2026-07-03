package com.frtbarabanki.frt_calling

import android.content.Context
import android.os.Build
import android.telephony.PhoneStateListener
import android.telephony.TelephonyCallback
import android.telephony.TelephonyManager
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.EventChannel

// Streams the device call state ("IDLE" / "OFFHOOK" / "RINGING") to Dart so the
// app can auto-suggest the call outcome + duration after a tap-to-call. Requires
// READ_PHONE_STATE (requested at runtime from Dart).
class MainActivity : FlutterActivity() {
    private val channelName = "frt/call_state"
    private var telephony: TelephonyManager? = null
    private var legacyListener: PhoneStateListener? = null
    private var modernCallback: TelephonyCallback? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        EventChannel(flutterEngine.dartExecutor.binaryMessenger, channelName)
            .setStreamHandler(object : EventChannel.StreamHandler {
                override fun onListen(arguments: Any?, events: EventChannel.EventSink) {
                    telephony = getSystemService(Context.TELEPHONY_SERVICE) as TelephonyManager
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                        val cb = object : TelephonyCallback(), TelephonyCallback.CallStateListener {
                            override fun onCallStateChanged(state: Int) = events.success(stateName(state))
                        }
                        modernCallback = cb
                        telephony?.registerTelephonyCallback(mainExecutor, cb)
                    } else {
                        @Suppress("DEPRECATION")
                        val listener = object : PhoneStateListener() {
                            override fun onCallStateChanged(state: Int, phoneNumber: String?) = events.success(stateName(state))
                        }
                        legacyListener = listener
                        @Suppress("DEPRECATION")
                        telephony?.listen(listener, PhoneStateListener.LISTEN_CALL_STATE)
                    }
                }

                override fun onCancel(arguments: Any?) {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                        modernCallback?.let { telephony?.unregisterTelephonyCallback(it) }
                        modernCallback = null
                    } else {
                        @Suppress("DEPRECATION")
                        legacyListener?.let { telephony?.listen(it, PhoneStateListener.LISTEN_NONE) }
                        legacyListener = null
                    }
                }
            })
    }

    private fun stateName(state: Int): String = when (state) {
        TelephonyManager.CALL_STATE_OFFHOOK -> "OFFHOOK"
        TelephonyManager.CALL_STATE_RINGING -> "RINGING"
        else -> "IDLE"
    }
}
