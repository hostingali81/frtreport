package com.frtbarabanki.frt_calling

import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.IBinder
import android.provider.Settings
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.app.NotificationCompat

class IncomingCallService : Service() {
    companion object {
        private const val EXTRA_INFO   = "info"
        private const val EXTRA_LAUNCH = "launch_app"
        private const val NOTIF_ID     = 43

        fun start(ctx: Context, info: String) {
            val i = Intent(ctx, IncomingCallService::class.java).putExtra(EXTRA_INFO, info)
            if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i) else ctx.startService(i)
        }

        /**
         * Stop the overlay and, when [launchApp] is true, bring MainActivity
         * to the foreground so the operator can log the call.
         * The dataid is no longer passed here — it was already written to the
         * PendingCallQueue (synchronously via .commit()) in IncomingCallReceiver
         * before this method is called, so Flutter will see it on resume.
         */
        fun stop(ctx: Context, launchApp: Boolean = false) {
            val i = Intent(ctx, IncomingCallService::class.java)
            i.action = "STOP_AND_LAUNCH"
            i.putExtra(EXTRA_LAUNCH, launchApp)
            try {
                if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i) else ctx.startService(i)
            } catch (e: Exception) {
                ctx.stopService(Intent(ctx, IncomingCallService::class.java))
            }
        }
    }

    private var bubble: View? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == "STOP_AND_LAUNCH") {
            // startForegroundService() contract: every start must be answered
            // with a startForeground() call — even when this command only stops
            // the service. Skipping it risks a RemoteServiceException
            // ("did not then call Service.startForeground()") when the service
            // wasn't already in the foreground.
            Notifications.ensureChannels(this)
            try {
                startForeground(
                    NOTIF_ID,
                    NotificationCompat.Builder(this, Notifications.CH_ONGOING)
                        .setSmallIcon(applicationInfo.icon)
                        .setContentTitle("Call ended")
                        .setOngoing(true)
                        .build()
                )
            } catch (e: Exception) {}

            // The dataid was already written to PendingCallQueue (synchronously)
            // in IncomingCallReceiver before this service was started, so we
            // only need to bring the app to the foreground here.
            if (intent.getBooleanExtra(EXTRA_LAUNCH, false)) {
                try {
                    startActivity(Intent(this, MainActivity::class.java).apply {
                        this.flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                                Intent.FLAG_ACTIVITY_SINGLE_TOP or
                                Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
                    })
                } catch (e: Exception) {}
            }
            stopForeground(true)
            stopSelf()
            return START_NOT_STICKY
        }

        val info = intent?.getStringExtra(EXTRA_INFO) ?: ""
        
        Notifications.ensureChannels(this)
        val notif = NotificationCompat.Builder(this, Notifications.CH_ONGOING)
            .setSmallIcon(applicationInfo.icon)
            .setContentTitle("Incoming call from consumer")
            .setContentText("FRT Calling Caller ID")
            .setOngoing(true)
            .build()
        startForeground(NOTIF_ID, notif)

        showBubble(info)
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        removeBubble()
        super.onDestroy()
    }

    private fun showBubble(info: String) {
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
                val lastDate = obj.optString("last_date", "")
                if (lastDate.isNotEmpty() && cLastStatus.isNotEmpty()) {
                    val dateOnly = lastDate.take(10) // YYYY-MM-DD
                    cLastStatus = "$cLastStatus on $dateOnly"
                }
            } catch (e: Exception) {
                // Fallback for old plaintext format
                val lines = info.split("\n")
                cNumber = lines.getOrNull(0) ?: ""
                cName = if (lines.size > 1) lines.subList(1, lines.size).joinToString("\n") else ""
            }

            // Trim remark to keep banner consistent
            val trimmedRemarks = if (cRemarks.length > 60) cRemarks.substring(0, 58) + ".." else cRemarks

            val card = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(dp(24), dp(20), dp(24), dp(20))
                background = GradientDrawable().apply {
                    cornerRadius = dp(18).toFloat()
                    setColor(0xFF0F172A.toInt()) // slate-900
                    setStroke(dp(2), 0xFF38BDF8.toInt()) // brand color border
                }
                elevation = dp(8).toFloat()
            }
            
            // Header badge
            val header = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = android.view.Gravity.CENTER_VERTICAL
                setPadding(0, 0, 0, dp(10))
            }
            header.addView(TextView(this).apply {
                text = "⚡ FRT Caller ID"
                setTextColor(0xFF38BDF8.toInt()) // brand color
                textSize = 13f
                setTypeface(typeface, Typeface.BOLD)
                setPadding(dp(10), dp(4), dp(10), dp(4))
                background = GradientDrawable().apply {
                    cornerRadius = dp(8).toFloat()
                    setColor(0xFF1E3A5F.toInt()) // dark blue tint
                }
            })
            card.addView(header)

            // Consumer name (large, bold)
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

            // Complaint number
            if (cNumber.isNotEmpty()) {
                card.addView(TextView(this).apply {
                    text = "📋 $cNumber"
                    setTextColor(0xFF38BDF8.toInt()) // brand color
                    textSize = 15f
                    setTypeface(typeface, Typeface.BOLD)
                    setPadding(0, dp(2), 0, dp(4))
                    maxWidth = dp(320)
                })
            }

            // Complaint sub-type
            if (cSubType.isNotEmpty()) {
                card.addView(TextView(this).apply {
                    text = "🔧 $cSubType"
                    setTextColor(0xFFE2E8F0.toInt()) // slate-200
                    textSize = 14f
                    setTypeface(typeface, Typeface.BOLD)
                    setPadding(0, dp(2), 0, dp(2))
                    maxWidth = dp(320)
                })
            }

            // Substation
            if (cSubstation.isNotEmpty()) {
                card.addView(TextView(this).apply {
                    text = "📍 $cSubstation"
                    setTextColor(0xFFCBD5E1.toInt()) // slate-300
                    textSize = 13f
                    setPadding(0, dp(2), 0, dp(2))
                    maxWidth = dp(320)
                })
            }

            // Remark (trimmed if long)
            if (trimmedRemarks.isNotEmpty()) {
                // Separator line
                card.addView(View(this).apply {
                    layoutParams = LinearLayout.LayoutParams(
                        LinearLayout.LayoutParams.MATCH_PARENT, dp(1)
                    ).apply { topMargin = dp(8); bottomMargin = dp(8) }
                    setBackgroundColor(0xFF334155.toInt()) // slate-700
                })
                card.addView(TextView(this).apply {
                    text = "💬 $trimmedRemarks"
                    setTextColor(0xFF94A3B8.toInt()) // slate-400
                    textSize = 12.5f
                    setTypeface(typeface, Typeface.ITALIC)
                    setPadding(0, 0, 0, 0)
                    maxWidth = dp(320)
                    maxLines = 2
                })
            }

            // Complaint history (total count + last status)
            if (cTotalComplaints > 0) {
                // Separator (if remark didn't add one)
                if (trimmedRemarks.isEmpty()) {
                    card.addView(View(this).apply {
                        layoutParams = LinearLayout.LayoutParams(
                            LinearLayout.LayoutParams.MATCH_PARENT, dp(1)
                        ).apply { topMargin = dp(8); bottomMargin = dp(8) }
                        setBackgroundColor(0xFF334155.toInt())
                    })
                }

                // History row container
                val historyRow = LinearLayout(this).apply {
                    orientation = LinearLayout.HORIZONTAL
                    gravity = android.view.Gravity.CENTER_VERTICAL
                    setPadding(0, dp(4), 0, 0)
                }

                // Complaint count badge
                historyRow.addView(TextView(this).apply {
                    text = "📊 $cTotalComplaints complaint${if (cTotalComplaints > 1) "s" else ""}"
                    setTextColor(0xFFE2E8F0.toInt()) // slate-200
                    textSize = 12.5f
                    setTypeface(typeface, Typeface.BOLD)
                    setPadding(dp(8), dp(3), dp(8), dp(3))
                    background = GradientDrawable().apply {
                        cornerRadius = dp(6).toFloat()
                        setColor(0xFF1E293B.toInt()) // slate-800
                    }
                })

                // Last status badge
                if (cLastStatus.isNotEmpty()) {
                    val isResolved = cLastStatus.equals("Resolved", ignoreCase = true)
                    val statusIcon = if (isResolved) "✅" else "🔴"
                    val statusColor = if (isResolved) 0xFF4ADE80.toInt() else 0xFFFBBF24.toInt() // green-400 / amber-400
                    val statusBg = if (isResolved) 0xFF14532D.toInt() else 0xFF78350F.toInt() // green-900 / amber-900

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
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED,
                PixelFormat.TRANSLUCENT
            ).apply {
                gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
                y = dp(100) // positioned to avoid overlapping system caller ID
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
                        if (!isDrag) stopSelf()
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
