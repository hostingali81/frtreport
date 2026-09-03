import 'package:supabase_flutter/supabase_flutter.dart';

// Direct Supabase reads — the same rows the /api/calling/* routes returned,
// fetched without the Vercel hop.
//
// Those routes existed only to hold the service-role key. The data always came
// out of this database, so the detour cost a function invocation per read and
// nothing else: the complaints list alone was ~48% of every invocation on the
// project, and a 30-second poll from one handset was enough to keep a Fluid
// instance alive around the clock. Migration 20260903120000 adds the RLS
// policies (`is_active_app_user()`) that let a signed-in, active operator read
// these tables directly, so the app talks to Supabase and Vercel keeps only the
// routes that need a secret or a scrape: contact, sync, cron, scrape, log POST.
//
// Every method returns exactly the JSON shape its old route returned, so the
// models and screens are unchanged — and api.dart falls back to the HTTP route
// if one of these throws, so a handset in the field keeps working even before
// the migration is applied.
class Db {
  static SupabaseClient get _sb => Supabase.instance.client;

  static String? _readyFor;
  static Future<bool>? _probe;
  static DateTime? _lastFailure;

  // A denied SELECT comes back as an empty list, not an error, so "did the
  // policies land?" cannot be answered from a data read. Reading our own
  // profile row can answer it: `profiles_read_own` arrives with this migration
  // and returns a row only for a signed-in, active user. One query per session
  // decides it; a failure is retried at most this often so an app running
  // against an un-migrated database doesn't probe on every read.
  static const _retryProbeAfter = Duration(minutes: 5);

  /// Whether direct reads will actually return rows for the current user.
  /// False before the migration is applied, for a deactivated profile, and
  /// while signed out — callers fall back to the /api routes in all three.
  static Future<bool> ready() async {
    final uid = _sb.auth.currentSession?.user.id;
    if (uid == null) {
      _readyFor = null;
      return false;
    }
    if (_readyFor == uid) return true;

    final failedAt = _lastFailure;
    if (failedAt != null && DateTime.now().difference(failedAt) < _retryProbeAfter) {
      return false;
    }
    return _probe ??= _runProbe(uid);
  }

  static Future<bool> _runProbe(String uid) async {
    try {
      final row = await _sb.from('profiles').select('id, active').eq('id', uid).maybeSingle();
      final ok = row != null && row['active'] == true;
      if (ok) {
        _readyFor = uid;
        _lastFailure = null;
      } else {
        _lastFailure = DateTime.now();
      }
      return ok;
    } catch (_) {
      _lastFailure = DateTime.now();
      return false;
    } finally {
      _probe = null;
    }
  }

  /// Forget the probe result — call on sign-out so the next user re-checks.
  static void reset() {
    _readyFor = null;
    _probe = null;
    _lastFailure = null;
  }

  // The live grid plus each complaint's call rollup, from the
  // live_complaints_calls view (the rollup used to be a second query and a JS
  // group-by inside /api/calling/complaints).
  static Future<List<Map<String, dynamic>>> liveComplaints({bool includeResolved = false}) async {
    var q = _sb.from('live_complaints_calls').select();
    if (!includeResolved) q = q.eq('still_in_feed', true);
    return await q.order('complaint_date', ascending: false).limit(1000);
  }

  // One complaint by dataid for the incoming-call form: the live view first,
  // then the main complaints table for a complaint that has left the feed.
  static Future<Map<String, dynamic>> complaintById(int dataid) async {
    final live = await _sb
        .from('live_complaints_calls')
        .select()
        .eq('dataid', dataid)
        .maybeSingle();
    if (live != null) return live;

    final c = await _sb
        .from('complaints')
        .select('dataid, complaint_number, complaint_type, complaint_sub_type, '
            'sub_station, area_type, feeder, complaint_date, status')
        .eq('dataid', dataid)
        .maybeSingle();
    if (c == null) throw Exception('Complaint not found');

    final logs = await _sb
        .from('call_logs')
        .select('call_status, problem_category, call_time')
        .eq('dataid', dataid)
        .order('call_time', ascending: false);
    final last = logs.isEmpty ? null : logs.first;

    return {
      'dataid': c['dataid'],
      'complaint_number': c['complaint_number'],
      'complaint_type': c['complaint_type'],
      'complaint_sub_type': c['complaint_sub_type'],
      'area': c['sub_station'],
      'area_type': c['area_type'],
      'feeder': c['feeder'],
      'complaint_date': c['complaint_date'],
      'action_status': c['status'],
      'still_in_feed': false,
      'call_count': logs.length,
      'last_call_status': last?['call_status'],
      'last_call_time': last?['call_time'],
      'last_call_category': last?['problem_category'],
    };
  }

  // Newest complaints that carry a mobile number, for the native caller-ID
  // banner. Column names are mapped to what the old route emitted.
  //
  // nullsFirst matters more than it looks. `idx_complaints_date_id` is
  // (complaint_date DESC, id DESC), and a DESC btree column is NULLS FIRST — so
  // the default NULLS LAST ordering cannot use it and Postgres falls back to a
  // parallel seq scan of all 188k rows: 27k buffers, 6.3k of them read from
  // disk, ~6s. Matching the index turns that into an index scan: 761 buffers,
  // no disk reads, ~99ms. `complaint_date` has no nulls (0 of 188,690), so the
  // two orderings are identical in what they return.
  static Future<List<Map<String, dynamic>>> callerIdCache() async {
    final rows = await _sb
        .from('complaints')
        .select('dataid, consumer_mobile, consumer_name, consumer_remarks, '
            'complaint_number, complaint_sub_type, sub_station, status, complaint_date')
        .not('consumer_mobile', 'is', null)
        .order('complaint_date', ascending: false, nullsFirst: true)
        .limit(1000);

    return rows
        .map((c) => <String, dynamic>{
              'dataid': c['dataid'],
              'mobile': c['consumer_mobile'],
              'consumer_name': c['consumer_name'],
              'remarks': c['consumer_remarks'],
              'complaint_number': c['complaint_number'],
              'complaint_sub_type': c['complaint_sub_type'],
              'area': c['sub_station'],
              'status': c['status'],
              'complaint_date': c['complaint_date'],
            })
        .toList();
  }

