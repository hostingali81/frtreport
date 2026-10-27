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
import android.media.MediaPlayer
import android.net.wifi.WifiManager
import android.os.Environment
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
                    CallMonitorService.start(this, call.argument<String>("info") ?: "")
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
                // Storage permission & Redmi Recording Finder
                "hasStoragePermission" -> result.success(hasStoragePermission())
                "requestStoragePermission" -> result.success(requestStoragePermission())
                "findLatestRecording" -> {
                    val number = call.argument<String>("number") ?: ""
                    val since = (call.argument<Number>("sinceMillis"))?.toLong() ?: 0L
                    Thread {
                        val resultData = findLatestRecording(number, since)
                        runOnUiThread {
                            result.success(resultData)
                        }
                    }.start()
                }
                "listRecordings" -> {
                    val number = call.argument<String>("number") ?: ""
                    val limit = (call.argument<Number>("limit"))?.toInt() ?: 50
                    Thread {
                        val resultData = listRecordings(number, limit)
                        runOnUiThread {
                            result.success(resultData)
                        }
                    }.start()
                }
                // Native Audio Player Preview
                "playRecording" -> result.success(playRecording(call.argument<String>("path") ?: ""))
                "pauseRecording" -> result.success(pauseRecording())
                "stopRecording" -> result.success(stopRecording())
                "isPlayingRecording" -> result.success(isPlayingRecording())
                // Multicast Lock for UDP Auto-Discovery
                "acquireMulticastLock" -> {
                    acquireMulticastLock()
                    result.success(null)
                }
                "releaseMulticastLock" -> {
                    releaseMulticastLock()
                    result.success(null)
                }
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
                    (System.currentTimeMillis() - 30 * 60 * 1000L).toString()
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

    private var previewPlayer: MediaPlayer? = null
    private var multicastLock: WifiManager.MulticastLock? = null

    private fun hasStoragePermission(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            Environment.isExternalStorageManager()
        } else {
            ContextCompat.checkSelfPermission(this, Manifest.permission.READ_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED
        }
    }

    private fun requestStoragePermission(): Boolean {
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                try {
                    val intent = Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION).apply {
                        data = Uri.parse("package:$packageName")
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    }
                    startActivity(intent)
                    true
                } catch (_: Exception) {
                    val intent = Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION).apply {
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    }
                    startActivity(intent)
                    true
                }
            } else {
                ActivityCompat.requestPermissions(
                    this,
                    arrayOf(
                        Manifest.permission.READ_EXTERNAL_STORAGE,
                        Manifest.permission.WRITE_EXTERNAL_STORAGE
                    ),
                    7302
                )
                true
            }
        } catch (_: Exception) {
            false
        }
    }

    private fun acquireMulticastLock() {
        try {
            if (multicastLock == null) {
                val wm = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
                multicastLock = wm.createMulticastLock("frt_multicast_lock").apply {
                    setReferenceCounted(true)
                }
            }
            multicastLock?.acquire()
        } catch (_: Exception) {}
    }

    private fun releaseMulticastLock() {
        try {
            if (multicastLock?.isHeld == true) {
                multicastLock?.release()
            }
        } catch (_: Exception) {}
    }

    private fun getRecordingDirectories(): List<File> {
        val dirs = mutableListOf<File>()
        val sd = Environment.getExternalStorageDirectory()

        // Redmi / Xiaomi MIUI / HyperOS paths
        dirs.add(File("/sdcard/MIUI/sound_recorder/call_rec"))
        dirs.add(File(sd, "MIUI/sound_recorder/call_rec"))
        dirs.add(File("/storage/emulated/0/MIUI/sound_recorder/call_rec"))

        // Standard Android & OEM Call Recording paths
        dirs.add(File(sd, "Recordings/Call"))
        dirs.add(File(sd, "Recordings/call_rec"))
        dirs.add(File(sd, "Music/Recordings/Call"))
        dirs.add(File(sd, "Sounds/Call"))
        dirs.add(File(sd, "Audio/Call"))
        dirs.add(File(sd, "CallRecordings"))
        dirs.add(File(sd, "Call_Recordings"))

        try {
            val musicDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MUSIC)
            dirs.add(File(musicDir, "Recordings/Call"))
            dirs.add(File(musicDir, "Call"))
        } catch (_: Exception) {}

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val recDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_RECORDINGS)
                dirs.add(File(recDir, "Call"))
                dirs.add(File(recDir, "call_rec"))
            }
        } catch (_: Exception) {}

        return dirs.filter { it.exists() && it.isDirectory }
    }

    private fun isAudioFile(name: String): Boolean {
        return name.endsWith(".mp3", ignoreCase = true) ||
               name.endsWith(".m4a", ignoreCase = true) ||
               name.endsWith(".aac", ignoreCase = true) ||
               name.endsWith(".amr", ignoreCase = true) ||
               name.endsWith(".wav", ignoreCase = true)
    }

    private fun findLatestRecording(rawNumber: String, sinceMillis: Long): Map<String, Any>? {
        if (!hasStoragePermission()) return null
        val cleanPhone = rawNumber.filter { it.isDigit() }.takeLast(10)

        val dirs = getRecordingDirectories()
        var bestFile: File? = null
        var bestModified = 0L
        val cutoff = if (sinceMillis > 0) sinceMillis - 90_000L else 0L

        for (dir in dirs) {
            val files = dir.listFiles() ?: continue
            for (f in files) {
                if (!f.isFile || !isAudioFile(f.name)) continue
                val lm = f.lastModified()
                if (lm < cutoff) continue

                val name = f.name
                val matches = cleanPhone.isNotEmpty() && name.contains(cleanPhone)
                if (matches) {
                    if (lm > bestModified) {
                        bestModified = lm
                        bestFile = f
                    }
                }
            }
            if (bestFile != null) break
        }

        // Fallback: if no file contained the 10-digit number, but a call recording was created within 90s of call end
        if (bestFile == null && sinceMillis > 0) {
            val recentCutoff = sinceMillis - 30_000L
            for (dir in dirs) {
                val files = dir.listFiles() ?: continue
                for (f in files) {
                    if (!f.isFile || !isAudioFile(f.name)) continue
                    val lm = f.lastModified()
                    if (lm >= recentCutoff && lm > bestModified) {
                        bestModified = lm
                        bestFile = f
                    }
                }
            }
        }

        val found = bestFile ?: return null
        return mapOf(
            "path" to found.absolutePath,
            "name" to found.name,
            "size" to found.length(),
            "lastModified" to found.lastModified()
        )
    }

    private fun listRecordings(rawNumber: String?, limit: Int): List<Map<String, Any>> {
        if (!hasStoragePermission()) return emptyList()
        val cleanPhone = (rawNumber ?: "").filter { it.isDigit() }.takeLast(10)

        val allFiles = mutableListOf<File>()
        for (dir in getRecordingDirectories()) {
            if (!dir.exists() || !dir.isDirectory) continue
            val files = dir.listFiles() ?: continue
            for (f in files) {
                if (f.isFile && isAudioFile(f.name)) {
                    allFiles.add(f)
                }
            }
        }

        val uniqueFiles = allFiles.distinctBy { it.name }

        // Sort: matching phone number first (newest to oldest), then all others (newest to oldest)
        val sorted = uniqueFiles.sortedWith(Comparator { a, b ->
            val aMatches = cleanPhone.isNotEmpty() && a.name.contains(cleanPhone)
            val bMatches = cleanPhone.isNotEmpty() && b.name.contains(cleanPhone)
            when {
                aMatches && !bMatches -> -1
                !aMatches && bMatches -> 1
                else -> b.lastModified().compareTo(a.lastModified())
            }
        })

        return sorted.take(limit).map { f ->
            val matches = cleanPhone.isNotEmpty() && f.name.contains(cleanPhone)
            mapOf(
                "path" to f.absolutePath,
                "name" to f.name,
                "size" to f.length(),
                "lastModified" to f.lastModified(),
                "matchesNumber" to matches
            )
        }
    }

    private fun playRecording(path: String): Boolean {
        if (path.isEmpty()) return false
        return try {
            previewPlayer?.stop()
            previewPlayer?.release()
            previewPlayer = MediaPlayer().apply {
                setDataSource(path)
                setOnCompletionListener {
                    flutterEngine?.dartExecutor?.binaryMessenger?.let { messenger ->
                        MethodChannel(messenger, callChannelName)
                            .invokeMethod("onRecordingPlaybackComplete", null)
                    }
                }
                prepare()
                start()
            }
            true
        } catch (e: Exception) {
            false
        }
    }

    private fun pauseRecording(): Boolean {
        return try {
            if (previewPlayer?.isPlaying == true) {
                previewPlayer?.pause()
                true
            } else false
        } catch (_: Exception) {
            false
        }
    }

    private fun stopRecording(): Boolean {
        return try {
            previewPlayer?.stop()
            previewPlayer?.release()
            previewPlayer = null
            true
        } catch (_: Exception) {
            false
        }
    }

    private fun isPlayingRecording(): Boolean {
        return try {
            previewPlayer?.isPlaying ?: false
        } catch (_: Exception) {
            false
        }
    }

    override fun onDestroy() {
        try {
            previewPlayer?.release()
            previewPlayer = null
            releaseMulticastLock()
        } catch (_: Exception) {}
        super.onDestroy()
    }
}
