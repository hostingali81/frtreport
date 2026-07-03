import 'package:flutter_test/flutter_test.dart';

import 'package:frt_calling/models.dart';
import 'package:frt_calling/sla.dart';

void main() {
  test('SLA window: Urban = 1h, Rural = 2h', () {
    final now = DateTime.parse('2026-07-02T10:30:00+05:30');
    final rural = Complaint(dataid: 1, areaType: 'Rural', complaintDate: '2026-07-02T09:00:00+05:30');
    final urban = Complaint(dataid: 2, areaType: 'Urban', complaintDate: '2026-07-02T09:00:00+05:30');

    // Rural 2h window: deadline 11:00 -> 30m left (not overdue).
    expect(slaFor(rural, now).text.contains('left'), isTrue);
    expect(slaFor(rural, now).overdue, isFalse);
    // Urban 1h window: deadline 10:00 -> overdue by 30m.
    expect(slaFor(urban, now).overdue, isTrue);
  });

  test('formatDur renders H:MM:SS', () {
    expect(formatDur(const Duration(hours: 1, minutes: 5, seconds: 9)), '1:05:09');
  });
}
