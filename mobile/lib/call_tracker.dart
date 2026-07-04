import 'dart:async';

import 'package:flutter/services.dart';

import 'call_channel.dart';

class CallOutcome {
  final Duration duration;
  final bool likelyConnected;
  CallOutcome(this.duration, this.likelyConnected);
}

// Watches the device call state for an outgoing tap-to-call: OFFHOOK marks the
// call active, the next IDLE marks it ended and yields the wall duration
// (dial + ring + talk). The exact post-pickup duration comes afterwards from
// the device call log (CallChannel.lastOutgoingCall); the >= 10s heuristic is
// only the fallback when READ_CALL_LOG is unavailable.
class CallTracker {
  static const _channel = EventChannel('frt/call_state');
  StreamSubscription<dynamic>? _sub;
  DateTime? _offhookAt;
  bool _sawOffhook = false;

  Future<bool> ensurePermission() async {
    final perms = await CallChannel.ensureCallPermissions();
    return perms.phoneState;
  }

  void start(void Function(CallOutcome) onEnded) {
    stop();
    _sawOffhook = false;
    _offhookAt = null;
    _sub = _channel.receiveBroadcastStream().listen((event) {
      final s = '$event';
      if (s == 'OFFHOOK') {
        _sawOffhook = true;
        _offhookAt ??= DateTime.now();
      } else if (s == 'IDLE' && _sawOffhook) {
        final dur = _offhookAt == null ? Duration.zero : DateTime.now().difference(_offhookAt!);
        onEnded(CallOutcome(dur, dur.inSeconds >= 10));
        stop();
      }
    });
  }

  void stop() {
    _sub?.cancel();
    _sub = null;
  }
}
