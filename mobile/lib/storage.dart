import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import 'api.dart';

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
        } on ApiException {
          // Server rejected it (bad payload / auth) — drop it rather than
          // blocking the queue forever.
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
      // Cap the map size so it doesn't grow indefinitely. Remove oldest if > 1000.
      if (map.length > 1000) {
        final keys = map.keys.toList();
        for (var i = 0; i < map.length - 1000; i++) map.remove(keys[i]);
      }
      await _p?.setString('caller_id_map', jsonEncode(map));
    } catch (_) {
      await _p?.setString('caller_id_map', jsonEncode({key: info}));
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

    if (map.length > 1000) {
      final keys = map.keys.toList();
      for (var i = 0; i < map.length - 1000; i++) map.remove(keys[i]);
    }
    await _p?.setString('caller_id_map', jsonEncode(map));
  }

  // --- Pending incoming calls queue ---
  //
  // IncomingCallReceiver (Kotlin) appends dataid strings to
  // "flutter.pending_call_queue" (a JSON array) via PendingCallQueue.enqueue().
  // It uses .commit() (synchronous) so the value is on disk before the app
  // is brought to the foreground. We call reload() here to make Flutter's
  // in-memory cache pick up the natively-written value.

  static Future<List<int>> getPendingDataIds() async {
    await _p?.reload(); // flush native writes into Flutter's in-memory cache
    final raw = _p?.getString('pending_call_queue') ?? '[]';
    try {
      final list = jsonDecode(raw) as List;
      return list.map((e) => int.tryParse('$e')).whereType<int>().toList();
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
