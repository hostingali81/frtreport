package com.frtbarabanki.frt_calling

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.CallLog
import android.provider.Settings
import android.telecom.TelecomManager
import android.telephony.PhoneStateListener
import android.telephony.TelephonyCallback
import android.telephony.TelephonyManager
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import io.flutter.embedding.android.FlutterActivity
import java.io.File
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.EventChannel
import io.flutter.plugin.common.MethodChannel

// Native side of the calling flow:
//  - EventChannel `frt/call_state` streams IDLE/OFFHOOK/RINGING to Dart (call
//    duration tracking while the app is alive).
//  - MethodChannel `frt/call` exposes: runtime permissions, direct dialing
//    (ACTION_CALL, optional dual-SIM account), the device call log (exact
//    duration => did the consumer really answer), overlay permission for
//    auto-return + in-call bubble, the CallMonitorService, and local alert
//    notifications for the Dart-side poller.
class MainActivity : FlutterActivity() {
    private val stateChannelName = "frt/call_state"
    private val callChannelName = "frt/call"
    private val permissionRequestCode = 7301

    private var telephony: TelephonyManager? = null
    private var legacyListener: PhoneStateListener? = null
    private var modernCallback: TelephonyCallback? = null
    private var pendingPermissionResult: MethodChannel.Result? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        Notifications.ensureChannels(this)

