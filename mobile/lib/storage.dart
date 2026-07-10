import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import 'api.dart';

// An incoming call the native side queued for post-call logging.
// [answered] is null when the entry came from an old-format queue (unknown).
// [durationSeconds] is the OFFHOOK→IDLE talk time (0 = missed, null = an old
// build that didn't record it).
class PendingCall {
  final int dataid;
  final bool? answered;
  final int? durationSeconds;
  PendingCall(this.dataid, this.answered, [this.durationSeconds]);
}

// Local persistence: the offline outbox (complete logs waiting for network),
// drafts (a call happened but no outcome was saved), a cached complaints list
// for offline viewing, the preferred SIM, and alert bookkeeping.
class Store {
  static SharedPreferences? _p;
  static bool _syncing = false;

  static Future<void> init() async {
    _p ??= await SharedPreferences.getInstance();
  }

  static List<Map<String, dynamic>> _readList(String key) {
    final raw = _p?.getString(key);
    if (raw == null) return [];
    try {
      return (jsonDecode(raw) as List).whereType<Map>().map((e) => e.cast<String, dynamic>()).toList();
    } catch (_) {
      return [];
    }
  }

  static Future<void> _writeList(String key, List<Map<String, dynamic>> list) async {
    await _p?.setString(key, jsonEncode(list));
  }

  // --- Outbox: complete call logs that couldn't reach the server ---

  static List<Map<String, dynamic>> outbox() => _readList('outbox');

  static Future<void> queueLog(Map<String, dynamic> payload) async {
    final list = outbox();
    list.add({...payload, '_qid': DateTime.now().millisecondsSinceEpoch, '_queued_at': DateTime.now().toIso8601String()});
    await _writeList('outbox', list);
  }

  // Tries to POST every queued log; stops at the first network failure (still
  // offline). Returns how many synced.
  static Future<int> syncOutbox() async {
    if (_syncing) return 0;
    _syncing = true;
    var synced = 0;
    try {
      var list = outbox();
      while (list.isNotEmpty) {
        final item = Map<String, dynamic>.from(list.first)..remove('_qid')..remove('_queued_at');
        try {
          await Api.logRaw(item);
        } on ApiException catch (e) {
          // 5xx / 401 / timeout are transient (server hiccup, token mid-refresh)
          // — keep the log queued and retry on the next sync. Only a permanent
          // 4xx rejection (bad payload) drops it, so the queue can't jam forever.
          if (e.retryable) break;
        } catch (_) {
          break; // network still down
        }
        list.removeAt(0);
        await _writeList('outbox', list);
        synced++;
        list = outbox();
      }
    } finally {
      _syncing = false;
    }
    return synced;
  }

  static Future<void> removeFromOutbox(int qid) async {
    final list = outbox()..removeWhere((e) => e['_qid'] == qid);
    await _writeList('outbox', list);
  }

  // --- Drafts: tracked calls the operator never logged ---

  static List<Map<String, dynamic>> drafts() => _readList('drafts');

  static Future<void> saveDraft(Map<String, dynamic> draft) async {
    final list = drafts()..removeWhere((d) => d['dataid'] == draft['dataid']);
    list.add(draft);
    if (list.length > 50) list.removeAt(0);
    await _writeList('drafts', list);
  }

  static Future<void> removeDraft(int dataid) async {
    final list = drafts()..removeWhere((d) => d['dataid'] == dataid);
    await _writeList('drafts', list);
  }

  static int pendingCount() => outbox().length + drafts().length;

  // --- Cached complaints (offline view) ---

  static Future<void> cacheComplaints(List<Map<String, dynamic>> raw) async {
    await _writeList('complaints_cache', raw);
    await _p?.setString('complaints_cache_at', DateTime.now().toIso8601String());
  }

  static List<Map<String, dynamic>> cachedComplaints() => _readList('complaints_cache');

  static DateTime? cachedAt() {
    final raw = _p?.getString('complaints_cache_at');
    return raw == null ? null : DateTime.tryParse(raw);
  }

  // --- Preferred SIM for outgoing calls ---

  static String? simAccountId() => _p?.getString('sim_account_id');
  static String? simLabel() => _p?.getString('sim_label');

  static Future<void> setSim(String? accountId, String? label) async {
    if (accountId == null) {
      await _p?.remove('sim_account_id');
      await _p?.remove('sim_label');
    } else {
      await _p?.setString('sim_account_id', accountId);
      await _p?.setString('sim_label', label ?? accountId);
    }
  }

  // --- Alert notifications on/off (new complaint / SLA / retry) ---
  // Bookkeeping in Alerts.check still runs while off, so turning it back on
  // doesn't flood the user with everything they missed.

  static bool notificationsEnabled() => _p?.getBool('notifications_enabled') ?? true;
  static Future<void> setNotificationsEnabled(bool v) async => _p?.setBool('notifications_enabled', v);

  // --- One-time onboarding (permissions + overlay explainer) ---

  static bool onboarded() => _p?.getBool('onboarded') ?? false;
  static Future<void> setOnboarded() async => _p?.setBool('onboarded', true);

  // --- Alert bookkeeping (what we've already notified about) ---

  static Set<int> _readIntSet(String key) =>
      (_p?.getStringList(key) ?? []).map((e) => int.tryParse(e)).whereType<int>().toSet();

  static Future<void> _writeIntSet(String key, Set<int> v) async =>
      _p?.setStringList(key, v.map((e) => '$e').toList());

  static bool alertsInitialized() => _p?.getBool('alerts_init') ?? false;
  static Future<void> setAlertsInitialized() async => _p?.setBool('alerts_init', true);

