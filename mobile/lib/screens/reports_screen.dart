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

// The backend interprets from/to as IST dates, so compute "today" in IST
// regardless of the device timezone (wall-clock shift; only the y/m/d matter).
DateTime _istNow() => DateTime.now().toUtc().add(const Duration(hours: 5, minutes: 30));

class _ReportsScreenState extends State<ReportsScreen> {
  Map<String, dynamic>? _data;
  bool _loading = true;
  String? _error;
  // Default range: today only (or pick a preset / custom dates below).
  DateTime _from = _istNow();
  DateTime _to = _istNow();
  String _preset = 'today'; // today | yesterday | month | lastMonth | custom
  int _recentFilter = 0; // 0=All, 1=Outgoing, 2=Incoming

  // Filter dropdown values for the current range (from the API response) and the
  // filters the user has applied (query-param key -> selected value).
  Map<String, dynamic>? _availableFilters;
  final Map<String, String> _filters = {};

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
      final d = await Api.reports(from: _fmt.format(_from), to: _fmt.format(_to), filters: _filters);
      if (!mounted) return;
      setState(() {
        _data = d;
        _availableFilters = d['availableFilters'] as Map<String, dynamic>?;
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
    final picked = await showDatePicker(context: context, initialDate: isFrom ? _from : _to, firstDate: DateTime(2025), lastDate: _istNow());
    if (picked == null) return;
    setState(() {
      _preset = 'custom';
      if (isFrom) {
        _from = picked;
      } else {
        _to = picked;
      }
    });
    _load();
  }

  // Midnight of "today" in IST (only y/m/d matter — the API reads these as IST).
  DateTime _istToday() {
    final n = _istNow();
    return DateTime(n.year, n.month, n.day);
  }

  void _applyPreset(String p) {
    Haptics.tap();
    if (p == 'custom') {
      setState(() => _preset = 'custom');
      return;
    }
    final today = _istToday();
    setState(() {
      _preset = p;
      if (p == 'today') {
        _from = today;
        _to = today;
      } else if (p == 'yesterday') {
        // Whole of the previous IST day — the shift most operators review first
        // thing in the morning. DateTime normalises the month/year rollover.
        final yesterday = today.subtract(const Duration(days: 1));
        _from = yesterday;
        _to = yesterday;
      } else if (p == 'month') {
        // 1st of the current month → today.
        _from = DateTime(today.year, today.month, 1);
        _to = today;
      } else if (p == 'lastMonth') {
        // 1st → last day of the previous month (DateTime normalises rollovers).
        final lastMonthEnd = DateTime(today.year, today.month, 1).subtract(const Duration(days: 1));
        _from = DateTime(lastMonthEnd.year, lastMonthEnd.month, 1);
        _to = lastMonthEnd;
      }
    });
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
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                _presetChip('Today', 'today'),
                _presetChip('Yesterday', 'yesterday'),
                _presetChip('This Month', 'month'),
                _presetChip('Last Month', 'lastMonth'),
                _presetChip('Custom', 'custom'),
              ],
            ),
            if (_preset == 'custom') ...[
              Gap.sm,
              Row(
                children: [
                  Expanded(child: OutlinedButton.icon(onPressed: () => _pick(true), icon: const Icon(Icons.calendar_today, size: 15), label: Text(_fmtNice.format(_from)))),
                  const Padding(padding: EdgeInsets.symmetric(horizontal: 8), child: Icon(Icons.arrow_forward, size: 16, color: AppColors.muted)),
                  Expanded(child: OutlinedButton.icon(onPressed: () => _pick(false), icon: const Icon(Icons.calendar_today, size: 15), label: Text(_fmtNice.format(_to)))),
                ],
              ),
            ],
            if (_availableFilters != null) ...[
              Gap.sm,
              _filterBar(),
            ],
            Gap.md,
            if (_loading)
              const Padding(padding: EdgeInsets.only(top: 60), child: Center(child: CircularProgressIndicator()))
            else if (_error != null)
              Padding(padding: const EdgeInsets.only(top: 40), child: EmptyState(icon: Icons.cloud_off, title: 'Could not load', subtitle: _error, action: FilledButton(onPressed: _load, child: const Text('Retry'))))
            else ...[
              Builder(builder: (context) {
                final total = (totals?['total'] as num?)?.toInt() ?? 0;
                final connected = (totals?['connected'] as num?)?.toInt() ?? (byStatus['Connected'] as num?)?.toInt() ?? 0;
                final rate = (totals?['connectRate'] as num?)?.toInt();
                final talkSecs = (totals?['talkSeconds'] as num?)?.toInt() ?? 0;
                final avgTalk = (totals?['avgTalkSeconds'] as num?)?.toInt();
                final respMins = (totals?['avgFirstCallMinutes'] as num?)?.toInt();
                return Column(children: [
                  Row(children: [
                    Expanded(
                      child: _stat('$total', 'Total calls', AppColors.ink, Icons.call,
                          sub: _fmt.format(_from) == _fmt.format(_to)
                              ? (_fmt.format(_from) == _fmt.format(_istNow()) ? 'Today' : _fmtNice.format(_from))
                              : '${_fmtNice.format(_from)} – ${_fmtNice.format(_to)}'),
                    ),
                    Gap.sm,
                    Expanded(
                      child: _stat(rate == null ? '—' : '$rate%', 'Calls answered', AppColors.success, Icons.check_circle,
                          sub: total == 0 ? 'No calls yet' : '$connected of $total picked up'),
                    ),
                  ]),
                  Gap.sm,
                  Row(children: [
                    Expanded(
                      child: _stat(_fmtTalk(talkSecs), 'Total talk time', AppColors.brand, Icons.timer_outlined,
                          sub: avgTalk == null ? 'Answered calls only' : 'Avg ${_fmtMmSs(avgTalk)} min per call'),
                    ),
                    Gap.sm,
                    Expanded(
                      child: _stat(respMins == null ? '—' : _fmtMins(respMins), 'Response speed', AppColors.warning, Icons.bolt,
                          sub: 'Complaint aane se pehli call tak'),
                    ),
                  ]),
                  Gap.sm,
                  Builder(builder: (context) {
                    final outgoing = (totals?['outgoing'] as num?)?.toInt() ?? 0;
                    final outConn = (totals?['outgoingConnected'] as num?)?.toInt() ?? 0;
                    final incoming = (totals?['incoming'] as num?)?.toInt() ?? 0;
                    final inConn = (totals?['incomingConnected'] as num?)?.toInt() ?? 0;
                    return Row(children: [
                      Expanded(
                        child: _stat('$outgoing', 'Outgoing calls', AppColors.success, Icons.call_made,
                            sub: outgoing == 0 ? 'None yet' : '$outConn connected'),
                      ),
                      Gap.sm,
                      Expanded(
                        child: _stat('$incoming', 'Incoming calls', AppColors.brand, Icons.call_received,
                            sub: incoming == 0 ? 'None yet' : '$inConn answered'),
                      ),
                    ]);
                  }),
                ]);
              }),
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
              Gap.xl,
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const SectionHeader('Recent calls'),
                  SegmentedButton<int>(
                    segments: const [
                      ButtonSegment(value: 0, label: Text('All')),
                      ButtonSegment(value: 1, label: Text('Outgoing')),
                      ButtonSegment(value: 2, label: Text('Incoming')),
                    ],
                    selected: {_recentFilter},
                    onSelectionChanged: (s) => setState(() => _recentFilter = s.first),
                    showSelectedIcon: false,
                    style: SegmentedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(horizontal: 12),
                      visualDensity: VisualDensity.compact,
                      textStyle: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
                    ),
                  ),
                ],
              ),
              Gap.sm,
              Builder(
                builder: (context) {
                  var filtered = recent.cast<Map<String, dynamic>>();
                  if (_recentFilter == 1) filtered = filtered.where((r) => r['is_incoming'] != true).toList();
                  if (_recentFilter == 2) filtered = filtered.where((r) => r['is_incoming'] == true).toList();

                  if (filtered.isEmpty) {
                    return Padding(padding: const EdgeInsets.only(top: 20), child: EmptyState(icon: Icons.history, title: 'No calls in this tab'));
                  }
                  return Column(children: filtered.map((r) => _recentTile(r, isManager)).toList());
                },
              ),
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

  // 105 -> "1h 45m", 45 -> "45 min"
  String _fmtMins(int mins) {
    if (mins < 60) return '$mins min';
    return '${mins ~/ 60}h ${mins % 60}m';
  }

  // 133 -> "2:13"
  String _fmtMmSs(int seconds) => '${seconds ~/ 60}:${(seconds % 60).toString().padLeft(2, '0')}';

  Widget _presetChip(String label, String value) {
    final selected = _preset == value;
    return ChoiceChip(
      label: Text(label),
      selected: selected,
      onSelected: (_) => _applyPreset(value),
      showCheckmark: false,
      backgroundColor: Colors.white,
      selectedColor: AppColors.brand,
      side: BorderSide(color: selected ? AppColors.brand : AppColors.border),
      labelStyle: TextStyle(
        fontSize: 13,
        fontWeight: FontWeight.w600,
        color: selected ? Colors.white : AppColors.inkSoft,
      ),
      visualDensity: VisualDensity.compact,
      materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
    );
  }

  // ---- filters ----

  // Filter dimensions available for the current range. Fixed dimensions
  // (direction, talk time) are always offered; data-driven ones only when the
  // range actually has 2+ distinct values (a 0/1-value filter does nothing).
  List<_FilterSpec> _buildSpecs(bool isManager) {
    final af = _availableFilters ?? const {};
    List<MapEntry<String, String>> strs(String k) =>
        (((af[k] as List?) ?? const []).map((e) => MapEntry('$e', '$e'))).toList();

    final specs = <_FilterSpec>[
      const _FilterSpec('direction', 'Direction', [MapEntry('outgoing', 'Outgoing'), MapEntry('incoming', 'Incoming')]),
      _FilterSpec('status', 'Call status', strs('callStatuses')),
      _FilterSpec('category', 'Problem category', strs('categories')),
      if (isManager)
        _FilterSpec('operator', 'Operator',
            (((af['operators'] as List?) ?? const []).map((o) => MapEntry('${o['id']}', '${o['name']}'))).toList()),
      const _FilterSpec('duration', 'Talk time', [MapEntry('lt30', '< 30 sec'), MapEntry('30to120', '30 sec – 2 min'), MapEntry('gt120', '> 2 min')]),
      _FilterSpec('division', 'Division', strs('divisions')),
      _FilterSpec('subDivision', 'Sub-division', strs('subDivisions')),
      _FilterSpec('feeder', 'Feeder', strs('feeders')),
      _FilterSpec('areaType', 'Area type', strs('areaTypes')),
      _FilterSpec('complaintType', 'Complaint type', strs('complaintTypes')),
      _FilterSpec('complaintStatus', 'Complaint status', strs('complaintStatuses')),
    ];
    const fixed = {'direction', 'duration'};
    return specs.where((s) => fixed.contains(s.key) || s.options.length >= 2).toList();
  }

  String _labelFor(String key, String value) {
    for (final s in _buildSpecs(widget.user.isManager)) {
      if (s.key != key) continue;
      for (final o in s.options) {
        if (o.key == value) return o.value;
      }
    }
    return value;
  }

  Widget _filterBar() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            OutlinedButton.icon(
              onPressed: _openFilterSheet,
              icon: const Icon(Icons.tune, size: 16),
              label: Text(_filters.isEmpty ? 'Filters' : 'Filters · ${_filters.length}'),
            ),
            if (_filters.isNotEmpty) ...[
              const SizedBox(width: 8),
              TextButton(
                onPressed: () {
                  Haptics.tap();
                  setState(_filters.clear);
                  _load();
                },
                child: const Text('Clear'),
              ),
            ],
          ],
        ),
        if (_filters.isNotEmpty) ...[
          Gap.xs,
          Wrap(spacing: 6, runSpacing: 6, children: _filters.entries.map((e) => _activeChip(e.key, e.value)).toList()),
        ],
      ],
    );
  }

  Widget _activeChip(String key, String value) {
    return InputChip(
      label: Text(_labelFor(key, value), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
      onDeleted: () {
        Haptics.tap();
        setState(() => _filters.remove(key));
        _load();
      },
      backgroundColor: AppColors.brand.withValues(alpha: 0.08),
      side: BorderSide(color: AppColors.brand.withValues(alpha: 0.35)),
      labelStyle: const TextStyle(color: AppColors.brand),
      deleteIconColor: AppColors.brand,
      visualDensity: VisualDensity.compact,
      materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
    );
  }

  void _openFilterSheet() {
    Haptics.tap();
    final specs = _buildSpecs(widget.user.isManager);
    final local = Map<String, String>.from(_filters);
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(18))),
      builder: (sheetCtx) {
        return StatefulBuilder(
          builder: (sheetCtx, setSheet) {
            return SafeArea(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 14, 16, 16),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        const Text('Filters', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: AppColors.ink)),
                        const Spacer(),
                        if (local.isNotEmpty)
                          TextButton(onPressed: () => setSheet(local.clear), child: const Text('Clear all')),
                      ],
                    ),
                    Flexible(
                      child: SingleChildScrollView(
                        child: Column(
                          children: [
                            for (final s in specs) _filterRow(sheetCtx, s, local, setSheet),
                          ],
                        ),
                      ),
                    ),
                    Gap.md,
                    SizedBox(
                      width: double.infinity,
                      child: FilledButton(
                        onPressed: () {
                          Navigator.pop(sheetCtx);
                          setState(() {
                            _filters
                              ..clear()
                              ..addAll(local);
                          });
                          _load();
                        },
                        child: const Text('Apply'),
                      ),
                    ),
                  ],
                ),
              ),
            );
          },
        );
      },
    );
  }

  Widget _filterRow(BuildContext sheetCtx, _FilterSpec s, Map<String, String> local, void Function(void Function()) setSheet) {
    final current = local[s.key];
    final currentLabel = current == null
        ? 'All'
        : s.options.firstWhere((o) => o.key == current, orElse: () => MapEntry(current, current)).value;
    return InkWell(
      onTap: () async {
        final picked = await _pickValue(sheetCtx, s.label, s.options, current);
        if (picked == null) return; // dismissed, no change
        setSheet(() {
          if (picked.isEmpty) {
            local.remove(s.key);
          } else {
            local[s.key] = picked;
          }
        });
      },
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 13),
        child: Row(
          children: [
            Expanded(child: Text(s.label, style: const TextStyle(fontWeight: FontWeight.w600, color: AppColors.ink))),
            Flexible(
              child: Text(currentLabel,
                  textAlign: TextAlign.right,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(color: current == null ? AppColors.muted : AppColors.brand, fontWeight: FontWeight.w600)),
            ),
            const Icon(Icons.chevron_right, size: 18, color: AppColors.muted),
          ],
        ),
      ),
    );
  }

  // Searchable single-select picker. Returns the chosen value, '' for "All"
  // (clear), or null if dismissed.
  Future<String?> _pickValue(BuildContext ctx, String title, List<MapEntry<String, String>> options, String? current) {
    return showModalBottomSheet<String>(
      context: ctx,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(18))),
      builder: (pickCtx) {
        String q = '';
        return StatefulBuilder(
          builder: (pickCtx, setSheet) {
            final ql = q.toLowerCase();
            final filtered = options.where((o) => o.value.toLowerCase().contains(ql)).toList();
            return Padding(
              padding: EdgeInsets.only(bottom: MediaQuery.of(pickCtx).viewInsets.bottom),
              child: SizedBox(
                height: MediaQuery.of(pickCtx).size.height * 0.6,
                child: Column(
                  children: [
                    const SizedBox(height: 14),
                    Text(title, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: AppColors.ink)),
                    if (options.length > 8)
                      Padding(
                        padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
                        child: TextField(
                          autofocus: true,
                          decoration: const InputDecoration(hintText: 'Search…', prefixIcon: Icon(Icons.search, size: 18)),
                          onChanged: (v) => setSheet(() => q = v),
                        ),
                      )
                    else
                      const SizedBox(height: 8),
                    Expanded(
                      child: ListView(
                        children: [
                          ListTile(
                            title: const Text('All'),
                            trailing: current == null ? const Icon(Icons.check, color: AppColors.brand) : null,
                            onTap: () => Navigator.pop(pickCtx, ''),
                          ),
                          const Divider(height: 1),
                          for (final o in filtered)
                            ListTile(
                              title: Text(o.value),
                              trailing: current == o.key ? const Icon(Icons.check, color: AppColors.brand) : null,
                              onTap: () => Navigator.pop(pickCtx, o.key),
                            ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            );
          },
        );
      },
    );
  }

  Widget _stat(String value, String label, Color color, IconData icon, {String? sub}) {
    return AppCard(
      padding: const EdgeInsets.all(12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            Icon(icon, size: 15, color: color),
            const SizedBox(width: 5),
            Expanded(
              child: Text(label, maxLines: 1, overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: AppColors.inkSoft)),
            ),
          ]),
          const SizedBox(height: 8),
          Text(value, style: TextStyle(fontSize: 24, fontWeight: FontWeight.w800, color: color)),
          if (sub != null) ...[
            const SizedBox(height: 2),
            Text(sub, maxLines: 2, style: const TextStyle(fontSize: 10.5, color: AppColors.muted)),
          ],
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
    final isIncoming = r['is_incoming'] == true;
    final glyph = callGlyph(isIncoming: isIncoming, connected: connected);
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
              Icon(glyph.icon, size: 15, color: glyph.color),
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

// A single filter dimension: its query-param key, display label, and the
// available options as (queryValue -> displayLabel) pairs.
class _FilterSpec {
  final String key;
  final String label;
  final List<MapEntry<String, String>> options;
  const _FilterSpec(this.key, this.label, this.options);
}
