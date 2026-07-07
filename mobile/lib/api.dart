import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart';

import 'config.dart';
import 'models.dart';

class ApiException implements Exception {
  final String message;
  ApiException(this.message);
  @override
  String toString() => message;
}

// Thin client over the Next.js /api endpoints. Every call carries the Supabase
// access token as a Bearer header (the backend's getSession() accepts it).
class Api {
  static SupabaseClient get _sb => Supabase.instance.client;

  static Future<Map<String, String>> _headers() async {
    var session = _sb.auth.currentSession;
    // On a cold start the restored access token can already be expired while
    // the SDK is still refreshing it in the background; sending it as-is 401s
    // the first request (seen on the Reports tab, which loads immediately).
    // Refresh proactively when it's expired or about to expire.
    final exp = session?.expiresAt;
    if (session != null && exp != null && DateTime.now().millisecondsSinceEpoch ~/ 1000 >= exp - 30) {
      try {
        await _sb.auth.refreshSession();
        session = _sb.auth.currentSession;
      } catch (_) {
        // Offline — send the stale token; the caller surfaces the error.
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
        throw ApiException(body['error']?.toString() ?? 'HTTP ${r.statusCode}');
      }
      return body;
    }
    throw ApiException('HTTP ${r.statusCode}');
  }

  static Future<Map<String, dynamic>> _get(String path) =>
      _send((h) => http.get(Uri.parse('${Config.apiBaseUrl}$path'), headers: h));
  static Future<Map<String, dynamic>> _post(String path, Map<String, dynamic> body) =>
      _send((h) => http.post(Uri.parse('${Config.apiBaseUrl}$path'), headers: h, body: jsonEncode(body)));
  static Future<Map<String, dynamic>> _patch(String path, Map<String, dynamic> body) =>
      _send((h) => http.patch(Uri.parse('${Config.apiBaseUrl}$path'), headers: h, body: jsonEncode(body)));

  static Future<SessionUser> me() async => SessionUser.fromJson((await _get('/api/auth/me'))['user']);

  // Raw JSON rows — the caller caches these for offline use.
  static Future<List<Map<String, dynamic>>> complaintsRaw({bool includeResolved = false}) async {
    final j = await _get('/api/calling/complaints${includeResolved ? '?include_resolved=1' : ''}');
    return (j['complaints'] as List).cast<Map<String, dynamic>>();
  }

  static Future<List<Complaint>> complaints() async =>
      (await complaintsRaw()).map(Complaint.fromJson).toList();

  static Future<List<Map<String, dynamic>>> callerIdCache() async {
    final j = await _get('/api/calling/contacts-cache');
    return (j['contacts'] as List).cast<Map<String, dynamic>>();
  }

  static Future<Map<String, dynamic>> sync() => _get('/api/calling/sync');

  static Future<Contact> contact(int dataid) async =>
      Contact.fromJson((await _get('/api/calling/contact?dataid=$dataid'))['contact']);

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
  static Future<void> logRaw(Map<String, dynamic> payload) async {
    await _post('/api/calling/log', payload);
  }

  // Every past call attempt on this complaint (all operators), newest first.
  static Future<List<Map<String, dynamic>>> callHistory(int dataid) async =>
      ((await _get('/api/calling/log?dataid=$dataid'))['logs'] as List).cast<Map<String, dynamic>>();

  // All complaints (active + closed) linked to a phone number.
  // Used to enrich the caller-ID overlay with complaint history.
  static Future<Map<String, dynamic>> callerLookup(String mobile) =>
      _get('/api/calling/caller-lookup?mobile=$mobile');

  // Soft-claim before calling so two operators don't ring the same consumer.
  // Returns {'claimed': bool, 'claimed_by_name': ...} — advisory only.
  static Future<Map<String, dynamic>> claim(int dataid) => _post('/api/calling/claim', {'dataid': dataid});

  static Future<void> release(int dataid) async {
    try {
      await _post('/api/calling/claim', {'dataid': dataid, 'release': true});
    } catch (_) {
      // Best effort — a stale claim expires on its own in ~3 minutes.
    }
  }

  static Future<Map<String, dynamic>> reports({String? from, String? to}) {
    final q = [if (from != null) 'from=$from', if (to != null) 'to=$to'];
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
