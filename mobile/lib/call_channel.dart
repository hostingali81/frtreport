import 'package:flutter/services.dart';

// Dart wrapper over the native `frt/call` MethodChannel (see MainActivity.kt).
// Every call is defensive: if the native side is missing or throws, we return
// a safe default so the calling flow degrades to the plain tel: behavior.

class PhoneAccount {
  final String id;
  final String label;
  PhoneAccount(this.id, this.label);
}

class NativeCallLogEntry {
  final int durationSeconds;
  final int dateMillis;
  NativeCallLogEntry(this.durationSeconds, this.dateMillis);

  // Outgoing-call duration only counts after pickup, so > 0 = really answered.
  bool get answered => durationSeconds > 0;
}

class CallPermissions {
  final bool phoneState;
  final bool callPhone;
  final bool callLog;
  final bool notifications;
  CallPermissions({this.phoneState = false, this.callPhone = false, this.callLog = false, this.notifications = false});

  factory CallPermissions.fromMap(Map<dynamic, dynamic>? m) => CallPermissions(
        phoneState: m?['phoneState'] == true,
        callPhone: m?['callPhone'] == true,
        callLog: m?['callLog'] == true,
        notifications: m?['notifications'] == true,
      );
}

class CallChannel {
  static const _ch = MethodChannel('frt/call');

  // Current grant status without prompting.
  static Future<CallPermissions> permissions() async {
    try {
      return CallPermissions.fromMap(await _ch.invokeMethod<Map<dynamic, dynamic>>('getPermissions'));
    } catch (_) {
      return CallPermissions();
    }
  }

  // Requests phone/call-log/notification permissions (one system dialog).
  static Future<CallPermissions> ensureCallPermissions() async {
    try {
      return CallPermissions.fromMap(await _ch.invokeMethod<Map<dynamic, dynamic>>('ensureCallPermissions'));
    } catch (_) {
      return CallPermissions();
    }
  }

  static Future<List<PhoneAccount>> phoneAccounts() async {
    try {
      final list = await _ch.invokeMethod<List<dynamic>>('getPhoneAccounts');
      return (list ?? [])
          .whereType<Map<dynamic, dynamic>>()
          .map((m) => PhoneAccount('${m['id']}', '${m['label']}'))
          .toList();
    } catch (_) {
      return [];
    }
  }

  // True if the call was placed natively (ACTION_CALL — no extra dialer tap).
  static Future<bool> directCall(String number, {String? accountId}) async {
    try {
      return await _ch.invokeMethod<bool>('directCall', {'number': number, 'accountId': accountId}) ?? false;
    } catch (_) {
      return false;
    }
  }

  static Future<bool> canDrawOverlays() async {
    try {
      return await _ch.invokeMethod<bool>('canDrawOverlays') ?? false;
    } catch (_) {
      return false;
    }
  }

  static Future<void> requestOverlayPermission() async {
    try {
      await _ch.invokeMethod('requestOverlayPermission');
    } catch (_) {}
  }

  // Foreground service for the duration of the call: keeps tracking alive,
  // shows the info bubble, brings the app back when the call ends.
  static Future<void> startCallMonitor({required String line1, String line2 = ''}) async {
    try {
      await _ch.invokeMethod('startCallMonitor', {'line1': line1, 'line2': line2});
    } catch (_) {}
  }

  static Future<void> stopCallMonitor() async {
    try {
      await _ch.invokeMethod('stopCallMonitor');
    } catch (_) {}
  }

  static Future<NativeCallLogEntry?> lastOutgoingCall(String number) async {
    try {
      final m = await _ch.invokeMethod<Map<dynamic, dynamic>>('getLastOutgoingCall', {'number': number});
      if (m == null) return null;
      return NativeCallLogEntry((m['durationSeconds'] as num?)?.toInt() ?? 0, (m['dateMillis'] as num?)?.toInt() ?? 0);
    } catch (_) {
      return null;
    }
  }

  // Local heads-up notification (new complaint / SLA warning / retry due).
  static Future<void> notify(int id, String title, String body) async {
    try {
      await _ch.invokeMethod('notify', {'id': id, 'title': title, 'body': body});
    } catch (_) {}
  }
}
