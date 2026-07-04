package com.frtbarabanki.frt_calling

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

// One place for the app's notification channels + posting helpers, shared by the
// activity (alerts requested from Dart) and the call-monitor service.
object Notifications {
    const val CH_ONGOING = "frt_call_ongoing" // silent, while a tracked call is live
    const val CH_CALL_END = "frt_call_end"    // heads-up: call ended, log the result
    const val CH_ALERTS = "frt_alerts"        // new complaints / SLA warnings

    fun ensureChannels(ctx: Context) {
        if (Build.VERSION.SDK_INT < 26) return
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(NotificationChannel(CH_ONGOING, "Call in progress", NotificationManager.IMPORTANCE_LOW).apply {
            setShowBadge(false)
        })
        nm.createNotificationChannel(NotificationChannel(CH_CALL_END, "Call ended", NotificationManager.IMPORTANCE_HIGH).apply {
            description = "Reminds you to log the call result"
        })
        nm.createNotificationChannel(NotificationChannel(CH_ALERTS, "Complaint alerts", NotificationManager.IMPORTANCE_HIGH).apply {
            description = "New complaints and SLA warnings"
        })
    }

    fun openAppIntent(ctx: Context): PendingIntent {
        val i = Intent(ctx, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
        }
        return PendingIntent.getActivity(ctx, 0, i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    private fun post(ctx: Context, channel: String, id: Int, title: String, body: String) {
        ensureChannels(ctx)
        val n = NotificationCompat.Builder(ctx, channel)
            .setSmallIcon(ctx.applicationInfo.icon)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setContentIntent(openAppIntent(ctx))
            .build()
        try {
            NotificationManagerCompat.from(ctx).notify(id, n)
        } catch (_: SecurityException) {
            // POST_NOTIFICATIONS not granted — nothing we can do here.
        }
    }

    fun callEnd(ctx: Context, title: String, body: String) = post(ctx, CH_CALL_END, 42, title, body)

    fun alert(ctx: Context, id: Int, title: String, body: String) = post(ctx, CH_ALERTS, id, title, body)
}
