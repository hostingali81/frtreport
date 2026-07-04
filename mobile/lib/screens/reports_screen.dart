import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../api.dart';
import '../models.dart';
import '../sla.dart';
import '../theme.dart';
import '../widgets.dart';

class ReportsScreen extends StatefulWidget {
  final SessionUser user;
  const ReportsScreen({super.key, required this.user});

  @override
  State<ReportsScreen> createState() => _ReportsScreenState();
}

class _ReportsScreenState extends State<ReportsScreen> {
  Map<String, dynamic>? _data;
  bool _loading = true;
  String? _error;
  DateTime _from = DateTime.now().subtract(const Duration(days: 6));
  DateTime _to = DateTime.now();

  final _fmt = DateFormat('yyyy-MM-dd');
  final _fmtNice = DateFormat('d MMM');

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final d = await Api.reports(from: _fmt.format(_from), to: _fmt.format(_to));
      if (!mounted) return;
      setState(() {
        _data = d;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = '$e';
        _loading = false;
      });
    }
  }

  Future<void> _pick(bool isFrom) async {
    Haptics.tap();
    final picked = await showDatePicker(context: context, initialDate: isFrom ? _from : _to, firstDate: DateTime(2025), lastDate: DateTime.now());
    if (picked == null) return;
    setState(() => isFrom ? _from = picked : _to = picked);
    _load();
  }

  @override
  Widget build(BuildContext context) {
    final isManager = widget.user.isManager;
    final totals = _data?['totals'] as Map<String, dynamic>?;
    final byStatus = (totals?['byStatus'] as Map<String, dynamic>?) ?? {};
    final operators = (_data?['operators'] as List?) ?? [];
    final recent = (_data?['recent'] as List?) ?? [];

    return Scaffold(
      appBar: AppBar(title: Text(isManager ? 'Call Report' : 'My Calls')),
      body: RefreshIndicator(
        onRefresh: () {
          Haptics.light();
          return _load();
        },
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Row(
              children: [
                Expanded(child: OutlinedButton.icon(onPressed: () => _pick(true), icon: const Icon(Icons.calendar_today, size: 15), label: Text(_fmtNice.format(_from)))),
                const Padding(padding: EdgeInsets.symmetric(horizontal: 8), child: Icon(Icons.arrow_forward, size: 16, color: AppColors.muted)),
                Expanded(child: OutlinedButton.icon(onPressed: () => _pick(false), icon: const Icon(Icons.calendar_today, size: 15), label: Text(_fmtNice.format(_to)))),
              ],
            ),
            Gap.md,
            if (_loading)
              const Padding(padding: EdgeInsets.only(top: 60), child: Center(child: CircularProgressIndicator()))
            else if (_error != null)
              Padding(padding: const EdgeInsets.only(top: 40), child: EmptyState(icon: Icons.cloud_off, title: 'Could not load', subtitle: _error, action: FilledButton(onPressed: _load, child: const Text('Retry'))))
            else ...[
              Row(
                children: [
                  Expanded(child: _stat('${totals?['total'] ?? 0}', 'Total calls', AppColors.ink, Icons.call)),
                  Gap.sm,
                  Expanded(
                    child: _stat(
                      '${totals?['connected'] ?? byStatus['Connected'] ?? 0}',
                      totals?['connectRate'] != null ? 'Connected · ${totals!['connectRate']}%' : 'Connected',
                      AppColors.success,
                      Icons.check_circle,
                    ),
                  ),
                ],
              ),
              Gap.sm,
              Row(
                children: [
                  Expanded(child: _stat(_fmtTalk((totals?['talkSeconds'] as num?)?.toInt() ?? 0), 'Talk time', AppColors.brand, Icons.timer_outlined)),
                  Gap.sm,
                  Expanded(
                    child: _stat(
                      totals?['avgFirstCallMinutes'] == null ? '—' : '${totals!['avgFirstCallMinutes']}m',
                      'Avg. first call',
                      AppColors.warning,
                      Icons.bolt,
                    ),
                  ),
                ],
              ),
              if (byStatus.isNotEmpty) ...[
                Gap.md,
                Wrap(spacing: 6, runSpacing: 6, children: byStatus.entries.map((e) => Pill('${e.key} · ${e.value}', bg: const Color(0xFFEFF2F7))).toList()),
              ],
              if (isManager) ...[
                Gap.xl,
                const SectionHeader('By operator'),
                _operatorList(operators),
              ],
              Gap.xl,
              const SectionHeader('Recent calls'),
              if (recent.isEmpty)
                Padding(padding: const EdgeInsets.only(top: 20), child: EmptyState(icon: Icons.history, title: 'No calls in this range'))
              else
                ...recent.map((r) => _recentTile(r as Map<String, dynamic>, isManager)),
            ],
          ],
        ),
      ),
    );
  }

  String _fmtTalk(int seconds) {
    if (seconds <= 0) return '0m';
    final h = seconds ~/ 3600;
    final m = (seconds % 3600) ~/ 60;
    if (h > 0) return '${h}h ${m}m';
    if (m > 0) return '${m}m';
    return '${seconds}s';
  }

  Widget _stat(String value, String label, Color color, IconData icon) {
    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [Icon(icon, size: 16, color: color), const Spacer()]),
          const SizedBox(height: 6),
          Text(value, style: TextStyle(fontSize: 26, fontWeight: FontWeight.w800, color: color)),
          Text(label, style: const TextStyle(fontSize: 12, color: AppColors.muted)),
        ],
      ),
    );
  }

  Widget _operatorList(List operators) {
    if (operators.isEmpty) {
      return Padding(padding: const EdgeInsets.symmetric(vertical: 16), child: EmptyState(icon: Icons.people_outline, title: 'No calls in this range'));
    }
    final maxTotal = operators.map((o) => (o['total'] as num?)?.toInt() ?? 0).fold<int>(1, (a, b) => a > b ? a : b);
    return AppCard(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Column(
        children: [
          for (final o in operators) _operatorRow(o as Map<String, dynamic>, maxTotal),
        ],
      ),
    );
  }

  Widget _operatorRow(Map<String, dynamic> o, int maxTotal) {
    final total = (o['total'] as num?)?.toInt() ?? 0;
    final connected = (o['connected'] as num?)?.toInt() ?? 0;
    final talk = (o['talk_seconds'] as num?)?.toInt() ?? 0;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            Expanded(child: Text('${o['operator'] ?? 'Unknown'}', style: const TextStyle(fontWeight: FontWeight.w600, color: AppColors.ink))),
            Text('$connected/$total${talk > 0 ? ' · ${_fmtTalk(talk)}' : ''}', style: const TextStyle(fontSize: 12, color: AppColors.inkSoft)),
          ]),
          const SizedBox(height: 6),
          ClipRRect(
            borderRadius: BorderRadius.circular(4),
            child: Stack(children: [
              Container(height: 6, color: const Color(0xFFEFF2F7)),
              FractionallySizedBox(widthFactor: (total / maxTotal).clamp(0.02, 1.0), child: Container(height: 6, color: AppColors.brand)),
            ]),
          ),
        ],
      ),
    );
  }

  Widget _recentTile(Map<String, dynamic> r, bool showOperator) {
    final connected = r['connected'] == true || r['call_status'] == 'Connected';
    final secs = (r['duration_seconds'] as num?)?.toInt();
    final dur = secs != null && secs > 0 ? '${secs ~/ 60}:${(secs % 60).toString().padLeft(2, '0')}' : null;
    // The app prefixes notes with "Call m:ss" — strip it here since the
    // duration is shown as its own chip.
    var notes = ('${r['notes'] ?? ''}').replaceFirst(RegExp(r'^Call \d+:\d{2}\s*(·\s*)?'), '').trim();
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      child: AppCard(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(children: [
              Icon(connected ? Icons.call_made : Icons.call_missed, size: 14, color: connected ? AppColors.success : AppColors.muted),
              const SizedBox(width: 6),
              Expanded(child: Text('${r['complaint_number'] ?? '—'}', style: const TextStyle(fontFamily: 'monospace', fontSize: 12.5, color: AppColors.ink))),
              Text(fmtDateTime(r['call_time']), style: const TextStyle(fontSize: 11, color: AppColors.muted)),
            ]),
            const SizedBox(height: 4),
            Row(children: [
              Expanded(
                child: Text(
                  [r['call_status'] ?? '', if (r['problem_category'] != null) '· ${r['problem_category']}', if (showOperator && r['operator'] != null) '· ${r['operator']}'].join(' '),
                  style: TextStyle(fontSize: 12, color: connected ? AppColors.success : AppColors.inkSoft),
                ),
              ),
              if (dur != null)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                  decoration: BoxDecoration(color: AppColors.brand.withValues(alpha: 0.10), borderRadius: BorderRadius.circular(6)),
                  child: Row(mainAxisSize: MainAxisSize.min, children: [
                    const Icon(Icons.timer_outlined, size: 11, color: AppColors.brand),
                    const SizedBox(width: 3),
                    Text(dur, style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: AppColors.brand)),
                  ]),
                ),
            ]),
            if (notes.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 5),
                child: Container(
                  width: double.infinity,
                  padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 6),
                  decoration: BoxDecoration(color: const Color(0xFFF6F7FB), borderRadius: BorderRadius.circular(7)),
                  child: Text('"$notes"', maxLines: 3, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12, fontStyle: FontStyle.italic, color: AppColors.inkSoft)),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
