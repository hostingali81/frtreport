import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import 'models.dart';

// Format an FRT ISO timestamp (…+05:30) as IST wall-clock, regardless of device
// timezone.
String fmtDateTime(String? iso) {
  if (iso == null) return '—';
  final d = DateTime.tryParse(iso);
  if (d == null) return '—';
  final ist = d.toUtc().add(const Duration(hours: 5, minutes: 30));
  return DateFormat('d MMM, h:mm a').format(ist);
}

// SLA resolution window: Urban = 1 hour, Rural (default) = 2 hours. Deadline =
// complaint time + that window. (Ported from the FRT timer extension / web app.)
const _warning = Duration(minutes: 15);

DateTime? complaintDeadline(Complaint c) {
  if (c.deadlineMs == (1 << 62)) return null;
  return DateTime.fromMillisecondsSinceEpoch(c.deadlineMs);
}

String formatDur(Duration d) {
  final s = d.inSeconds.abs();
  final h = s ~/ 3600;
  final m = (s % 3600) ~/ 60;
  final sec = s % 60;
  return '$h:${m.toString().padLeft(2, '0')}:${sec.toString().padLeft(2, '0')}';
}

String elapsedLabel(String? iso, DateTime now) {
  if (iso == null) return '';
  final t = DateTime.tryParse(iso);
  if (t == null) return '';
  final m = now.difference(t).inMinutes;
  if (m < 1) return 'just now';
  if (m < 60) return '${m}m ago';
  final h = m ~/ 60;
  if (h < 24) return '${h}h ${m % 60}m ago';
  return '${h ~/ 24}d ago';
}

class Sla {
  final String text;
  final Color bg;
  final Color fg;
  final bool overdue;
  const Sla(this.text, this.bg, this.fg, this.overdue);
}

Sla slaFor(Complaint c, DateTime now) {
  final dl = complaintDeadline(c);
  if (dl == null) {
    return const Sla('N/A', Color(0xFFF1F5F9), Color(0xFF64748B), false);
  }
  final rem = dl.difference(now);
  if (rem.isNegative) {
    return Sla('Overdue ${formatDur(rem)}', const Color(0xFFFEE2E2), const Color(0xFFB91C1C), true);
  }
  if (rem < _warning) {
    return Sla('${formatDur(rem)} left', const Color(0xFFFEF3C7), const Color(0xFF92400E), false);
  }
  return Sla('${formatDur(rem)} left', const Color(0xFFD1FAE5), const Color(0xFF065F46), false);
}

// Urgent = SLA deadline ascending (most overdue / least time left first; no-date
// sinks to the bottom). Newest = complaint date descending.
int compareUrgent(Complaint a, Complaint b) {
  return a.deadlineMs.compareTo(b.deadlineMs);
}

int compareNewest(Complaint a, Complaint b) {
  return b.complaintDateMs.compareTo(a.complaintDateMs);
}

Color statusColor(String? status) {
  switch (status) {
    case 'FRT Assigned':
      return const Color(0xFFB45309);
    case 'Acknowledged by FRT':
      return const Color(0xFF0369A1);
    case 'In Progress':
      return const Color(0xFF4338CA);
    case 'Activity Completed':
      return const Color(0xFF047857);
    default:
      return const Color(0xFF64748B);
  }
}
