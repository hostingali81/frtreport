package com.frtbarabanki.frt_calling

import android.content.Context
import org.json.JSONArray

/**
 * Thread-safe queue of dataid strings that Flutter drains one by one to open
 * the post-call logging form for incoming calls.
 *
 * Using a JSON array in SharedPreferences allows concurrent incoming calls to
 * each push their own entry without overwriting one another.
 *
 * .commit() (synchronous write) is intentional: the app is brought to the
 * foreground immediately after enqueue(), so the value MUST be flushed to disk
 * before Flutter's SharedPreferences.reload() picks it up.
 */
object PendingCallQueue {
    private const val KEY   = "flutter.pending_call_queue"
    private const val PREFS = "FlutterSharedPreferences"

    /** Appends [dataId] to the queue. No-op if [dataId] is blank. */
    fun enqueue(context: Context, dataId: String) {
        if (dataId.isBlank()) return
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val raw = prefs.getString(KEY, "[]") ?: "[]"
        val arr = try { JSONArray(raw) } catch (_: Exception) { JSONArray() }
        arr.put(dataId)
        prefs.edit().putString(KEY, arr.toString()).commit() // synchronous!
    }
}
