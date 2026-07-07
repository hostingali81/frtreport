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
        private const val EXTRA_INFO = "info"
        private const val NOTIF_ID = 41

        fun start(ctx: Context, info: String) {
            val i = Intent(ctx, CallMonitorService::class.java)
                .putExtra(EXTRA_INFO, info)
            if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i) else ctx.startService(i)
        }
    }

    private var telephony: TelephonyManager? = null
    private var legacyListener: PhoneStateListener? = null
    private var modernCallback: TelephonyCallback? = null
    private val handler = Handler(Looper.getMainLooper())

    private var info = ""
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
        info = intent?.getStringExtra(EXTRA_INFO) ?: ""

        Notifications.ensureChannels(this)
        val notif = NotificationCompat.Builder(this, Notifications.CH_ONGOING)
            .setSmallIcon(applicationInfo.icon)
            .setContentTitle("On call — FRT Calling")
            .setContentText("Tracking the call result")
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
                "Tap to log the result"
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
        if (bubble != null || info.isEmpty() || !Settings.canDrawOverlays(this)) return
        try {
            val wm = getSystemService(Context.WINDOW_SERVICE) as WindowManager
            val density = resources.displayMetrics.density
            fun dp(v: Int) = (v * density).toInt()

            var cNumber = ""
            var cName = ""
            var cSubstation = ""
            var cSubType = ""
            var cRemarks = ""
            var cTotalComplaints = 0
            var cLastStatus = ""
            try {
                val obj = org.json.JSONObject(info)
                cNumber = obj.optString("complaint_number", "")
                cName = obj.optString("consumer_name", "")
                cSubstation = obj.optString("substation", "")
                cSubType = obj.optString("complaint_sub_type", "")
                cRemarks = obj.optString("remarks", "")
                cTotalComplaints = obj.optInt("total_complaints", 0)
                cLastStatus = obj.optString("last_status", "")
            } catch (e: Exception) {
                val lines = info.split("\n")
                cNumber = lines.getOrNull(0) ?: ""
                cName = if (lines.size > 1) lines.subList(1, lines.size).joinToString("\n") else ""
            }

            val trimmedRemarks = if (cRemarks.length > 60) cRemarks.substring(0, 58) + ".." else cRemarks

            val card = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(dp(24), dp(20), dp(24), dp(20))
                background = GradientDrawable().apply {
                    cornerRadius = dp(18).toFloat()
                    setColor(0xFF0F172A.toInt())
                    setStroke(dp(2), 0xFF38BDF8.toInt())
                }
                elevation = dp(8).toFloat()
            }
            
            val header = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = android.view.Gravity.CENTER_VERTICAL
                setPadding(0, 0, 0, dp(10))
            }
            header.addView(TextView(this).apply {
                text = "⚡ FRT Caller ID"
                setTextColor(0xFF38BDF8.toInt())
                textSize = 13f
                setTypeface(typeface, Typeface.BOLD)
                setPadding(dp(10), dp(4), dp(10), dp(4))
                background = GradientDrawable().apply {
                    cornerRadius = dp(8).toFloat()
                    setColor(0xFF1E3A5F.toInt())
                }
            })
            card.addView(header)

            if (cName.isNotEmpty()) {
                card.addView(TextView(this).apply {
                    text = cName
                    setTextColor(0xFFFFFFFF.toInt())
                    textSize = 20f
                    setTypeface(typeface, Typeface.BOLD)
                    maxWidth = dp(320)
                    setPadding(0, 0, 0, dp(6))
                })
            }

            if (cNumber.isNotEmpty()) {
                card.addView(TextView(this).apply {
                    text = "📋 $cNumber"
                    setTextColor(0xFF38BDF8.toInt())
                    textSize = 15f
                    setTypeface(typeface, Typeface.BOLD)
                    setPadding(0, dp(2), 0, dp(4))
                    maxWidth = dp(320)
                })
            }

            if (cSubType.isNotEmpty()) {
                card.addView(TextView(this).apply {
                    text = "🔧 $cSubType"
                    setTextColor(0xFFE2E8F0.toInt())
                    textSize = 14f
                    setTypeface(typeface, Typeface.BOLD)
                    setPadding(0, dp(2), 0, dp(2))
                    maxWidth = dp(320)
                })
            }

            if (cSubstation.isNotEmpty()) {
                card.addView(TextView(this).apply {
                    text = "📍 $cSubstation"
                    setTextColor(0xFFCBD5E1.toInt())
                    textSize = 13f
                    setPadding(0, dp(2), 0, dp(2))
                    maxWidth = dp(320)
                })
            }

            if (trimmedRemarks.isNotEmpty()) {
                card.addView(View(this).apply {
                    layoutParams = LinearLayout.LayoutParams(
                        LinearLayout.LayoutParams.MATCH_PARENT, dp(1)
                    ).apply { topMargin = dp(8); bottomMargin = dp(8) }
                    setBackgroundColor(0xFF334155.toInt())
                })
                card.addView(TextView(this).apply {
                    text = "💬 $trimmedRemarks"
                    setTextColor(0xFF94A3B8.toInt())
                    textSize = 12.5f
                    setTypeface(typeface, Typeface.ITALIC)
                    setPadding(0, 0, 0, 0)
                    maxWidth = dp(320)
                    maxLines = 2
                })
            }

            if (cTotalComplaints > 0) {
                if (trimmedRemarks.isEmpty()) {
                    card.addView(View(this).apply {
                        layoutParams = LinearLayout.LayoutParams(
                            LinearLayout.LayoutParams.MATCH_PARENT, dp(1)
                        ).apply { topMargin = dp(8); bottomMargin = dp(8) }
                        setBackgroundColor(0xFF334155.toInt())
                    })
                }

                val historyRow = LinearLayout(this).apply {
                    orientation = LinearLayout.HORIZONTAL
                    gravity = android.view.Gravity.CENTER_VERTICAL
                    setPadding(0, dp(4), 0, 0)
                }

                historyRow.addView(TextView(this).apply {
                    text = "📊 $cTotalComplaints complaint${if (cTotalComplaints > 1) "s" else ""}"
                    setTextColor(0xFFE2E8F0.toInt())
                    textSize = 12.5f
                    setTypeface(typeface, Typeface.BOLD)
                    setPadding(dp(8), dp(3), dp(8), dp(3))
                    background = GradientDrawable().apply {
                        cornerRadius = dp(6).toFloat()
                        setColor(0xFF1E293B.toInt())
                    }
                })

                if (cLastStatus.isNotEmpty()) {
                    val isResolved = cLastStatus.equals("Resolved", ignoreCase = true)
                    val statusIcon = if (isResolved) "✅" else "🔴"
                    val statusColor = if (isResolved) 0xFF4ADE80.toInt() else 0xFFFBBF24.toInt()
                    val statusBg = if (isResolved) 0xFF14532D.toInt() else 0xFF78350F.toInt()

                    historyRow.addView(TextView(this).apply {
                        text = "  $statusIcon $cLastStatus"
                        setTextColor(statusColor)
                        textSize = 12.5f
                        setTypeface(typeface, Typeface.BOLD)
                        setPadding(dp(8), dp(3), dp(8), dp(3))
                        background = GradientDrawable().apply {
                            cornerRadius = dp(6).toFloat()
                            setColor(statusBg)
                        }
                    })
                }

                card.addView(historyRow)
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
                y = dp(100)
            }

            var downY = 0f
            var startY = 0
            var isDrag = false
            card.setOnTouchListener { v, e ->
                when (e.action) {
                    MotionEvent.ACTION_DOWN -> {
                        downY = e.rawY
                        startY = lp.y
                        isDrag = false
                        true
                    }
                    MotionEvent.ACTION_MOVE -> {
                        if (Math.abs(e.rawY - downY) > 10) isDrag = true
                        if (isDrag) {
                            lp.y = (startY + (e.rawY - downY)).toInt().coerceAtLeast(0)
                            try { wm.updateViewLayout(v, lp) } catch (_: Exception) {}
                        }
                        true
                    }
                    MotionEvent.ACTION_UP -> {
                        if (!isDrag) removeBubble()
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
