import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart';

import 'config.dart';
import 'db.dart';
import 'models.dart';

class ApiException implements Exception {
  final String message;
  final int? statusCode;
  ApiException(this.message, {this.statusCode});

  // Worth retrying later: server-side hiccups (5xx), auth that may recover
  // after a token refresh (401), timeouts and rate limits. Everything else
  // (validation 4xx) is a permanent rejection.
  bool get retryable =>
      statusCode == null || statusCode! >= 500 || statusCode == 401 || statusCode == 408 || statusCode == 429;

  @override
  String toString() => message;
}

// Thin client over the Next.js /api endpoints. Every call carries the Supabase
// access token as a Bearer header (the backend's getSession() accepts it).
//
// The read-only calls below now go straight to Supabase through [Db] and keep
// their /api route only as a fallback — see db.dart for why. What still has to
// go through Vercel is anything needing a secret or a live FRT scrape: contact,
// sync, the call log POST, reports, auth and admin.
class Api {
  static SupabaseClient get _sb => Supabase.instance.client;
  static DateTime? _lastRefreshAttempt;

  // Direct Supabase first, the HTTP route as the safety net: a missing policy,
  // a deactivated profile or a database that has not had migration
  // 20260903120000 applied all land back on the route the app always used.
  static Future<T> _preferDirect<T>(
    Future<T> Function() direct,
    Future<T> Function() viaApi,
  ) async {
    if (await Db.ready()) {
      try {
        return await direct();
      } catch (_) {
        // Fall through to the API rather than failing the screen.
      }
    }
    return viaApi();
  }

  static Future<Map<String, String>> _headers() async {
    var session = _sb.auth.currentSession;
    // On a cold start the restored access token can already be expired while
    // the SDK is still refreshing it in the background; sending it as-is 401s
    // the first request (seen on the Reports tab, which loads immediately).
    // Refresh proactively when it's expired or about to expire. Throttled to
    // once per 30s so a device with a fast-running clock (token "always about
    // to expire") doesn't hammer Supabase on every request.
    final exp = session?.expiresAt;
    if (session != null && exp != null && DateTime.now().millisecondsSinceEpoch ~/ 1000 >= exp - 30) {
      final last = _lastRefreshAttempt;
      if (last == null || DateTime.now().difference(last) > const Duration(seconds: 30)) {
        _lastRefreshAttempt = DateTime.now();
        try {
          await _sb.auth.refreshSession();
          session = _sb.auth.currentSession;
        } catch (_) {
          // Offline — send the stale token; the caller surfaces the error.
        }
      }
    }
    final token = session?.accessToken;
    return {
      'Content-Type': 'application/json',
      if (token != null) 'Authorization': 'Bearer $token',
    };
  }

  // Runs a request; on 401 refreshes the session once and retries, so a token
  // that expired mid-flight doesn't bubble up as an error to the operator.
  static Future<Map<String, dynamic>> _send(Future<http.Response> Function(Map<String, String> headers) run) async {
    var r = await run(await _headers());
    if (r.statusCode == 401 && _sb.auth.currentSession != null) {
      try {
        await _sb.auth.refreshSession();
      } catch (_) {}
      r = await run(await _headers());
    }
    return _decode(r);
  }

  static Map<String, dynamic> _decode(http.Response r) {
    dynamic body;
    try {
      // Decode as UTF-8 explicitly: the API omits the charset header, and the
      // http package then defaults to latin1 — garbling Hindi notes and '·'.
      body = jsonDecode(utf8.decode(r.bodyBytes));
    } catch (_) {
      body = null;
    }
    if (body is Map<String, dynamic>) {
      if (body['success'] == false || r.statusCode >= 400) {
        throw ApiException(body['error']?.toString() ?? 'HTTP ${r.statusCode}', statusCode: r.statusCode);
      }
      return body;
    }
    // Non-JSON body (Vercel error page, proxy timeout, …) — keep the status so
    // the offline outbox can tell a transient 5xx from a permanent rejection.
    throw ApiException('HTTP ${r.statusCode}', statusCode: r.statusCode);
  }

  static Future<Map<String, dynamic>> _get(String path) =>
      _send((h) => http.get(Uri.parse('${Config.apiBaseUrl}$path'), headers: h));
  static Future<Map<String, dynamic>> _post(String path, Map<String, dynamic> body) =>
      _send((h) => http.post(Uri.parse('${Config.apiBaseUrl}$path'), headers: h, body: jsonEncode(body)));
  static Future<Map<String, dynamic>> _patch(String path, Map<String, dynamic> body) =>
      _send((h) => http.patch(Uri.parse('${Config.apiBaseUrl}$path'), headers: h, body: jsonEncode(body)));

  static Future<SessionUser> me() async => SessionUser.fromJson((await _get('/api/auth/me'))['user']);

  // Raw JSON rows — the caller caches these for offline use.
  static Future<List<Map<String, dynamic>>> complaintsRaw({bool includeResolved = false}) =>
      _preferDirect(
        () => Db.liveComplaints(includeResolved: includeResolved),
        () async {
          final j = await _get('/api/calling/complaints${includeResolved ? '?include_resolved=1' : ''}');
          return (j['complaints'] as List).cast<Map<String, dynamic>>();
        },
      );

  static Future<List<Complaint>> complaints() async =>
      (await complaintsRaw()).map(Complaint.fromJson).toList();

