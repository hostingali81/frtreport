package com.frtbarabanki.frt_calling

import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.provider.Settings
import android.telephony.PhoneStateListener
import android.telephony.TelephonyCallback
import android.telephony.TelephonyManager
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat

// Foreground service that lives for the duration of one tracked outgoing call:
// keeps the process alive while the dialer is on top, shows a floating info
// bubble during the call (overlay permission), and when the call ends brings
// the app back to the foreground (or posts a heads-up notification as a
// fallback when overlay permission is missing, since Android blocks background
// activity starts without it).
class CallMonitorService : Service() {
    companion object {
        private const val EXTRA_LINE1 = "line1"
        private const val EXTRA_LINE2 = "line2"
        private const val NOTIF_ID = 41

        fun start(ctx: Context, line1: String, line2: String) {
            val i = Intent(ctx, CallMonitorService::class.java)
                .putExtra(EXTRA_LINE1, line1)
                .putExtra(EXTRA_LINE2, line2)
            if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i) else ctx.startService(i)
        }
    }

    private var telephony: TelephonyManager? = null
    private var legacyListener: PhoneStateListener? = null
    private var modernCallback: TelephonyCallback? = null
    private val handler = Handler(Looper.getMainLooper())

    private var line1 = ""
    private var line2 = ""
    private var sawOffhook = false
    private var offhookAt = 0L
    private var finishing = false
    private var bubble: View? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // A new tracked call resets any previous state (back-to-back calls).
        handler.removeCallbacksAndMessages(null)
        removeBubble()
        sawOffhook = false
        offhookAt = 0L
        finishing = false
        line1 = intent?.getStringExtra(EXTRA_LINE1) ?: ""
        line2 = intent?.getStringExtra(EXTRA_LINE2) ?: ""

        Notifications.ensureChannels(this)
        val notif = NotificationCompat.Builder(this, Notifications.CH_ONGOING)
            .setSmallIcon(applicationInfo.icon)
            .setContentTitle("On call — FRT Calling")
            .setContentText(line1.ifEmpty { "Tracking the call result" })
            .setOngoing(true)
            .setContentIntent(Notifications.openAppIntent(this))
            .build()
        startForeground(NOTIF_ID, notif)
        startListening()

        // The operator may cancel before dialing; don't linger forever.
        handler.postDelayed({ if (!sawOffhook) finish() }, 75_000)
        handler.postDelayed({ finish() }, 3 * 60 * 60 * 1000L)
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        stopListening()
        removeBubble()
        handler.removeCallbacksAndMessages(null)
        super.onDestroy()
    }

    private fun onState(state: Int) {
        when (state) {
            TelephonyManager.CALL_STATE_OFFHOOK -> {
                if (!sawOffhook) {
                    sawOffhook = true
                    offhookAt = System.currentTimeMillis()
                    showBubble()
                }
            }
            TelephonyManager.CALL_STATE_IDLE -> if (sawOffhook) onCallEnded()
        }
    }

    private fun onCallEnded() {
        if (finishing) return
        removeBubble()
        val durSec = if (offhookAt > 0) (System.currentTimeMillis() - offhookAt) / 1000 else 0
        // Bring the app back on top. With "Display over other apps" granted the
        // OS allows this from the background; otherwise it is silently dropped
        // on Android 10+, so we also post a heads-up notification.
        try {
            startActivity(Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
            })
        } catch (_: Exception) {
        }
        if (!Settings.canDrawOverlays(this)) {
            Notifications.callEnd(
                this,
                "Call ended · ${durSec / 60}:${(durSec % 60).toString().padStart(2, '0')}",
                "Tap to log the result${if (line1.isNotEmpty()) " — $line1" else ""}"
            )
        }
        finish()
    }

    private fun finish() {
        if (finishing) return
        finishing = true
        handler.removeCallbacksAndMessages(null)
        stopListening()
        removeBubble()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun startListening() {
        stopListening()
        telephony = getSystemService(Context.TELEPHONY_SERVICE) as TelephonyManager
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val cb = object : TelephonyCallback(), TelephonyCallback.CallStateListener {
                    override fun onCallStateChanged(state: Int) = onState(state)
                }
                modernCallback = cb
                telephony?.registerTelephonyCallback(ContextCompat.getMainExecutor(this), cb)
            } else {
                @Suppress("DEPRECATION")
                val listener = object : PhoneStateListener() {
                    override fun onCallStateChanged(state: Int, phoneNumber: String?) = onState(state)
                }
                legacyListener = listener
                @Suppress("DEPRECATION")
                telephony?.listen(listener, PhoneStateListener.LISTEN_CALL_STATE)
            }
        } catch (_: SecurityException) {
            // READ_PHONE_STATE revoked mid-flight; the Dart side degrades too.
        }
    }

    private fun stopListening() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            modernCallback?.let { telephony?.unregisterTelephonyCallback(it) }
            modernCallback = null
        } else {
            @Suppress("DEPRECATION")
            legacyListener?.let { telephony?.listen(it, PhoneStateListener.LISTEN_NONE) }
            legacyListener = null
        }
    }

    // Small draggable dark card pinned near the top of whatever is on screen
    // (the in-call UI), so the operator sees who they're talking to and why.
    private fun showBubble() {
        if (bubble != null || line1.isEmpty() || !Settings.canDrawOverlays(this)) return
        try {
            val wm = getSystemService(Context.WINDOW_SERVICE) as WindowManager
            val density = resources.displayMetrics.density
            fun dp(v: Int) = (v * density).toInt()

            val card = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(dp(16), dp(11), dp(16), dp(11))
                background = GradientDrawable().apply {
                    cornerRadius = dp(14).toFloat()
                    setColor(0xF20F172A.toInt())
                }
            }
            card.addView(TextView(this).apply {
                text = line1
                setTextColor(0xFFFFFFFF.toInt())
                textSize = 15f
                setTypeface(typeface, Typeface.BOLD)
                maxWidth = dp(250)
            })
            if (line2.isNotEmpty()) {
                card.addView(TextView(this).apply {
                    text = line2
                    setTextColor(0xFFCBD5E1.toInt())
                    textSize = 12.5f
                    maxWidth = dp(250)
                })
            }

            val type = if (Build.VERSION.SDK_INT >= 26) WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            else @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE
            val lp = WindowManager.LayoutParams(
                WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.WRAP_CONTENT,
                type,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
                PixelFormat.TRANSLUCENT
            ).apply {
                gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
                y = dp(72)
            }

            var downY = 0f
            var startY = 0
            card.setOnTouchListener { v, e ->
                when (e.action) {
                    MotionEvent.ACTION_DOWN -> {
                        downY = e.rawY
                        startY = lp.y
                        true
                    }
                    MotionEvent.ACTION_MOVE -> {
                        lp.y = (startY + (e.rawY - downY)).toInt().coerceAtLeast(0)
                        try { wm.updateViewLayout(v, lp) } catch (_: Exception) {}
                        true
                    }
                    else -> false
                }
            }

            wm.addView(card, lp)
            bubble = card
        } catch (_: Exception) {
            bubble = null
        }
    }

    private fun removeBubble() {
        val b = bubble ?: return
        bubble = null
        try {
            (getSystemService(Context.WINDOW_SERVICE) as WindowManager).removeView(b)
        } catch (_: Exception) {
        }
    }
}