        EventChannel(flutterEngine.dartExecutor.binaryMessenger, stateChannelName)
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

        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, callChannelName).setMethodCallHandler { call, result ->
            when (call.method) {
                "getPermissions" -> result.success(permissionsStatus())
                "ensureCallPermissions" -> ensureCallPermissions(result)
                "getPhoneAccounts" -> result.success(getPhoneAccounts())
                "directCall" -> result.success(directCall(call.argument<String>("number") ?: "", call.argument<String>("accountId")))
                "canDrawOverlays" -> result.success(Settings.canDrawOverlays(this))
                "requestOverlayPermission" -> {
                    try {
                        startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName")))
                    } catch (_: Exception) {
                    }
                    result.success(null)
                }
                "startCallMonitor" -> {
                    CallMonitorService.start(this, call.argument<String>("line1") ?: "", call.argument<String>("line2") ?: "")
                    result.success(null)
                }
                "stopCallMonitor" -> {
                    stopService(Intent(this, CallMonitorService::class.java))
                    result.success(null)
                }
                "getLastOutgoingCall" -> result.success(getLastOutgoingCall(call.argument<String>("number") ?: ""))
                "notify" -> {
                    Notifications.alert(this, call.argument<Int>("id") ?: 0, call.argument<String>("title") ?: "", call.argument<String>("body") ?: "")
                    result.success(null)
                }
                // In-app self-update: Dart downloads the new APK to this path, then
                // installApk hands it to the system package installer.
                "getBuildNumber" -> result.success(currentBuildNumber())
                "getVersionName" -> result.success(
                    try { packageManager.getPackageInfo(packageName, 0).versionName ?: "" } catch (_: Exception) { "" }
                )
                "getAbis" -> result.success(Build.SUPPORTED_ABIS.toList())
                "getUpdateApkPath" -> result.success(File(cacheDir, "update.apk").absolutePath)
                "installApk" -> result.success(installApk(call.argument<String>("path") ?: ""))
                else -> result.notImplemented()
            }
        }
    }

    private fun stateName(state: Int): String = when (state) {
        TelephonyManager.CALL_STATE_OFFHOOK -> "OFFHOOK"
        TelephonyManager.CALL_STATE_RINGING -> "RINGING"
        else -> "IDLE"
    }

    private fun granted(permission: String) =
        ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED

    private fun permissionsStatus(): Map<String, Boolean> = mapOf(
        "phoneState" to granted(Manifest.permission.READ_PHONE_STATE),
        "callPhone" to granted(Manifest.permission.CALL_PHONE),
        "callLog" to granted(Manifest.permission.READ_CALL_LOG),
        "notifications" to (Build.VERSION.SDK_INT < 33 || granted(Manifest.permission.POST_NOTIFICATIONS))
    )

    private fun ensureCallPermissions(result: MethodChannel.Result) {
        val wanted = mutableListOf<String>()
        if (!granted(Manifest.permission.READ_PHONE_STATE)) wanted += Manifest.permission.READ_PHONE_STATE
        if (!granted(Manifest.permission.CALL_PHONE)) wanted += Manifest.permission.CALL_PHONE
        if (!granted(Manifest.permission.READ_CALL_LOG)) wanted += Manifest.permission.READ_CALL_LOG
        if (Build.VERSION.SDK_INT >= 33 && !granted(Manifest.permission.POST_NOTIFICATIONS)) wanted += Manifest.permission.POST_NOTIFICATIONS
        if (wanted.isEmpty() || pendingPermissionResult != null) {
            result.success(permissionsStatus())
            return
        }
        pendingPermissionResult = result
        ActivityCompat.requestPermissions(this, wanted.toTypedArray(), permissionRequestCode)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == permissionRequestCode) {
            pendingPermissionResult?.success(permissionsStatus())
            pendingPermissionResult = null
        }
    }

    // Dual-SIM: the call-capable phone accounts, so the operator can pick (and
    // remember) which SIM the app dials from.
    private fun getPhoneAccounts(): List<Map<String, String>> {
        if (!granted(Manifest.permission.READ_PHONE_STATE)) return emptyList()
        return try {
            val tm = getSystemService(Context.TELECOM_SERVICE) as TelecomManager
            tm.callCapablePhoneAccounts.mapIndexed { i, handle ->
                val label = try {
                    tm.getPhoneAccount(handle)?.label?.toString()
                } catch (_: Exception) {
                    null
                }
                mapOf("id" to handle.id, "label" to (label?.takeIf { it.isNotBlank() } ?: "SIM ${i + 1}"))
            }
        } catch (_: Exception) {
            emptyList()
        }
    }

    // Places the call immediately (no dialer confirmation tap). Returns false if
    // not permitted — the Dart side then falls back to a plain tel: intent.
    private fun directCall(number: String, accountId: String?): Boolean {
        if (number.isEmpty() || !granted(Manifest.permission.CALL_PHONE)) return false
        return try {
            val intent = Intent(Intent.ACTION_CALL, Uri.parse("tel:" + Uri.encode(number)))
            if (accountId != null) {
                val tm = getSystemService(Context.TELECOM_SERVICE) as TelecomManager
                val handle = try {
                    tm.callCapablePhoneAccounts.firstOrNull { it.id == accountId }
                } catch (_: Exception) {
                    null
                }
                if (handle != null) intent.putExtra(TelecomManager.EXTRA_PHONE_ACCOUNT_HANDLE, handle)
            }
            startActivity(intent)
            true
        } catch (_: Exception) {
            false
        }
    }

    private fun currentBuildNumber(): Long {
        return try {
            val info = packageManager.getPackageInfo(packageName, 0)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) info.longVersionCode
            else @Suppress("DEPRECATION") info.versionCode.toLong()
        } catch (_: Exception) {
            0L
        }
    }

    // Opens the system installer for the downloaded APK. On Android 8+ the user
    // must allow "install unknown apps" for this app; if not yet granted we send
    // them straight to that settings screen and return false so Dart can ask them
    // to tap Install again afterwards.
    private fun installApk(path: String): Boolean {
        val file = File(path)
        if (!file.exists()) return false
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !packageManager.canRequestPackageInstalls()) {
                startActivity(
                    Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:$packageName"))
                )
                return false
            }
            val uri = FileProvider.getUriForFile(this, "$packageName.fileprovider", file)
            startActivity(Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            })
            true
        } catch (_: Exception) {
            false
        }
    }

    // The device call log is the accurate source for "did they answer": for an
    // outgoing call its duration only counts after pickup, so duration > 0 means
    // the consumer really answered (vs the in-app OFFHOOK..IDLE wall time which
    // includes ringing).
    private fun getLastOutgoingCall(number: String): Map<String, Any>? {
        if (!granted(Manifest.permission.READ_CALL_LOG)) return null
        val tail = number.filter { it.isDigit() }.takeLast(10)
        if (tail.isEmpty()) return null
        return try {
            contentResolver.query(
                CallLog.Calls.CONTENT_URI,
                arrayOf(CallLog.Calls.NUMBER, CallLog.Calls.DATE, CallLog.Calls.DURATION),
                "${CallLog.Calls.TYPE} = ? AND ${CallLog.Calls.DATE} >= ?",
                arrayOf(
                    CallLog.Calls.OUTGOING_TYPE.toString(),
                    (System.currentTimeMillis() - 6 * 60 * 60 * 1000L).toString()
                ),
                "${CallLog.Calls.DATE} DESC"
            )?.use { c ->
                while (c.moveToNext()) {
                    val num = (c.getString(0) ?: "").filter { it.isDigit() }.takeLast(10)
                    if (num == tail) {
                        return mapOf(
                            "durationSeconds" to c.getLong(2),
                            "dateMillis" to c.getLong(1)
                        )
                    }
                }
                null
            }
        } catch (_: Exception) {
            null
        }
    }
}