  static Future<List<Map<String, dynamic>>> callerIdCache() => _preferDirect(
        Db.callerIdCache,
        () async {
          final j = await _get('/api/calling/contacts-cache');
          return (j['contacts'] as List).cast<Map<String, dynamic>>();
        },
      );

  static Future<Map<String, dynamic>> sync() => _get('/api/calling/sync');

  // A contact that has already been fetched is a plain Supabase row, so read it
  // directly; only a genuine cache miss needs the route, whose reason to exist
  // is logging in to FRT.
  static Future<Contact> contact(int dataid) async {
    if (await Db.ready()) {
      try {
        final cached = await Db.cachedContact(dataid);
        if (cached != null) return Contact.fromJson(cached);
      } catch (_) {
        // Fall through to the route rather than failing the sheet.
      }
    }
    return Contact.fromJson((await _get('/api/calling/contact?dataid=$dataid'))['contact']);
  }

  // One complaint by dataid — a single fast lookup for the incoming-call flow
  // (vs pulling the whole grid). Works for resolved complaints too.
  static Future<Complaint> complaintById(int dataid) async => Complaint.fromJson(
        await _preferDirect(
          () => Db.complaintById(dataid),
          () async => (await _get('/api/calling/complaint?dataid=$dataid'))['complaint']
              as Map<String, dynamic>,
        ),
      );

  static Future<void> log({
    required int dataid,
    String? complaintNumber,
    required String callStatus,
    String? problemCategory,
    String? notes,
    int? durationSeconds,
    bool? connected,
    bool? isIncoming,
  }) async {
    await logRaw({
      'dataid': dataid,
      'complaint_number': complaintNumber,
      'call_status': callStatus,
      'problem_category': problemCategory,
      'notes': notes,
      'duration_seconds': durationSeconds,
      'connected': connected,
      'is_incoming': isIncoming,
    });
  }

  // Same POST with a ready payload — used by the offline outbox on retry.
  //
  // This one does NOT use _preferDirect. A blanket catch is fine for reads and
  // for the idempotent claim, but a log insert must never run twice: if the
  // direct write commits and only the response is lost, retrying through the
  // route would file the operator's call a second time. So the fallback happens
  // only when the server answered — a PostgrestException, or the RPC's own
  // {success:false} — which means nothing was written. A socket error or
  // timeout is ambiguous and propagates instead, leaving it to the offline
  // outbox exactly as before.
  static Future<void> logRaw(Map<String, dynamic> payload) async {
    if (await Db.ready()) {
      try {
        final r = await Db.logCall(payload);
        if (r['success'] == true) return;
      } on PostgrestException catch (_) {
        // Refused by the server, so nothing landed — the route can retry and
        // will also refresh an expired token on the way.
      }
    }
    await _post('/api/calling/log', payload);
  }

  // Every past call attempt on this complaint (all operators), newest first.
  static Future<List<Map<String, dynamic>>> callHistory(int dataid) => _preferDirect(
        () => Db.callHistory(dataid),
        () async =>
            ((await _get('/api/calling/log?dataid=$dataid'))['logs'] as List).cast<Map<String, dynamic>>(),
      );

  // All complaints (active + closed) linked to a phone number.
  // Used to enrich the caller-ID overlay with complaint history.
  static Future<Map<String, dynamic>> callerLookup(String mobile) => _preferDirect(
        () => Db.callerLookup(mobile),
        () => _get('/api/calling/caller-lookup?mobile=$mobile'),
      );

  // Soft-claim before calling so two operators don't ring the same consumer.
  // Returns {'claimed': bool, 'claimed_by_name': ...} — advisory only.
  static Future<Map<String, dynamic>> claim(int dataid) => _preferDirect(
        () => Db.claim(dataid),
        () => _post('/api/calling/claim', {'dataid': dataid}),
      );

  static Future<void> release(int dataid) async {
    try {
      await _preferDirect(
        () => Db.claim(dataid, release: true),
        () => _post('/api/calling/claim', {'dataid': dataid, 'release': true}),
      );
    } catch (_) {
      // Best effort — a stale claim expires on its own in ~3 minutes.
    }
  }

  static Future<Map<String, dynamic>> reports({String? from, String? to, Map<String, String>? filters}) {
    final q = <String>[
      if (from != null) 'from=$from',
      if (to != null) 'to=$to',
      if (filters != null)
        ...filters.entries
            .where((e) => e.value.isNotEmpty)
            .map((e) => '${e.key}=${Uri.encodeQueryComponent(e.value)}'),
    ];
    return _get('/api/calling/reports${q.isEmpty ? '' : '?${q.join('&')}'}');
  }

  static Future<void> updateProfileName(String displayName) =>
      _patch('/api/auth/profile', {'display_name': displayName});

  // Super-admin user management
  static Future<List<Map<String, dynamic>>> listUsers() async =>
      ((await _get('/api/admin/users'))['users'] as List).cast<Map<String, dynamic>>();
  static Future<void> createUser({required String email, required String password, required String role, String? displayName}) =>
      _post('/api/admin/users', {'email': email, 'password': password, 'role': role, 'display_name': displayName});
  static Future<void> patchUser(String id, Map<String, dynamic> changes) =>
      _patch('/api/admin/users', {'id': id, ...changes});
}