  // Every past attempt on one complaint, newest first.
  static Future<List<Map<String, dynamic>>> callHistory(int dataid) async {
    return await _sb
        .from('call_logs')
        .select('id, call_time, call_status, problem_category, notes, operator, '
            'duration_seconds, connected, is_incoming')
        .eq('dataid', dataid)
        .order('call_time', ascending: false)
        .limit(50);
  }

  // Complaint history for an incoming number. Only the newest row is rendered;
  // the exact count drives the "N complaints" line, so it comes from the
  // count header rather than a second page of rows.
  static Future<Map<String, dynamic>> callerLookup(String mobile) async {
    final digits = mobile.replaceAll(RegExp(r'\D'), '');
    final key = digits.length > 10 ? digits.substring(digits.length - 10) : digits;
    if (key.length < 10) throw Exception('Invalid mobile number');

    final since = DateTime.now().toUtc().subtract(const Duration(days: 30));
    final res = await _sb
        .from('complaints')
        .select('dataid, consumer_name, consumer_mobile, consumer_remarks, complaint_number, '
            'complaint_type, complaint_sub_type, sub_station, status, complaint_date')
        .inFilter('consumer_mobile', [key, '91$key', '+91$key', '0$key'])
        .gte('complaint_date', since.toIso8601String())
        .order('complaint_date', ascending: false)
        .limit(1)
        .count(CountOption.exact);

    final complaints = res.data
        .map((c) => <String, dynamic>{
              'dataid': c['dataid'] ?? 0,
              'consumer_name': c['consumer_name'] ?? '',
              'mobile': c['consumer_mobile'] ?? '',
              'remarks': c['consumer_remarks'] ?? '',
              'complaint_number': c['complaint_number'],
              'complaint_type': c['complaint_type'],
              'complaint_sub_type': c['complaint_sub_type'],
              'area': c['sub_station'],
              'action_status': c['status'],
              'complaint_date': c['complaint_date'],
              // The scraper stores closed complaints as 'Complaint Closed';
              // match any "closed" wording so history reads as Resolved.
              'still_in_feed': !'${c['status'] ?? ''}'.toLowerCase().contains('closed'),
            })
        .toList();

    return {'success': true, 'total_complaints': res.count, 'complaints': complaints};
  }

  // Soft claim. The RPC reads the operator's name from `profiles` (a client
  // cannot forge it) and locks the row, so unlike the old route the
  // check-then-write cannot race another operator.
  static Future<Map<String, dynamic>> claim(int dataid, {bool release = false}) async {
    final r = await _sb.rpc('claim_complaint', params: {
      'p_dataid': dataid,
      'p_release': release,
    });
    return Map<String, dynamic>.from(r as Map);
  }

  // The already-fetched consumer contact, or null if it was never fetched.
  //
  // Mirrors getCachedContact() on the server, including its one subtlety: the
  // report scraper pre-creates the complaints row with consumer data but never
  // writes crew, so a row WITHOUT crew_mobile is a miss, not a hit. Only the
  // on-tap FRT detail fetch fills crew in. Getting this wrong is what left the
  // crew fields empty once before.
  //
  // A miss still needs /api/calling/contact — that route logs in to FRT, which
  // needs credentials the app must never hold.
  static Future<Map<String, dynamic>?> cachedContact(int dataid) async {
    final c = await _sb
        .from('complaints')
        .select('dataid, consumer_name, consumer_mobile, consumer_address, '
            'landmark, consumer_remarks, sub_station, assigned_crew, crew_mobile')
        .eq('dataid', dataid)
        .maybeSingle();
    if (c == null || c['crew_mobile'] == null) return null;

    return {
      'dataid': c['dataid'],
      'consumer_name': c['consumer_name'],
      'mobile': c['consumer_mobile'],
      'address': c['consumer_address'],
      'landmark': c['landmark'],
      'remarks': c['consumer_remarks'],
      'substation': c['sub_station'],
      'assigned_crew': c['assigned_crew'],
      'crew_mobile': c['crew_mobile'],
    };
  }

  // Record a post-call outcome. The RPC takes the operator from `profiles`, so
  // the identity cannot be forged from the client and `call_logs` needs no
  // INSERT grant. It also drops the FK link for a complaint the scraper has not
  // stored yet (rather than losing the log) and releases this operator's claim,
  // exactly as the route did.
  static Future<Map<String, dynamic>> logCall(Map<String, dynamic> payload) async {
    final duration = payload['duration_seconds'];
    final r = await _sb.rpc('log_call', params: {
      'p_dataid': payload['dataid'],
      'p_call_status': payload['call_status'],
      'p_complaint_number': payload['complaint_number'],
      'p_problem_category': payload['problem_category'],
      'p_notes': payload['notes'],
      'p_duration_seconds': duration is int ? duration : int.tryParse('$duration'),
      'p_connected': payload['connected'],
      'p_is_incoming': payload['is_incoming'] ?? false,
    });
    return Map<String, dynamic>.from(r as Map);
  }
}