  static Set<int> seenIds() => _readIntSet('seen_dataids');
  static Future<void> setSeenIds(Set<int> v) async => _writeIntSet('seen_dataids', v);

  static Set<int> overdueNotified() => _readIntSet('overdue_notified');
  static Future<void> setOverdueNotified(Set<int> v) async => _writeIntSet('overdue_notified', v);

  static Set<String> retryNotified() => (_p?.getStringList('retry_notified') ?? []).toSet();
  static Future<void> setRetryNotified(Set<String> v) async => _p?.setStringList('retry_notified', v.toList());

  // --- Caller ID mapping for native BroadcastReceiver ---
  
  // Adds or updates a phone number to complaint mapping. The native side
  // (IncomingCallReceiver) reads this JSON string directly from SharedPreferences.
  static Future<void> saveCallerId(String mobile, String info) async {
    // Strip non-digits from the stored key so native can match easily
    final cleanMobile = mobile.replaceAll(RegExp(r'\D'), '');
    if (cleanMobile.isEmpty) return;
    // We only take the last 10 digits to ignore country code discrepancies
    final key = cleanMobile.length > 10 ? cleanMobile.substring(cleanMobile.length - 10) : cleanMobile;

    final raw = _p?.getString('caller_id_map') ?? '{}';
    try {
      final map = jsonDecode(raw) as Map<String, dynamic>;
      map[key] = info;
      _trimOldest(map, 1000);
      await _p?.setString('caller_id_map', jsonEncode(map));
    } catch (_) {
      await _p?.setString('caller_id_map', jsonEncode({key: info}));
    }
  }

  // Cap the map size so it doesn't grow indefinitely: drop the oldest entries
  // (insertion order) until at most [max] remain. The excess is computed up
  // front — map.length shrinks while removing, so an inline loop condition
  // would stop halfway.
  static void _trimOldest(Map<String, dynamic> map, int max) {
    final excess = map.length - max;
    if (excess <= 0) return;
    final keys = map.keys.take(excess).toList();
    for (final k in keys) {
      map.remove(k);
    }
  }

  // Batch insert caller IDs. Decoding and encoding the JSON map is expensive,
  // so doing it in a loop for 1000s of items causes the app to hang.
  static Future<void> saveCallerIds(Map<String, String> items) async {
    final raw = _p?.getString('caller_id_map') ?? '{}';
    Map<String, dynamic> map = {};
    try {
      map = jsonDecode(raw) as Map<String, dynamic>;
    } catch (_) {
      // Start fresh if corrupt
    }

    for (final entry in items.entries) {
      final cleanMobile = entry.key.replaceAll(RegExp(r'\D'), '');
      if (cleanMobile.isEmpty) continue;
      final key = cleanMobile.length > 10 ? cleanMobile.substring(cleanMobile.length - 10) : cleanMobile;
      map[key] = entry.value;
    }

    _trimOldest(map, 1000);
    await _p?.setString('caller_id_map', jsonEncode(map));
  }

  // Find cached caller-ID info by dataid. The map is keyed by phone number, so
  // we scan the values — used as an instant, offline fallback to open the
  // incoming-call form (the overlay just showed this same info).
  static Map<String, dynamic>? callerInfoForDataId(int dataid) {
    final raw = _p?.getString('caller_id_map');
    if (raw == null) return null;
    try {
      final map = jsonDecode(raw) as Map<String, dynamic>;
      for (final v in map.values) {
        try {
          final info = jsonDecode('$v') as Map<String, dynamic>;
          if (int.tryParse('${info['dataid']}') == dataid) return info;
        } catch (_) {}
      }
    } catch (_) {}
    return null;
  }

  // --- Pending incoming calls queue ---
  //
  // IncomingCallReceiver (Kotlin) appends {"dataid": ..., "answered": ...}
  // objects to "flutter.pending_call_queue" (a JSON array) via
  // PendingCallQueue.enqueue(). It uses .commit() (synchronous) so the value
  // is on disk before the app is brought to the foreground. We call reload()
  // here to make Flutter's in-memory cache pick up the natively-written value.

  static Future<List<PendingCall>> getPendingCalls() async {
    await _p?.reload(); // flush native writes into Flutter's in-memory cache
    final raw = _p?.getString('pending_call_queue') ?? '[]';
    try {
      final list = jsonDecode(raw) as List;
      final out = <PendingCall>[];
      for (final e in list) {
        if (e is Map) {
          final id = int.tryParse('${e['dataid']}');
          if (id != null) out.add(PendingCall(id, e['answered'] is bool ? e['answered'] as bool : null, (e['duration'] as num?)?.toInt()));
        } else {
          // Entry written by a pre-"answered" build (plain dataid string).
          final id = int.tryParse('$e');
          if (id != null) out.add(PendingCall(id, null));
        }
      }
      return out;
    } catch (_) {
      return [];
    }
  }

  static Future<void> clearPendingDataIds() async {
    await _p?.remove('pending_call_queue');
  }

  // Backward-compat: old single-key written by pre-queue builds.
  // Kept so the first launch after an update doesn't silently drop a pending
  // call that was queued by the old Kotlin code before the APK was updated.
  static Future<int?> getPendingIncomingDataId() async {
    await _p?.reload();
    final raw = _p?.getString('pending_incoming_call_dataid');
    return raw != null ? int.tryParse(raw) : null;
  }

  static Future<void> clearPendingIncomingDataId() async {
    await _p?.remove('pending_incoming_call_dataid');
  }
}
