import 'call_channel.dart';
import 'models.dart';
import 'sla.dart';
import 'storage.dart';

// After each complaints refresh, decide which local notifications to fire:
//  - new complaints since the last refresh,
//  - SLA about to expire on an uncalled complaint,
//  - retry due (last call didn't connect and enough time has passed).
// Runs fully on-device; no server push needed while the app is running.
class Alerts {
  static const _slaWarn = Duration(minutes: 15);
  static const _retryAfter = Duration(minutes: 15);
  static const _retryStatuses = {'No Answer', 'Switched Off', 'Busy'};

  static Future<void> check(List<Complaint> complaints) async {
    final now = DateTime.now();
    final currentIds = complaints.map((c) => c.dataid).toSet();
    final firstRun = !Store.alertsInitialized();

    // New complaints (skip the very first run: everything would be "new").
    if (!firstRun) {
      final seen = Store.seenIds();
      final fresh = complaints.where((c) => !seen.contains(c.dataid)).toList();
      if (fresh.length > 3) {
        await CallChannel.notify(100, '${fresh.length} new complaints', 'Open FRT Calling to start calling.');
      } else {
        for (final c in fresh) {
          await CallChannel.notify(
            100 + (c.dataid % 900),
            'New: ${c.complaintSubType ?? c.complaintType ?? 'Complaint'}',
            '${c.complaintNumber ?? '#${c.dataid}'} · ${c.area ?? ''} — not called yet',
          );
        }
      }
    }

    // SLA expiring soon on uncalled complaints (once per complaint).
    final overdueNotified = Store.overdueNotified();
    for (final c in complaints) {
      if (c.callCount > 0 || overdueNotified.contains(c.dataid)) continue;
      final dl = complaintDeadline(c);
      if (dl == null) continue;
      final rem = dl.difference(now);
      if (rem > Duration.zero && rem <= _slaWarn) {
        overdueNotified.add(c.dataid);
        await CallChannel.notify(
          2000 + (c.dataid % 900),
          'SLA warning · ${rem.inMinutes}m left',
          '${c.complaintNumber ?? '#${c.dataid}'} · ${c.area ?? ''} — not called yet',
        );
      }
    }

    // Retry due (once per failed attempt).
    final retryNotified = Store.retryNotified();
    for (final c in complaints) {
      if (!_retryStatuses.contains(c.lastCallStatus) || c.lastCallTime == null) continue;
      final last = DateTime.tryParse(c.lastCallTime!);
      if (last == null) continue;
      final key = '${c.dataid}:${c.lastCallTime}';
      if (now.difference(last) >= _retryAfter && !retryNotified.contains(key)) {
        retryNotified.add(key);
        await CallChannel.notify(
          3000 + (c.dataid % 900),
          'Retry: ${c.lastCallStatus}',
          '${c.complaintNumber ?? '#${c.dataid}'} · last tried ${now.difference(last).inMinutes}m ago',
        );
      }
    }

    // Persist, trimming bookkeeping to complaints still in the feed.
    await Store.setSeenIds(currentIds);
    await Store.setOverdueNotified(overdueNotified.intersection(currentIds));
    await Store.setRetryNotified(
      retryNotified.where((k) => currentIds.contains(int.tryParse(k.split(':').first) ?? -1)).toSet(),
    );
    if (firstRun) await Store.setAlertsInitialized();
  }
}
