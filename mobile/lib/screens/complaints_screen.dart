import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';

import '../alerts.dart';
import '../api.dart';
import '../call_channel.dart';
import '../models.dart';
import '../sla.dart';
import '../storage.dart';
import '../theme.dart';
import '../widgets.dart';
import 'detail_sheet.dart';
import 'pending_sheet.dart';

class ComplaintsScreen extends StatefulWidget {
  const ComplaintsScreen({super.key});

  @override
  State<ComplaintsScreen> createState() => _ComplaintsScreenState();
}

class _ComplaintsScreenState extends State<ComplaintsScreen> {
  List<Complaint> _all = [];
  List<Complaint> _filtered = [];
  bool _loading = true;
  bool _syncing = false;
  bool _offline = false;
  String? _error;
  DateTime _now = DateTime.now();

  String _search = '';
  String? _statusFilter;
  String? _areaFilter;
  bool _hideCalled = false;
  String _sortBy = 'urgent';

  Timer? _tick;
  Timer? _poll;
  bool _resyncing = false;

  @override
  void initState() {
    super.initState();
    _load();
    _onboard();
    _tick = Timer.periodic(const Duration(seconds: 1), (_) {
      // The tick only feeds the SLA countdowns — skip the whole-screen rebuild
      // while there's nothing to count down.
      if (mounted && _all.isNotEmpty) setState(() => _now = DateTime.now());
    });
    _poll = Timer.periodic(const Duration(minutes: 3), (_) => _load());
  }

  @override
  void dispose() {
    _tick?.cancel();
    _poll?.cancel();
    super.dispose();
  }

