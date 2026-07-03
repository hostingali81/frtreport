import 'dart:async';

import 'package:flutter/material.dart';

import '../api.dart';
import '../models.dart';
import '../sla.dart';
import '../theme.dart';
import '../widgets.dart';
import 'detail_sheet.dart';

class ComplaintsScreen extends StatefulWidget {
  const ComplaintsScreen({super.key});

  @override
  State<ComplaintsScreen> createState() => _ComplaintsScreenState();
}

class _ComplaintsScreenState extends State<ComplaintsScreen> {
  List<Complaint> _all = [];
  bool _loading = true;
  bool _syncing = false;
  String? _error;
  DateTime _now = DateTime.now();

  String _search = '';
  String? _statusFilter;
  String? _areaFilter;
  bool _hideCalled = false;
  String _sortBy = 'urgent';

  Timer? _tick;
  Timer? _poll;

  @override
  void initState() {
    super.initState();
    _load();
    _tick = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() => _now = DateTime.now());
    });
    _poll = Timer.periodic(const Duration(minutes: 3), (_) => _load());
  }

  @override
  void dispose() {
    _tick?.cancel();
    _poll?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final list = await Api.complaints();
      if (!mounted) return;
      setState(() {
        _all = list;
        _error = null;
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

  Future<void> _fetchLatest() async {
    Haptics.medium();
    setState(() => _syncing = true);
    try {
      await Api.sync();
      await _load();
      Haptics.success();
    } catch (e) {
      Haptics.error();
      if (mounted) {
        setState(() => _error = '$e');
        showSnack(context, 'Sync failed: $e', error: true);
      }
    } finally {
      if (mounted) setState(() => _syncing = false);
    }
  }

  List<String> get _areas => _all.map((c) => c.area).whereType<String>().toSet().toList()..sort();
  List<String> get _statuses => _all.map((c) => c.actionStatus).whereType<String>().toSet().toList()..sort();

  List<Complaint> get _filtered {
    final q = _search.trim().toLowerCase();
    final list = _all.where((c) {
      if (_statusFilter != null && c.actionStatus != _statusFilter) return false;
      if (_areaFilter != null && c.area != _areaFilter) return false;
      if (_hideCalled && c.callCount > 0) return false;
      if (q.isNotEmpty) {
        final hay = '${c.complaintNumber} ${c.area} ${c.district} ${c.complaintSubType} ${c.feeder}'.toLowerCase();
        if (!hay.contains(q)) return false;
      }
      return true;
    }).toList();
    list.sort(_sortBy == 'newest' ? compareNewest : compareUrgent);
    return list;
  }

  @override
  Widget build(BuildContext context) {
    final filtered = _filtered;
    final pending = _all.where((c) => c.callCount == 0).length;
    final overdue = _all.where((c) {
      final d = complaintDeadline(c);
      return d != null && d.isBefore(_now);
    }).length;

    return Scaffold(
      appBar: AppBar(
        titleSpacing: 16,
        title: const Text('Live Complaints'),
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 12),
            child: FilledButton.tonalIcon(
              onPressed: _syncing ? null : _fetchLatest,
              icon: _syncing
                  ? const SizedBox(width: 15, height: 15, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.refresh, size: 18),
              label: Text(_syncing ? 'Syncing' : 'Latest'),
            ),
          ),
        ],
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(146),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(12, 0, 12, 10),
            child: Column(
              children: [
                Row(
                  children: [
                    Pill('${_all.length} live', fg: AppColors.brand),
                    Gap.sm,
                    Pill('$pending uncalled', fg: AppColors.inkSoft),
                    if (overdue > 0) ...[Gap.sm, Pill('$overdue overdue', fg: AppColors.danger, bg: AppColors.dangerBg)],
                    const Spacer(),
                  ],
                ),
                Gap.sm,
                TextField(
                  onChanged: (v) => setState(() => _search = v),
                  textInputAction: TextInputAction.search,
                  decoration: const InputDecoration(hintText: 'Search complaint no, area, feeder…', prefixIcon: Icon(Icons.search, size: 20, color: AppColors.muted)),
                ),
                Gap.sm,
                Row(
                  children: [
                    Expanded(child: _dropdown('Status', _statusFilter, _statuses, (v) => setState(() => _statusFilter = v))),
                    Gap.sm,
                    Expanded(child: _dropdown('Area', _areaFilter, _areas, (v) => setState(() => _areaFilter = v))),
                  ],
                ),
                Gap.sm,
                Row(
                  children: [
                    InkWell(
                      borderRadius: BorderRadius.circular(8),
                      onTap: () {
                        Haptics.tap();
                        setState(() => _hideCalled = !_hideCalled);
                      },
                      child: Padding(
                        padding: const EdgeInsets.symmetric(vertical: 4, horizontal: 2),
                        child: Row(children: [
                          Icon(_hideCalled ? Icons.check_box : Icons.check_box_outline_blank, size: 20, color: _hideCalled ? AppColors.brand : AppColors.muted),
                          Gap.xs,
                          const Text('Hide called', style: TextStyle(fontSize: 13, color: AppColors.inkSoft)),
                        ]),
                      ),
                    ),
                    const Spacer(),
                    SegmentedButton<String>(
                      showSelectedIcon: false,
                      segments: const [
                        ButtonSegment(value: 'urgent', label: Text('Urgent')),
                        ButtonSegment(value: 'newest', label: Text('Newest')),
                      ],
                      selected: {_sortBy},
                      onSelectionChanged: (s) {
                        Haptics.tap();
                        setState(() => _sortBy = s.first);
                      },
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
      body: _loading
          ? const SkeletonList()
          : RefreshIndicator(
              onRefresh: () {
                Haptics.light();
                return _load();
              },
              child: _error != null
                  ? ListView(children: [
                      Padding(
                        padding: const EdgeInsets.only(top: 60),
                        child: EmptyState(
                          icon: Icons.cloud_off,
                          title: 'Could not load',
                          subtitle: _error,
                          action: FilledButton(onPressed: _load, child: const Text('Retry')),
                        ),
                      )
                    ])
                  : filtered.isEmpty
                      ? ListView(children: [
                          Padding(
                            padding: const EdgeInsets.only(top: 60),
                            child: EmptyState(
                              icon: Icons.inbox_outlined,
                              title: _all.isEmpty ? 'No complaints yet' : 'Nothing matches your filters',
                              subtitle: _all.isEmpty ? 'Tap "Latest" to pull the live grid.' : 'Try clearing the search or filters.',
                              action: _all.isEmpty ? FilledButton.icon(onPressed: _syncing ? null : _fetchLatest, icon: const Icon(Icons.refresh, size: 18), label: const Text('Fetch Latest')) : null,
                            ),
                          )
                        ])
                      : ListView.separated(
                          padding: const EdgeInsets.all(12),
                          itemCount: filtered.length,
                          separatorBuilder: (_, _) => Gap.sm,
                          itemBuilder: (_, i) => _card(filtered[i]),
                        ),
            ),
    );
  }

  Widget _dropdown(String hint, String? value, List<String> items, ValueChanged<String?> onChanged) {
    return DropdownButtonFormField<String?>(
      initialValue: value,
      isExpanded: true,
      icon: const Icon(Icons.expand_more, size: 20, color: AppColors.muted),
      style: const TextStyle(fontSize: 13, color: AppColors.ink),
      decoration: const InputDecoration(contentPadding: EdgeInsets.symmetric(horizontal: 10, vertical: 10)),
      hint: Text('All ${hint.toLowerCase()}', style: const TextStyle(fontSize: 13, color: AppColors.muted)),
      items: [
        DropdownMenuItem<String?>(value: null, child: Text('All ${hint.toLowerCase()}', style: const TextStyle(fontSize: 13))),
        ...items.map((e) => DropdownMenuItem<String?>(value: e, child: Text(e, style: const TextStyle(fontSize: 13), overflow: TextOverflow.ellipsis))),
      ],
      onChanged: (v) {
        Haptics.tap();
        onChanged(v);
      },
    );
  }

  void _openSheet(Complaint c) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      useSafeArea: true,
      backgroundColor: AppColors.surface,
      builder: (_) => DetailSheet(complaint: c, onLogged: _load),
    );
  }

  Widget _card(Complaint c) {
    final sla = slaFor(c, _now);
    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: BorderRadius.circular(kRadius),
        onTap: () {
          Haptics.light();
          _openSheet(c);
        },
        child: Container(
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(kRadius),
            border: Border.all(color: sla.overdue ? const Color(0xFFFECACA) : AppColors.border),
          ),
          clipBehavior: Clip.antiAlias,
          child: IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Container(width: 4, color: sla.fg),
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.all(13),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Expanded(child: Text(c.complaintNumber ?? '#${c.dataid}', style: const TextStyle(fontFamily: 'monospace', fontWeight: FontWeight.bold, fontSize: 13.5, color: AppColors.ink))),
                            Pill(c.actionStatus ?? '—', fg: statusColor(c.actionStatus)),
                          ],
                        ),
                        const SizedBox(height: 5),
                        Text(c.complaintSubType ?? c.complaintType ?? 'Complaint', style: const TextStyle(fontSize: 14, color: AppColors.ink, fontWeight: FontWeight.w500)),
                        const SizedBox(height: 3),
                        Row(children: [
                          const Icon(Icons.place_outlined, size: 13, color: AppColors.muted),
                          const SizedBox(width: 3),
                          Expanded(child: Text('${c.area ?? '—'} · ${c.district ?? '—'}${c.areaType != null ? ' · ${c.areaType}' : ''}', style: const TextStyle(fontSize: 12, color: AppColors.inkSoft), overflow: TextOverflow.ellipsis)),
                        ]),
                        const SizedBox(height: 10),
                        Row(
                          crossAxisAlignment: CrossAxisAlignment.end,
                          children: [
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(fmtDateTime(c.complaintDate), style: const TextStyle(fontSize: 12, color: AppColors.muted)),
                                  Text(elapsedLabel(c.complaintDate, _now), style: const TextStyle(fontSize: 11, color: AppColors.muted)),
                                ],
                              ),
                            ),
                            Column(
                              crossAxisAlignment: CrossAxisAlignment.end,
                              children: [
                                AnimatedContainer(
                                  duration: const Duration(milliseconds: 300),
                                  padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
                                  decoration: BoxDecoration(color: sla.bg, borderRadius: BorderRadius.circular(8)),
                                  child: Text(sla.text, style: TextStyle(color: sla.fg, fontWeight: FontWeight.bold, fontSize: 12, fontFeatures: const [FontFeature.tabularFigures()])),
                                ),
                                if (c.callCount > 0)
                                  Padding(
                                    padding: const EdgeInsets.only(top: 4),
                                    child: Row(mainAxisSize: MainAxisSize.min, children: [
                                      const Icon(Icons.check_circle, size: 13, color: AppColors.success),
                                      const SizedBox(width: 3),
                                      Text(c.lastCallStatus ?? 'Called', style: const TextStyle(fontSize: 11, color: AppColors.success, fontWeight: FontWeight.w600)),
                                    ]),
                                  ),
                              ],
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
