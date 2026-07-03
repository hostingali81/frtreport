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

  static Map<String, String> _headers() {
    final token = _sb.auth.currentSession?.accessToken;
    return {
      'Content-Type': 'application/json',
      if (token != null) 'Authorization': 'Bearer $token',
    };
  }

  static Map<String, dynamic> _decode(http.Response r) {
    dynamic body;
    try {
      body = jsonDecode(r.body);
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

  static Future<Map<String, dynamic>> _get(String path) async =>
      _decode(await http.get(Uri.parse('${Config.apiBaseUrl}$path'), headers: _headers()));
  static Future<Map<String, dynamic>> _post(String path, Map<String, dynamic> body) async =>
      _decode(await http.post(Uri.parse('${Config.apiBaseUrl}$path'), headers: _headers(), body: jsonEncode(body)));
  static Future<Map<String, dynamic>> _patch(String path, Map<String, dynamic> body) async =>
      _decode(await http.patch(Uri.parse('${Config.apiBaseUrl}$path'), headers: _headers(), body: jsonEncode(body)));

  static Future<SessionUser> me() async => SessionUser.fromJson((await _get('/api/auth/me'))['user']);

  static Future<List<Complaint>> complaints() async {
    final j = await _get('/api/calling/complaints');
    return (j['complaints'] as List).map((e) => Complaint.fromJson(e as Map<String, dynamic>)).toList();
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
  }) async {
    await _post('/api/calling/log', {
      'dataid': dataid,
      'complaint_number': complaintNumber,
      'call_status': callStatus,
      'problem_category': problemCategory,
      'notes': notes,
    });
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