  // First launch: ask for the calling permissions up front and explain the
  // "Display over other apps" toggle that powers auto-return + the call bubble.
  Future<void> _onboard() async {
    if (Store.onboarded()) return;
    await Store.setOnboarded();
    await CallChannel.ensureCallPermissions();
    if (!mounted || await CallChannel.canDrawOverlays()) return;
    if (!mounted) return;
    final enable = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.surface,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(kRadius)),
        title: const Text('Auto-return after calls', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
        content: const Text(
          'Allow "Display over other apps" so the app comes back on screen the moment a call ends, with the result pre-filled — and shows the consumer\'s details during the call.',
          style: TextStyle(fontSize: 13.5, color: AppColors.inkSoft),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Not now')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Enable')),
        ],
      ),
    );
    if (enable == true) await CallChannel.requestOverlayPermission();
  }

  Future<void> _load() async {
    try {
      final raw = await Api.complaintsRaw();
      final list = raw.map(Complaint.fromJson).toList();
      if (!mounted) return;
      setState(() {
        _all = list;
        _error = null;
        _offline = false;
        _loading = false;
      });
      _updateFiltered();
      Store.cacheComplaints(raw);
      Alerts.check(list);
      _syncOutboxIfAny();
      _fetchCallerIdCache();
    } catch (e) {
      if (!mounted) return;
      final cached = Store.cachedComplaints();
      if (cached.isNotEmpty) {
        // Offline: keep working from the last good list.
        setState(() {
          _all = cached.map(Complaint.fromJson).toList();
          _offline = true;
          _error = null;
          _loading = false;
        });
        _updateFiltered();
      } else {
        setState(() {
          _error = '$e';
          _loading = false;
        });
      }
    }
  }

  Future<void> _fetchCallerIdCache() async {
    // contacts-cache returns the newest 1000 complaints with a mobile number
    // (active AND recently-closed) with their status + date, so the native
    // caller-ID banner can say "2 complaints · Resolved on 2026-07-08".
    try {
      final cache = await Api.callerIdCache();

      // Group by mobile: the newest complaint (endpoint is newest-first) is
      // shown, the group size becomes the complaint count.
      final Map<String, List<Map<String, dynamic>>> byMobile = {};
      for (final c in cache) {
        final mobile = (c['mobile'] ?? '').toString();
        if (mobile.isEmpty) continue;
        byMobile.putIfAbsent(mobile, () => []).add(c);
      }

      final Map<String, String> itemsToSave = {};
      byMobile.forEach((mobile, rows) {
        final latest = rows.first;
        final closed = ('${latest['status'] ?? ''}').toLowerCase().contains('closed');
        itemsToSave[mobile] = jsonEncode({
          'complaint_number': latest['complaint_number'] ?? 'Complaint',
          'consumer_name': latest['consumer_name'] ?? 'Consumer',
          'substation': latest['area'] ?? 'Unknown',
          'dataid': latest['dataid'],
          'complaint_sub_type': latest['complaint_sub_type'] ?? '',
          'remarks': latest['remarks'] ?? '',
          'total_complaints': rows.length,
          'last_status': closed ? 'Resolved' : 'Pending',
          'last_date': latest['complaint_date'] ?? '',
        });
      });

      if (itemsToSave.isNotEmpty) {
        await Store.saveCallerIds(itemsToSave);
      }
    } catch (_) {
      // Ignore background fetch errors
    }
  }

  Future<void> _syncOutboxIfAny() async {
    if (Store.outbox().isEmpty || _resyncing) return;
    final n = await Store.syncOutbox();
    if (n > 0 && mounted) {
      showSnack(context, '$n offline log${n == 1 ? '' : 's'} synced');
      _resyncing = true;
      await _load();
      _resyncing = false;
    }
  }

  Future<void> _fetchLatest() async {
    if (_syncing) return;
    setState(() => _syncing = true);
    try {
      await Api.sync();
      await _load();
      Haptics.success();
    } catch (e) {
      // Keep showing the current list — a failed sync must never blank it.
      Haptics.error();
      if (mounted) showSnack(context, 'Sync failed: $e', error: true);
    } finally {
      if (mounted) setState(() => _syncing = false);
    }
  }

  List<String> get _areas => _all.map((c) => c.area).whereType<String>().toSet().toList()..sort();
  List<String> get _statuses => _all.map((c) => c.actionStatus).whereType<String>().toSet().toList()..sort();

  void _updateFiltered() {
    final q = _search.trim().toLowerCase();
    final list = _all.where((c) {
      if (_statusFilter != null && c.actionStatus != _statusFilter) {
        return false;
      }
      if (_areaFilter != null && c.area != _areaFilter) {
        return false;
      }
      if (_hideCalled && c.callCount > 0) {
        return false;
      }
      if (q.isNotEmpty) {
        final hay = '${c.complaintNumber} ${c.area} ${c.district} ${c.complaintSubType} ${c.feeder}'.toLowerCase();
        if (!hay.contains(q)) {
          return false;
        }
      }
      return true;
    }).toList();
    list.sort(_sortBy == 'newest' ? compareNewest : compareUrgent);
    setState(() => _filtered = list);
  }

  @override
  Widget build(BuildContext context) {
    final pending = _all.where((c) => c.callCount == 0).length;
    final pendingLogs = Store.pendingCount();
    final viewPadding = MediaQuery.viewPaddingOf(context);
    final overdue = _all.where((c) {
      final d = complaintDeadline(c);
      return d != null && d.isBefore(_now);
    }).length;

    return Scaffold(
      appBar: AppBar(
        primary: true,
        toolbarHeight: 64,
        titleSpacing: 16 + viewPadding.left,
        title: const Text('Live Complaints', maxLines: 1, overflow: TextOverflow.ellipsis),
        actions: [
          Padding(
            padding: EdgeInsets.only(right: 16 + viewPadding.right),
            child: _syncing
                ? Container(
                    height: 38,
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                    decoration: BoxDecoration(
                      color: AppColors.brand.withValues(alpha: 0.10),
                      borderRadius: BorderRadius.circular(100),
                    ),
                    child: const Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        SizedBox(
                          width: 14,
                          height: 14,
                          child: CircularProgressIndicator(strokeWidth: 1.8, color: AppColors.brand),
                        ),
                        SizedBox(width: 6),
                        Text(
                          'Syncing...',
                          style: TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.bold,
                            color: AppColors.brand,
                          ),
                        ),
                      ],
                    ),
                  )
                : FilledButton.tonalIcon(
                    onPressed: () {
                      Haptics.medium();
                      _fetchLatest();
                    },
                    icon: const Icon(Icons.refresh_rounded, size: 16),
                    label: const Text('Refresh'),
                    style: FilledButton.styleFrom(
                      visualDensity: VisualDensity.compact,
                      foregroundColor: AppColors.brand,
                      backgroundColor: AppColors.brand.withValues(alpha: 0.12),
                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 0),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(100),
                      ),
                      textStyle: const TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ),
          ),
        ],
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(180),
          child: Padding(
            padding: EdgeInsets.fromLTRB(16 + viewPadding.left, 0, 16 + viewPadding.right, 12),
            child: Column(
              children: [
                Row(
                  children: [
                    Pill('${_all.length} live', fg: AppColors.brand),
                    Gap.sm,
                    Pill('$pending uncalled', fg: AppColors.inkSoft),
                    if (overdue > 0) ...[Gap.sm, Pill('$overdue overdue', fg: AppColors.danger, bg: AppColors.dangerBg)],
                    if (_offline) ...[Gap.sm, const Pill('Offline', fg: AppColors.warning, bg: AppColors.warningBg)],
                    const Spacer(),
                  ],
                ),
                const SizedBox(height: 12),
                TextField(
                  onChanged: (v) {
                    _search = v;
                    _updateFiltered();
                  },
                  textInputAction: TextInputAction.search,
                  decoration: const InputDecoration(
                    hintText: 'Search complaint no, area, feeder…',
                    prefixIcon: Icon(Icons.search, size: 20, color: AppColors.muted),
                  ),
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(child: _dropdown('Status', _statusFilter, _statuses, (v) {
                      _statusFilter = v;
                      _updateFiltered();
                    })),
                    Gap.sm,
                    Expanded(child: _dropdown('Substation', _areaFilter, _areas, (v) {
                      _areaFilter = v;
                      _updateFiltered();
                    })),
                  ],
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    InkWell(
                      borderRadius: BorderRadius.circular(8),
                      onTap: () {
                        Haptics.tap();
                        _hideCalled = !_hideCalled;
                        _updateFiltered();
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
                        _sortBy = s.first;
                        _updateFiltered();
                      },
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
      body: Column(
        children: [
          if (pendingLogs > 0)
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 10, 12, 0),
              child: AppCard(
                background: AppColors.warningBg,
                borderColor: const Color(0xFFFDE68A),
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                onTap: _openPending,
                child: Row(children: [
                  const Icon(Icons.pending_actions, size: 18, color: AppColors.warning),
                  Gap.sm,
                  Expanded(
                    child: Text('$pendingLogs call log${pendingLogs == 1 ? '' : 's'} pending — tap to finish',
                        style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: AppColors.warning)),
                  ),
                  const Icon(Icons.chevron_right, size: 18, color: AppColors.warning),
                ]),
              ),
            ),
          Expanded(
            child: _loading
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
                        : _filtered.isEmpty
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
                                itemCount: _filtered.length,
                                separatorBuilder: (_, _) => Gap.sm,
                                itemBuilder: (_, i) => _card(_filtered[i]),
                              ),
                  ),
          ),
        ],
      ),
    );
  }

  void _openPending() {
    Haptics.light();
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      useSafeArea: true,
      backgroundColor: AppColors.bg,
      builder: (_) => PendingSheet(onChanged: _load),
    ).whenComplete(() {
      if (mounted) setState(() {});
    });
  }

  // A filter dropdown that clearly shows when it's active: brand-colored bold
  // text + border while a value is selected, quiet grey when showing "All".
  Widget _dropdown(String hint, String? value, List<String> items, ValueChanged<String?> onChanged) {
    final active = value != null;
    OutlineInputBorder fieldBorder(Color c, [double w = 1]) => OutlineInputBorder(
          borderRadius: BorderRadius.circular(kRadiusSm),
          borderSide: BorderSide(color: c, width: w),
        );
    return DropdownButtonFormField<String?>(
      initialValue: value,
      isExpanded: true,
      borderRadius: BorderRadius.circular(kRadiusSm),
      dropdownColor: Colors.white,
      menuMaxHeight: 380,
      elevation: 4,
      icon: Icon(Icons.expand_more, size: 20, color: active ? AppColors.brand : AppColors.muted),
      decoration: InputDecoration(
        contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        enabledBorder: fieldBorder(active ? AppColors.brand : AppColors.border, active ? 1.4 : 1),
        focusedBorder: fieldBorder(AppColors.brand, 1.5),
        fillColor: active ? const Color(0xFFF5F5FF) : AppColors.surface,
      ),
      hint: Text('All ${hint.toLowerCase()}', style: const TextStyle(fontSize: 13, color: AppColors.muted)),
      items: [
        DropdownMenuItem<String?>(
          value: null,
          child: Text('All ${hint.toLowerCase()}', style: const TextStyle(fontSize: 13.5, color: AppColors.muted, fontWeight: FontWeight.w600)),
        ),
        ...items.map((e) => DropdownMenuItem<String?>(
              value: e,
              child: Text(e, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 13.5, color: AppColors.ink, fontWeight: FontWeight.w500)),
            )),
      ],
      selectedItemBuilder: (context) => [
        Text('All ${hint.toLowerCase()}', style: const TextStyle(fontSize: 13, color: AppColors.muted)),
        ...items.map((e) => Text(e, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 13, color: AppColors.brand, fontWeight: FontWeight.w700))),
      ],
      onChanged: (v) {
        Haptics.tap();
        onChanged(v);
      },
    );
  }

  void _openSheet(Complaint c) {
    showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      useSafeArea: true,
      backgroundColor: AppColors.surface,
      builder: (_) => DetailSheet(complaint: c),
    ).then((res) {
      if (!mounted) return;
      setState(() {}); // refresh the pending-logs banner
      if (res == 'logged') {
        // Auto-refresh: reload the list right away, then run the same FRT
        // sync as the Refresh button (spinner shows in the app bar).
        _load();
        _fetchLatest();
      }
    });
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
          child: Stack(
            children: [
              Container(
                width: double.infinity,
                padding: const EdgeInsets.only(left: 17, right: 13, top: 10, bottom: 10),
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
                        const SizedBox(height: 4),
                        Text(c.complaintSubType ?? c.complaintType ?? 'Complaint', style: const TextStyle(fontSize: 14, color: AppColors.ink, fontWeight: FontWeight.w500)),
                        const SizedBox(height: 4),
                        Row(children: [
                          Flexible(
                            child: Container(
                              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                              decoration: BoxDecoration(color: AppColors.brand.withValues(alpha: 0.10), borderRadius: BorderRadius.circular(7)),
                              child: Row(mainAxisSize: MainAxisSize.min, children: [
                                const Icon(Icons.bolt, size: 12, color: AppColors.brand),
                                const SizedBox(width: 3),
                                Flexible(
                                  child: Text(
                                    c.area ?? 'Substation —',
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(fontSize: 12, color: AppColors.brand, fontWeight: FontWeight.w700),
                                  ),
                                ),
                              ]),
                            ),
                          ),
                          if (c.areaType != null) ...[const SizedBox(width: 6), Pill(c.areaType!, fg: AppColors.inkSoft, bg: const Color(0xFFEFF2F7))],
                        ]),
                        const SizedBox(height: 8),
                        Row(
                          crossAxisAlignment: CrossAxisAlignment.end,
                          children: [
                            Expanded(
                              child: Text(
                                '${fmtDateTime(c.complaintDate)} · ${elapsedLabel(c.complaintDate, _now)}',
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(fontSize: 11.5, color: AppColors.muted),
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
                                      Text('${c.callCount > 1 ? '${c.callCount}× · ' : ''}${c.lastCallStatus ?? 'Called'}', style: const TextStyle(fontSize: 11, color: AppColors.success, fontWeight: FontWeight.w600)),
                                    ]),
                                  ),
                                if (c.activeClaim)
                                  Padding(
                                    padding: const EdgeInsets.only(top: 4),
                                    child: Pill('On call · ${c.claimedByName}', fg: AppColors.warning, bg: AppColors.warningBg),
                                  ),
                              ],
                            ),
                          ],
                        ),
                      ],
                ),
              ),
              Positioned(
                left: 0,
                top: 0,
                bottom: 0,
                width: 4,
                child: Container(color: sla.fg),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
