import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:speech_to_text/speech_to_text.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:url_launcher/url_launcher.dart';

import '../call_channel.dart';
import '../call_tracker.dart';
import '../office_sync.dart';
import '../storage.dart';
import '../theme.dart';
import '../widgets.dart';

// --- Date & Time Helpers ---

String formatRelativeTime(DateTime? dt) {
  if (dt == null) return '';
  final now = DateTime.now();
  final diff = now.difference(dt);
  if (diff.isNegative) return 'Just now';
  if (diff.inSeconds < 45) return 'Just now';
  if (diff.inMinutes < 60) return '${diff.inMinutes}m ago (${diff.inMinutes} मिनट पहले)';
  if (diff.inHours < 24) return '${diff.inHours}h ago (${diff.inHours} घंटे पहले)';
  if (diff.inDays == 1) return 'Yesterday (1 दिन पहले)';
  if (diff.inDays < 30) return '${diff.inDays}d ago (${diff.inDays} दिन पहले)';
  final months = (diff.inDays / 30).floor();
  return '$months mo ago ($months माह पहले)';
}

DateTime? extractComplaintDate(Map<String, dynamic> c) {
  // 1. If complaint_date is set (e.g. 2026-11-05 or ISO string)
  final compDateStr = c['complaint_date'] as String?;
  if (compDateStr != null && compDateStr.isNotEmpty) {
    final parsed = DateTime.tryParse(compDateStr);
    if (parsed != null) return parsed;
  }

  // 2. First call recording's call_time (the initial incoming/registration call)
  final recs = c['recordings'] as List?;
  if (recs != null && recs.isNotEmpty) {
    final firstRec = recs.first as Map<String, dynamic>;
    final callTimeStr = firstRec['call_time'] as String?;
    if (callTimeStr != null && callTimeStr.isNotEmpty) {
      final parsed = DateTime.tryParse(callTimeStr);
      if (parsed != null) return parsed;
    }
  }

  // 3. From complaint_no pattern (e.g. MV051126... -> 05/11/26)
  final compNo = '${c['complaint_no'] ?? ''}';
  final regMatch = RegExp(r'[A-Za-z]+(\d{2})(\d{2})(\d{2})').firstMatch(compNo);
  if (regMatch != null) {
    try {
      final d = int.parse(regMatch.group(1)!);
      final m = int.parse(regMatch.group(2)!);
      final y = 2000 + int.parse(regMatch.group(3)!);
      return DateTime(y, m, d);
    } catch (_) {}
  }

  // 4. last_activity_at fallback
  final lastAct = c['last_activity_at'] as String?;
  if (lastAct != null && lastAct.isNotEmpty) {
    return DateTime.tryParse(lastAct);
  }

  return null;
}

DateTime? extractLastCallDate(Map<String, dynamic> c) {
  final recs = c['recordings'] as List?;
  if (recs != null && recs.isNotEmpty) {
    final lastRec = recs.last as Map<String, dynamic>;
    final callTimeStr = lastRec['call_time'] as String?;
    if (callTimeStr != null && callTimeStr.isNotEmpty) {
      return DateTime.tryParse(callTimeStr);
    }
  }
  return null;
}

String getComplaintDateKey(Map<String, dynamic> c) {
  final lastCall = extractLastCallDate(c);
  if (lastCall != null) {
    return DateFormat('yyyy-MM-dd').format(lastCall);
  }
  final compDt = extractComplaintDate(c);
  if (compDt != null) {
    return DateFormat('yyyy-MM-dd').format(compDt);
  }
  final lastAct = '${c['last_activity_at'] ?? ''}';
  if (lastAct.length >= 10) return lastAct.substring(0, 10);
  return '';
}

class FollowupScreen extends StatefulWidget {
  const FollowupScreen({super.key});

  @override
  State<FollowupScreen> createState() => _FollowupScreenState();
}

class _FollowupScreenState extends State<FollowupScreen> {
  List<Map<String, dynamic>> _complaints = [];
  List<Map<String, dynamic>> _filtered = [];
  bool _loading = true;
  bool _syncing = false;
  String? _serverUrl;
  String _search = '';
  String _dateFilter = 'today'; // By default 'today' is selected
  int? _playingRecordingId;

  int _todayCount = 0;
  int _yesterdayCount = 0;

  final _searchController = TextEditingController();

  @override
  void initState() {
    super.initState();
    CallChannel.onPlaybackComplete = () {
      if (mounted) setState(() => _playingRecordingId = null);
    };
    _load();
  }

  @override
  void dispose() {
    _searchController.dispose();
    CallChannel.stopRecording();
    super.dispose();
  }

  Future<void> _load({bool forceRefresh = false}) async {
    if (!mounted) return;
    setState(() => _syncing = true);

    try {
      final list = await OfficeSyncService.fetchUnsatisfiedComplaints(forceRefresh: forceRefresh);
      final server = await OfficeSyncService.discoverOfficeServer(forceRefresh: forceRefresh);

      // Strictly filter out any complaint that is satisfied
      list.removeWhere((c) => OfficeSyncService.isComplaintSatisfied(c));

      // Sort newest / latest call first so last complaints always appear at the top
      list.sort((a, b) {
        final timeA = extractLastCallDate(a) ?? extractComplaintDate(a) ?? DateTime(2000);
        final timeB = extractLastCallDate(b) ?? extractComplaintDate(b) ?? DateTime(2000);
        return timeB.compareTo(timeA);
      });

      if (mounted) {
        setState(() {
          _complaints = list;
          _serverUrl = server;
          _loading = false;
          _syncing = false;
        });
        _applyFilters();
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _loading = false;
          _syncing = false;
        });
        _applyFilters();
      }
    }
  }

  void _applyFilters() {
    final q = _search.trim().toLowerCase();
    final todayStr = DateFormat('yyyy-MM-dd').format(DateTime.now());
    final yesterdayStr = DateFormat('yyyy-MM-dd').format(DateTime.now().subtract(const Duration(days: 1)));

    int tCount = 0;
    int yCount = 0;
    for (final c in _complaints) {
      final k = getComplaintDateKey(c);
      if (k == todayStr) tCount++;
      if (k == yesterdayStr) yCount++;
    }

    setState(() {
      _todayCount = tCount;
      _yesterdayCount = yCount;

      _filtered = _complaints.where((c) {
        // Search query
        if (q.isNotEmpty) {
          final compNo = '${c['complaint_no'] ?? ''}'.toLowerCase();
          final name = '${c['consumer_name'] ?? ''}'.toLowerCase();
          final phone = '${c['consumer_phone'] ?? ''}'.toLowerCase();
          final area = '${c['area'] ?? ''}'.toLowerCase();
          final feeder = '${c['feeder'] ?? ''}'.toLowerCase();
          final type = '${c['complaint_type'] ?? ''}'.toLowerCase();
          final match = compNo.contains(q) ||
              name.contains(q) ||
              phone.contains(q) ||
              area.contains(q) ||
              feeder.contains(q) ||
              type.contains(q);
          if (!match) return false;
        }

        // Date filter: 'today' | 'yesterday' | 'all'
        final dateKey = getComplaintDateKey(c);
        if (_dateFilter == 'today' && dateKey != todayStr) return false;
        if (_dateFilter == 'yesterday' && dateKey != yesterdayStr) return false;

        return true;
      }).toList();
    });
  }

  Future<void> _toggleAudio(int recId) async {
    Haptics.tap();
    if (_playingRecordingId == recId) {
      await CallChannel.stopRecording();
      if (mounted) setState(() => _playingRecordingId = null);
      return;
    }

    if (_serverUrl == null) {
      showSnack(context, 'Office PC se audio stream nahi ho saka', error: true);
      return;
    }

    final streamUrl = '$_serverUrl/api/recordings/$recId/stream';
    setState(() => _playingRecordingId = recId);
    final ok = await CallChannel.playRecording(streamUrl);
    if (!ok && mounted) {
      setState(() => _playingRecordingId = null);
      showSnack(context, 'Recording play nahi ho saki', error: true);
    }
  }

  void _openFollowupCallSheet(Map<String, dynamic> comp, {bool autoStartCall = false}) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => FollowupCallSheet(
        complaint: comp,
        serverUrl: _serverUrl,
        autoStartCall: autoStartCall,
        onRefresh: () => _load(forceRefresh: false),
        onRemoveLocal: (complaintNo) {
          setState(() {
            _complaints.removeWhere((c) => c['complaint_no'] == complaintNo);
            _applyFilters();
          });
        },
      ),
    );
  }

  void _showServerDialog() {
    final ipCtrl = TextEditingController(text: _serverUrl?.replaceAll('http://', '').replaceAll(':8080', '') ?? '');
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Row(
          children: [
            Icon(Icons.wifi_tethering, color: AppColors.brand),
            SizedBox(width: 8),
            Text('Office PC Server IP', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
          ],
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Jio AirFiber router restart hone par PC ka IP badal sakta hai. Niche se naya IP scan karein ya manually enter karein:',
              style: TextStyle(fontSize: 13, color: AppColors.inkSoft),
            ),
            const SizedBox(height: 14),
            TextField(
              controller: ipCtrl,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(
                labelText: 'Server IP (e.g. 192.168.31.68)',
                prefixText: 'http://',
                suffixText: ':8080',
                border: OutlineInputBorder(),
                isDense: true,
              ),
            ),
          ],
        ),
        actions: [
          TextButton.icon(
            onPressed: () async {
              Navigator.pop(ctx);
              showSnack(context, 'AirFiber Wi-Fi par Office PC scan ho raha hai...');
              await _load(forceRefresh: true);
            },
            icon: const Icon(Icons.refresh, size: 18),
            label: const Text('Auto Scan Wi-Fi'),
          ),
          FilledButton(
            onPressed: () async {
              final val = ipCtrl.text.trim();
              if (val.isNotEmpty) {
                Navigator.pop(ctx);
                final fullUrl = val.startsWith('http') ? val : 'http://$val:8080';
                await OfficeSyncService.setManualServerUrl(fullUrl);
                if (mounted) {
                  _load(forceRefresh: true);
                }
              }
            },
            child: const Text('Save IP'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Follow-up Queue', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: AppColors.ink)),
            Text(
              '${_complaints.length} Unsatisfied ($_todayCount Today)',
              style: const TextStyle(fontSize: 12, color: AppColors.inkSoft),
            ),
          ],
        ),
        backgroundColor: AppColors.surface,
        elevation: 0.5,
        actions: [
          // Connection status pill
          InkWell(
            onTap: _showServerDialog,
            borderRadius: BorderRadius.circular(16),
            child: Container(
              margin: const EdgeInsets.symmetric(vertical: 12, horizontal: 8),
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
              decoration: BoxDecoration(
                color: _serverUrl != null ? const Color(0xFFDCFCE7) : const Color(0xFFFEE2E2),
                borderRadius: BorderRadius.circular(16),
                border: Border.all(
                  color: _serverUrl != null ? const Color(0xFF86EFAC) : const Color(0xFFFCA5A5),
                ),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    width: 7,
                    height: 7,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: _serverUrl != null ? const Color(0xFF16A34A) : const Color(0xFFDC2626),
                    ),
                  ),
                  const SizedBox(width: 5),
                  Text(
                    _serverUrl != null
                        ? _serverUrl!.replaceAll('http://', '').replaceAll(':8080', '')
                        : 'No Wi-Fi',
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.bold,
                      color: _serverUrl != null ? const Color(0xFF15803D) : const Color(0xFFB91C1C),
                    ),
                  ),
                ],
              ),
            ),
          ),
          IconButton(
            icon: _syncing
                ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                : const Icon(Icons.refresh, color: AppColors.ink),
            tooltip: 'Refresh queue',
            onPressed: _syncing ? null : () => _load(forceRefresh: true),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () => _load(forceRefresh: true),
        child: Column(
          children: [
            // Search and Filters
            Container(
              color: AppColors.surface,
              padding: const EdgeInsets.fromLTRB(14, 8, 14, 10),
              child: Column(
                children: [
                  // Search box
                  Container(
                    height: 40,
                    decoration: BoxDecoration(
                      color: const Color(0xFFF1F5F9),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: TextField(
                      controller: _searchController,
                      onChanged: (v) {
                        _search = v;
                        _applyFilters();
                      },
                      style: const TextStyle(fontSize: 14),
                      decoration: InputDecoration(
                        hintText: 'Search complaint #, consumer, feeder...',
                        hintStyle: const TextStyle(fontSize: 13, color: AppColors.muted),
                        prefixIcon: const Icon(Icons.search, size: 20, color: AppColors.muted),
                        suffixIcon: _search.isNotEmpty
                            ? IconButton(
                                icon: const Icon(Icons.close, size: 18, color: AppColors.muted),
                                onPressed: () {
                                  _searchController.clear();
                                  _search = '';
                                  _applyFilters();
                                },
                              )
                            : null,
                        border: InputBorder.none,
                        contentPadding: const EdgeInsets.symmetric(vertical: 10),
                      ),
                    ),
                  ),
                  const SizedBox(height: 8),

                  // Filter Row: Today (Default), Yesterday, All
                  Row(
                    children: [
                      _filterChip('today', 'Today ($_todayCount)'),
                      const SizedBox(width: 8),
                      _filterChip('yesterday', 'Yesterday ($_yesterdayCount)'),
                      const SizedBox(width: 8),
                      _filterChip('all', 'All (${_complaints.length})'),
                      const Spacer(),
                      Text(
                        'Showing ${_filtered.length}',
                        style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: AppColors.inkSoft),
                      ),
                    ],
                  ),
                ],
              ),
            ),

            // Complaint List
            Expanded(
              child: _loading
                  ? const Center(child: CircularProgressIndicator())
                  : _filtered.isEmpty
                      ? ListView(
                          children: [
                            const SizedBox(height: 80),
                            Center(
                              child: Column(
                                children: [
                                  Container(
                                    padding: const EdgeInsets.all(16),
                                    decoration: const BoxDecoration(
                                      color: Color(0xFFDCFCE7),
                                      shape: BoxShape.circle,
                                    ),
                                    child: const Icon(Icons.verified, size: 48, color: Color(0xFF059669)),
                                  ),
                                  const SizedBox(height: 14),
                                  Text(
                                    _dateFilter == 'today'
                                        ? 'Aaj Ki Koi Unsatisfied Complaint Nahi Hai!'
                                        : 'Koi Unsatisfied Complaint Nahi Mili!',
                                    style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: AppColors.ink),
                                  ),
                                  const SizedBox(height: 6),
                                  Padding(
                                    padding: const EdgeInsets.symmetric(horizontal: 40),
                                    child: Text(
                                      _dateFilter == 'today' && _complaints.isNotEmpty
                                          ? 'Aaj ki sabhi complaints resolve ho gayi hain. Pichli dekhne ke liye "All" par click karein.'
                                          : 'Sabhi consumers follow-up me santusht ho chuke hain ya queue clear hai.',
                                      textAlign: TextAlign.center,
                                      style: const TextStyle(fontSize: 13, color: AppColors.muted),
                                    ),
                                  ),
                                  const SizedBox(height: 16),
                                  if (_dateFilter == 'today' && _complaints.isNotEmpty)
                                    FilledButton.icon(
                                      onPressed: () {
                                        setState(() => _dateFilter = 'all');
                                        _applyFilters();
                                      },
                                      icon: const Icon(Icons.list, size: 18),
                                      label: Text('All Complaints Dekhein (${_complaints.length})'),
                                    )
                                  else
                                    OutlinedButton.icon(
                                      onPressed: () => _load(forceRefresh: true),
                                      icon: const Icon(Icons.refresh, size: 18),
                                      label: const Text('Refresh Check Karein'),
                                    ),
                                ],
                              ),
                            ),
                          ],
                        )
                      : ListView.builder(
                          padding: const EdgeInsets.fromLTRB(14, 12, 14, 24),
                          itemCount: _filtered.length,
                          itemBuilder: (context, i) {
                            final comp = _filtered[i];
                            return _FollowupCard(
                              complaint: comp,
                              isPlaying: _playingRecordingId != null &&
                                  (comp['recordings'] as List?)?.any((r) => r['id'] == _playingRecordingId) == true,
                              onToggleAudio: _toggleAudio,
                              onStartCall: () => _openFollowupCallSheet(comp, autoStartCall: true),
                              onOpenSheet: () => _openFollowupCallSheet(comp, autoStartCall: false),
                            );
                          },
                        ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _filterChip(String id, String label) {
    final selected = _dateFilter == id;
    return InkWell(
      onTap: () {
        setState(() => _dateFilter = id);
        _applyFilters();
      },
      borderRadius: BorderRadius.circular(20),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
        decoration: BoxDecoration(
          color: selected ? AppColors.brand : const Color(0xFFF1F5F9),
          borderRadius: BorderRadius.circular(20),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 11.5,
            fontWeight: selected ? FontWeight.bold : FontWeight.w500,
            color: selected ? Colors.white : AppColors.inkSoft,
          ),
        ),
      ),
    );
  }
}

class _FollowupCard extends StatelessWidget {
  final Map<String, dynamic> complaint;
  final bool isPlaying;
  final Function(int recId) onToggleAudio;
  final VoidCallback onStartCall;
  final VoidCallback onOpenSheet;

  const _FollowupCard({
    required this.complaint,
    required this.isPlaying,
    required this.onToggleAudio,
    required this.onStartCall,
    required this.onOpenSheet,
  });

  @override
  Widget build(BuildContext context) {
    final complaintNo = complaint['complaint_no'] ?? '-';
    final consumerName = complaint['consumer_name'] ?? 'Consumer';
    final phone = complaint['consumer_phone'] ?? '';
    final area = complaint['area'] ?? '';
    final feeder = complaint['feeder'] ?? '';
    final type = complaint['complaint_type'] ?? 'Complaint';

    final recordings = (complaint['recordings'] as List?) ?? [];
    final lastRec = recordings.isNotEmpty ? recordings.last as Map<String, dynamic> : null;
    final lastProblem = lastRec?['actual_problem'] ?? '';
    final lastNotes = lastRec?['operator_notes'] ?? '';
    final lastOp = lastRec?['operator_name'] ?? 'Operator';
    final recId = lastRec?['id'] as int?;

    // Timestamps
    final compDt = extractComplaintDate(complaint);
    final lastCallDt = extractLastCallDate(complaint);

    final now = DateTime.now();
    final isLastCallToday = lastCallDt != null &&
        lastCallDt.year == now.year &&
        lastCallDt.month == now.month &&
        lastCallDt.day == now.day;

    final formattedLastCallTime = lastCallDt != null
        ? (isLastCallToday
            ? DateFormat('hh:mm a').format(lastCallDt)
            : DateFormat('dd MMM, hh:mm a').format(lastCallDt))
        : '';
    final lastCallElapsed = formatRelativeTime(lastCallDt);

    final formattedCompTime = compDt != null
        ? DateFormat('dd MMM, hh:mm a').format(compDt)
        : '';
    final compElapsed = formatRelativeTime(compDt);

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xFFFECACA), width: 1.2),
        boxShadow: [
          BoxShadow(
            color: Colors.red.withValues(alpha: 0.04),
            blurRadius: 8,
            offset: const Offset(0, 3),
          ),
        ],
      ),
      child: InkWell(
        onTap: onOpenSheet,
        borderRadius: BorderRadius.circular(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Top Header: Badge, Complaint #, Type
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
              decoration: const BoxDecoration(
                color: Color(0xFFFFF1F2),
                borderRadius: BorderRadius.vertical(top: Radius.circular(13)),
              ),
              child: Row(
                children: [
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
                    decoration: BoxDecoration(
                      color: const Color(0xFFFEE2E2),
                      borderRadius: BorderRadius.circular(6),
                      border: Border.all(color: const Color(0xFFFCA5A5)),
                    ),
                    child: const Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text('🙁', style: TextStyle(fontSize: 11)),
                        SizedBox(width: 4),
                        Text(
                          'UNSATISFIED',
                          style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.bold, color: Color(0xFFB91C1C)),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 8),
                  Text(
                    '#$complaintNo',
                    style: const TextStyle(fontFamily: 'monospace', fontWeight: FontWeight.w800, fontSize: 13, color: AppColors.ink),
                  ),
                  const Spacer(),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                    decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(10)),
                    child: Text(type, style: const TextStyle(fontSize: 10.5, fontWeight: FontWeight.w600, color: AppColors.inkSoft)),
                  ),
                ],
              ),
            ),

            // Body Content
            Padding(
              padding: const EdgeInsets.all(14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Consumer Details & Audio Stream Button
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(consumerName, style: const TextStyle(fontSize: 14.5, fontWeight: FontWeight.bold, color: AppColors.ink)),
                            const SizedBox(height: 2),
                            Row(
                              children: [
                                const Icon(Icons.location_on_outlined, size: 14, color: AppColors.muted),
                                const SizedBox(width: 3),
                                Expanded(
                                  child: Text(
                                    feeder.isNotEmpty ? '$area · $feeder' : area,
                                    style: const TextStyle(fontSize: 12, color: AppColors.inkSoft),
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ),
                              ],
                            ),
                          ],
                        ),
                      ),
                      // Previous Call Audio Button
                      if (recId != null)
                        InkWell(
                          onTap: () => onToggleAudio(recId),
                          borderRadius: BorderRadius.circular(12),
                          child: Container(
                            padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
                            decoration: BoxDecoration(
                              color: isPlaying ? const Color(0xFFFEE2E2) : const Color(0xFFEFF6FF),
                              borderRadius: BorderRadius.circular(12),
                              border: Border.all(color: isPlaying ? const Color(0xFFEF4444) : const Color(0xFF93C5FD)),
                            ),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Icon(isPlaying ? Icons.stop : Icons.volume_up, size: 14, color: isPlaying ? const Color(0xFFDC2626) : const Color(0xFF1D4ED8)),
                                const SizedBox(width: 4),
                                Text(
                                  isPlaying ? 'Stop' : 'Audio',
                                  style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: isPlaying ? const Color(0xFFDC2626) : const Color(0xFF1D4ED8)),
                                ),
                              ],
                            ),
                          ),
                        ),
                    ],
                  ),

                  const SizedBox(height: 10),

                  // Time Badges: Complaint Registration Time & Last Call Time
                  Wrap(
                    spacing: 6,
                    runSpacing: 6,
                    children: [
                      // 1. Complaint Age Tag
                      if (formattedCompTime.isNotEmpty)
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3.5),
                          decoration: BoxDecoration(
                            color: const Color(0xFFFEF3C7),
                            borderRadius: BorderRadius.circular(6),
                            border: Border.all(color: const Color(0xFFFDE68A)),
                          ),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              const Icon(Icons.access_time_filled, size: 12, color: Color(0xFFD97706)),
                              const SizedBox(width: 4),
                              Text(
                                'शिकायत: $formattedCompTime ($compElapsed)',
                                style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Color(0xFF92400E)),
                              ),
                            ],
                          ),
                        ),

                      // 2. Last Call Tag
                      if (formattedLastCallTime.isNotEmpty)
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3.5),
                          decoration: BoxDecoration(
                            color: const Color(0xFFEFF6FF),
                            borderRadius: BorderRadius.circular(6),
                            border: Border.all(color: const Color(0xFFBFDBFE)),
                          ),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              const Icon(Icons.phone_callback, size: 12, color: Color(0xFF2563EB)),
                              const SizedBox(width: 4),
                              Text(
                                'Last Call: $formattedLastCallTime ($lastCallElapsed)',
                                style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Color(0xFF1D4ED8)),
                              ),
                            ],
                          ),
                        ),
                    ],
                  ),

                  const Divider(height: 18, thickness: 0.5, color: Color(0xFFE2E8F0)),

                  // Problem & Previous Call Notes
                  Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: const Color(0xFFF8FAFC),
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(color: const Color(0xFFE2E8F0)),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            const Icon(Icons.history, size: 14, color: Color(0xFF64748B)),
                            const SizedBox(width: 5),
                            Expanded(
                              child: Text(
                                formattedLastCallTime.isNotEmpty
                                    ? 'Previous Call: $formattedLastCallTime ($lastCallElapsed) · $lastOp'
                                    : 'Previous Call ($lastOp):',
                                style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Color(0xFF475569)),
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                          ],
                        ),
                        if (lastProblem.isNotEmpty) ...[
                          const SizedBox(height: 4),
                          Text(
                            'Fault: $lastProblem',
                            style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Color(0xFF334155)),
                          ),
                        ],
                        if (lastNotes.isNotEmpty) ...[
                          const SizedBox(height: 2),
                          Text(
                            'Note: $lastNotes',
                            style: const TextStyle(fontSize: 11.5, color: Color(0xFF64748B)),
                          ),
                        ],
                      ],
                    ),
                  ),

                  const SizedBox(height: 12),

                  // Prominent Recall Button (Follow-up Call)
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton.icon(
                      onPressed: onStartCall,
                      icon: const Icon(Icons.call, size: 18),
                      label: Text(
                        'दोबारा कॉल करें ($phone)',
                        style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13.5),
                      ),
                      style: FilledButton.styleFrom(
                        backgroundColor: const Color(0xFF2563EB),
                        padding: const EdgeInsets.symmetric(vertical: 11),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Follow-up Call Sheet: Handles placing call, tracking duration, scanning local recording,
/// capturing satisfaction feedback (SATISFIED / UNSATISFIED), and syncing back to the Office PC.
class FollowupCallSheet extends StatefulWidget {
  final Map<String, dynamic> complaint;
  final String? serverUrl;
  final bool autoStartCall;
  final VoidCallback onRefresh;
  final Function(String complaintNo) onRemoveLocal;

  const FollowupCallSheet({
    super.key,
    required this.complaint,
    required this.serverUrl,
    this.autoStartCall = false,
    required this.onRefresh,
    required this.onRemoveLocal,
  });

  @override
  State<FollowupCallSheet> createState() => _FollowupCallSheetState();
}

class _FollowupCallSheetState extends State<FollowupCallSheet> {
  final _tracker = CallTracker();
  final _notesCtrl = TextEditingController();
  final _speech = SpeechToText();

  bool _speechReady = false;
  bool _isListening = false;
  bool _isCallActive = false;
  bool _callEnded = false;
  bool _isSaving = false;
  bool _isScanningRecording = false;
  bool _isPlayingRecording = false;

  String? _callStatus; // 'Connected' | 'No Answer' | 'Busy' | 'Switched Off'
  Duration _callDuration = Duration.zero;
  DateTime? _dialedAt;
  Map<String, dynamic>? _foundRecording;
  String? _satisfaction; // 'SATISFIED' | 'UNSATISFIED' | null

  @override
  void initState() {
    super.initState();
    CallChannel.onPlaybackComplete = () {
      if (mounted) setState(() => _isPlayingRecording = false);
    };

    if (widget.autoStartCall) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        _startCall();
      });
    }
  }

  @override
  void dispose() {
    CallChannel.stopRecording();
    CallChannel.onPlaybackComplete = null;
    _tracker.stop();
    _speech.cancel();
    _notesCtrl.dispose();
    super.dispose();
  }

  Future<void> _startCall() async {
    final phone = '${widget.complaint['consumer_phone'] ?? ''}'.replaceAll(RegExp(r'\D'), '');
    if (phone.isEmpty) {
      showSnack(context, 'Valid phone number nahi mila', error: true);
      return;
    }

    Haptics.medium();
    final perms = await CallChannel.ensureCallPermissions();
    _dialedAt = DateTime.now();

    setState(() {
      _isCallActive = true;
      _callEnded = false;
      _callDuration = Duration.zero;
      _callStatus = null;
      _foundRecording = null;
    });

    if (perms.phoneState) {
      try {
        _tracker.start((outcome) => _onCallEnded(phone, outcome));
        final infoJson = jsonEncode({
          'dataid': widget.complaint['complaint_no'],
          'complaint_number': widget.complaint['complaint_no'],
          'consumer_name': widget.complaint['consumer_name'] ?? 'Consumer',
          'substation': widget.complaint['substation'] ?? widget.complaint['area'] ?? '',
          'complaint_sub_type': widget.complaint['complaint_type'] ?? '',
          'remarks': 'Follow-up Call (Previous: UNSATISFIED)',
          'total_complaints': 1,
          'last_status': 'UNSATISFIED',
        });
        CallChannel.startCallMonitor(info: infoJson);
      } catch (_) {}
    }

    // SIM handling
    String? accountId;
    if (perms.callPhone) {
      final saved = Store.simAccountId();
      if (saved != null) {
        accountId = saved == '__default__' ? null : saved;
      } else {
        final accounts = await CallChannel.phoneAccounts();
        if (accounts.length > 1 && mounted) {
          final (aborted, pickedId) = await _chooseSim(accounts);
          if (aborted) {
            _tracker.stop();
            CallChannel.stopCallMonitor();
            setState(() {
              _isCallActive = false;
            });
            return;
          }
          accountId = pickedId;
        }
      }
    }

    final placed = await CallChannel.directCall(phone, accountId: accountId);
    if (!placed) {
      final uri = Uri.parse('tel:$phone');
      if (await canLaunchUrl(uri)) {
        await launchUrl(uri);
      } else {
        _tracker.stop();
        CallChannel.stopCallMonitor();
        if (mounted) {
          setState(() {
            _isCallActive = false;
          });
          showSnack(context, 'Dialer open nahi ho saka', error: true);
        }
      }
    }
  }

  Future<(bool aborted, String? accountId)> _chooseSim(List<PhoneAccount> accounts) async {
    var remember = true;
    final picked = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: AppColors.surface,
      showDragHandle: true,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSheet) => SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text('Call using', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: AppColors.ink)),
              const SizedBox(height: 8),
              ...accounts.map((a) => ListTile(
                    leading: const Icon(Icons.sim_card_outlined, color: AppColors.brand),
                    title: Text(a.label, style: const TextStyle(fontWeight: FontWeight.w600)),
                    onTap: () => Navigator.pop(ctx, a.id),
                  )),
              ListTile(
                leading: const Icon(Icons.settings_outlined, color: AppColors.muted),
                title: const Text('System default', style: TextStyle(fontWeight: FontWeight.w600)),
                onTap: () => Navigator.pop(ctx, '__default__'),
              ),
              CheckboxListTile(
                value: remember,
                dense: true,
                controlAffinity: ListTileControlAffinity.leading,
                title: const Text('Remember my choice', style: TextStyle(fontSize: 13.5)),
                onChanged: (v) => setSheet(() => remember = v ?? true),
              ),
              const SizedBox(height: 8),
            ],
          ),
        ),
      ),
    );
    if (picked == null) return (true, null);
    final id = picked == '__default__' ? null : picked;
    if (remember) {
      final label = id == null ? 'System default' : accounts.firstWhere((a) => a.id == id).label;
      await Store.setSim(id ?? '__default__', label);
    }
    return (false, id);
  }

  Future<void> _onCallEnded(String phone, CallOutcome outcome) async {
    if (!mounted) return;
    Haptics.light();

    setState(() {
      _isCallActive = false;
      _callEnded = true;
      _callDuration = outcome.duration;
      _callStatus = outcome.likelyConnected ? 'Connected' : 'No Answer';
    });

    // Exact duration from system call log if available
    for (var attempt = 0; attempt < 6; attempt++) {
      await Future.delayed(Duration(milliseconds: 800 + attempt * 700));
      final entry = await CallChannel.lastOutgoingCall(phone);
      if (entry == null) continue;

      final since = (_dialedAt ?? DateTime.now().subtract(const Duration(minutes: 5)))
          .subtract(const Duration(seconds: 10));
      if (entry.dateMillis < since.millisecondsSinceEpoch) continue;

      if (!mounted) return;
      setState(() {
        _callStatus = entry.answered ? 'Connected' : 'No Answer';
        _callDuration = Duration(seconds: entry.answered ? entry.durationSeconds : 0);
      });
      break;
    }

    // Scan for Redmi call recording
    final hasPerm = await CallChannel.hasStoragePermission();
    if (hasPerm && mounted) {
      setState(() => _isScanningRecording = true);
      for (var recAttempt = 0; recAttempt < 4; recAttempt++) {
        try {
          final rec = await CallChannel.findLatestRecording(phone, sinceMillis: _dialedAt?.millisecondsSinceEpoch);
          if (rec != null && mounted) {
            setState(() {
              _foundRecording = rec;
              _isScanningRecording = false;
            });
            break;
          }
        } catch (_) {}
        if (recAttempt < 3) await Future.delayed(const Duration(milliseconds: 900));
      }
      if (mounted) setState(() => _isScanningRecording = false);
    }
  }

  Future<void> _toggleListenSpeech() async {
    Haptics.tap();
    if (_isListening) {
      await _speech.stop();
      if (mounted) setState(() => _isListening = false);
      return;
    }

    if (!_speechReady) {
      _speechReady = await _speech.initialize(
        onStatus: (s) {
          if ((s == 'done' || s == 'notListening') && mounted) setState(() => _isListening = false);
        },
        onError: (_) {
          if (mounted) setState(() => _isListening = false);
        },
      );
      if (!_speechReady) {
        if (mounted) showSnack(context, 'Speech recognition available nahi hai', error: true);
        return;
      }
    }

    setState(() => _isListening = true);
    await _speech.listen(
      listenOptions: SpeechListenOptions(partialResults: true, cancelOnError: true),
      onResult: (r) {
        if (!mounted) return;
        setState(() {
          _notesCtrl.text = r.recognizedWords;
        });
      },
    );
  }

  Future<void> _togglePlayLocalRecording() async {
    Haptics.tap();
    if (_isPlayingRecording) {
      await CallChannel.stopRecording();
      if (mounted) setState(() => _isPlayingRecording = false);
      return;
    }

    final path = _foundRecording?['path'] as String?;
    if (path == null) return;

    setState(() => _isPlayingRecording = true);
    final ok = await CallChannel.playRecording(path);
    if (!ok && mounted) {
      setState(() => _isPlayingRecording = false);
      showSnack(context, 'Audio play nahi ho saki', error: true);
    }
  }

  Future<bool> _confirmSatisfactionDialog() async {
    Haptics.warn();
    final result = await showDialog<String>(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Row(
          children: [
            Icon(Icons.help_outline, color: Color(0xFFD97706), size: 24),
            SizedBox(width: 10),
            Expanded(
              child: Text(
                'फीडबैक नहीं चुना गया',
                style: TextStyle(fontSize: 16.5, fontWeight: FontWeight.bold, color: Color(0xFF1E293B)),
              ),
            ),
          ],
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'आपने उपभोक्ता की संतुष्टि स्थिति (संतुष्ट / असंतुष्ट) सेलेक्ट नहीं किया है। क्या आप बिना सेलेक्ट किए भेजना चाहते हैं या अभी चुनना चाहते हैं?',
              style: TextStyle(fontSize: 13.5, color: Color(0xFF334155), height: 1.4),
            ),
            const SizedBox(height: 14),
            const Text(
              'यहाँ से तुरंत चुनें:',
              style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: Color(0xFF64748B)),
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: FilledButton.icon(
                    onPressed: () => Navigator.pop(ctx, 'SATISFIED'),
                    icon: const Text('😊', style: TextStyle(fontSize: 14)),
                    label: const Text('संतुष्ट', style: TextStyle(fontWeight: FontWeight.bold)),
                    style: FilledButton.styleFrom(
                      backgroundColor: const Color(0xFF059669),
                      visualDensity: VisualDensity.compact,
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: FilledButton.icon(
                    onPressed: () => Navigator.pop(ctx, 'UNSATISFIED'),
                    icon: const Text('🙁', style: TextStyle(fontSize: 14)),
                    label: const Text('असंतुष्ट', style: TextStyle(fontWeight: FontWeight.bold)),
                    style: FilledButton.styleFrom(
                      backgroundColor: const Color(0xFFDC2626),
                      visualDensity: VisualDensity.compact,
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, 'DISMISS'),
            child: const Text('वापस जाएं'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, 'PROCEED_EMPTY'),
            child: const Text('बिना चुने भेजें', style: TextStyle(color: Color(0xFF64748B))),
          ),
        ],
      ),
    );

    if (result == 'SATISFIED') {
      if (mounted) setState(() => _satisfaction = 'SATISFIED');
      return true;
    } else if (result == 'UNSATISFIED') {
      if (mounted) setState(() => _satisfaction = 'UNSATISFIED');
      return true;
    } else if (result == 'PROCEED_EMPTY') {
      return true;
    }
    return false;
  }

  Future<void> _submitFollowup() async {
    // If call was connected and satisfaction is empty, prompt operator
    if (_callStatus == 'Connected' && (_satisfaction == null || _satisfaction!.isEmpty)) {
      final proceed = await _confirmSatisfactionDialog();
      if (!proceed) return;
    }

    setState(() => _isSaving = true);

    final complaintNo = '${widget.complaint['complaint_no'] ?? ''}';
    final phone = '${widget.complaint['consumer_phone'] ?? ''}';
    final consumerName = '${widget.complaint['consumer_name'] ?? 'Consumer'}';

    final user = Supabase.instance.client.auth.currentUser;
    final metadata = user?.userMetadata;
    String opName = 'Operator';
    if (metadata != null && metadata['name'] != null && '${metadata['name']}'.trim().isNotEmpty) {
      opName = '${metadata['name']}'.trim();
    } else if (user?.email != null && user!.email!.isNotEmpty) {
      opName = user.email!.split('@').first;
    }

    final notes = _notesCtrl.text.trim();
    final recPath = _foundRecording?['path'] as String?;

    // 1. Upload call recording + metadata to Office Server
    await OfficeSyncService.uploadRecording(
      filePath: recPath,
      complaintNo: complaintNo,
      callTarget: 'CONSUMER',
      phoneNumber: phone,
      contactName: consumerName,
      operatorName: opName,
      operatorId: user?.id,
      durationSeconds: _callDuration.inSeconds,
      callOutcome: _callStatus ?? 'Connected',
      actualProblem: widget.complaint['complaint_type'],
      operatorNotes: notes.isNotEmpty ? notes : 'Follow-up call completed',
      consumerSatisfaction: _satisfaction,
      consumerName: consumerName,
      area: widget.complaint['area'],
      substation: widget.complaint['substation'],
      feeder: widget.complaint['feeder'],
      complaintType: widget.complaint['complaint_type'],
    );

    // 2. If SATISFIED, also ensure complaint satisfaction status is updated on Office Server
    if (_satisfaction == 'SATISFIED') {
      await OfficeSyncService.markComplaintSatisfied(
        complaintNo,
        notes: notes.isNotEmpty ? notes : 'Follow-up call: Consumer satisfied',
        operatorName: opName,
      );
      if (mounted) {
        widget.onRemoveLocal(complaintNo);
        showSnack(context, '✅ शिकायत #$complaintNo संतुष्ट मार्क हो गई (Queue se hat gayi)');
      }
    } else {
      if (mounted) {
        showSnack(context, '⚠️ फॉलोअप सेव हुआ: उपभोक्ता अभी भी असंतुष्ट हैं (लिस्ट में रहेगा)');
      }
    }

    if (mounted) {
      Navigator.pop(context);
      widget.onRefresh();
    }
  }

  @override
  Widget build(BuildContext context) {
    final complaintNo = widget.complaint['complaint_no'] ?? '-';
    final consumerName = widget.complaint['consumer_name'] ?? 'Consumer';
    final phone = widget.complaint['consumer_phone'] ?? '';
    final area = widget.complaint['area'] ?? '';
    final feeder = widget.complaint['feeder'] ?? '';
    final type = widget.complaint['complaint_type'] ?? 'Complaint';

    final compDt = extractComplaintDate(widget.complaint);
    final lastCallDt = extractLastCallDate(widget.complaint);

    return Container(
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      padding: EdgeInsets.only(
        bottom: MediaQuery.of(context).viewInsets.bottom + 16,
      ),
      child: SafeArea(
        top: false,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Drag Handle
              Center(
                child: Container(
                  margin: const EdgeInsets.only(top: 10, bottom: 8),
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(color: const Color(0xFFCBD5E1), borderRadius: BorderRadius.circular(2)),
                ),
              ),

              // Title Header
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(8),
                      decoration: BoxDecoration(
                        color: const Color(0xFFEFF6FF),
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: const Icon(Icons.support_agent, color: Color(0xFF2563EB), size: 22),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('फॉलोअप कॉल (#$complaintNo)', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: AppColors.ink)),
                          Text('$consumerName · $phone', style: const TextStyle(fontSize: 12.5, color: AppColors.inkSoft)),
                        ],
                      ),
                    ),
                    IconButton(
                      icon: const Icon(Icons.close, color: AppColors.muted),
                      onPressed: () => Navigator.pop(context),
                    ),
                  ],
                ),
              ),

              const Divider(height: 16, color: Color(0xFFF1F5F9)),

              // Complaint Details & Timestamp Pill
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: const Color(0xFFF8FAFC),
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: const Color(0xFFE2E8F0)),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          const Icon(Icons.electrical_services, size: 16, color: Color(0xFF64748B)),
                          const SizedBox(width: 6),
                          Expanded(
                            child: Text(
                              '$type | $area ${feeder.isNotEmpty ? "· $feeder" : ""}',
                              style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Color(0xFF334155)),
                            ),
                          ),
                        ],
                      ),
                      if (compDt != null || lastCallDt != null) ...[
                        const SizedBox(height: 6),
                        Row(
                          children: [
                            if (compDt != null)
                              Expanded(
                                child: Text(
                                  'शिकायत: ${DateFormat("dd MMM, hh:mm a").format(compDt)} (${formatRelativeTime(compDt)})',
                                  style: const TextStyle(fontSize: 11, color: Color(0xFF92400E), fontWeight: FontWeight.w600),
                                ),
                              ),
                            if (lastCallDt != null)
                              Expanded(
                                child: Text(
                                  'अंतिम कॉल: ${DateFormat("hh:mm a").format(lastCallDt)} (${formatRelativeTime(lastCallDt)})',
                                  style: const TextStyle(fontSize: 11, color: Color(0xFF1D4ED8), fontWeight: FontWeight.w600),
                                  textAlign: TextAlign.end,
                                ),
                              ),
                          ],
                        ),
                      ],
                    ],
                  ),
                ),
              ),

              const SizedBox(height: 14),

              // Calling Action Area
              if (!_callEnded) ...[
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: Column(
                    children: [
                      if (_isCallActive) ...[
                        Container(
                          padding: const EdgeInsets.all(16),
                          decoration: BoxDecoration(
                            color: const Color(0xFFF0FDF4),
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(color: const Color(0xFF86EFAC)),
                          ),
                          child: const Row(
                            children: [
                              SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Color(0xFF16A34A))),
                              SizedBox(width: 12),
                              Expanded(
                                child: Text(
                                  'कॉल चालू है... बात समाप्त होने पर ऐप में वापस आएं।',
                                  style: TextStyle(fontSize: 13, fontWeight: FontWeight.bold, color: Color(0xFF15803D)),
                                ),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(height: 12),
                      ],
                      SizedBox(
                        width: double.infinity,
                        child: FilledButton.icon(
                          onPressed: _isCallActive ? null : _startCall,
                          icon: const Icon(Icons.call, size: 20),
                          label: Text(
                            _isCallActive ? 'कॉल जारी है...' : 'उपभोक्ता को कॉल करें ($phone)',
                            style: const TextStyle(fontSize: 14, fontWeight: FontWeight.bold),
                          ),
                          style: FilledButton.styleFrom(
                            backgroundColor: const Color(0xFF059669),
                            padding: const EdgeInsets.symmetric(vertical: 13),
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ] else ...[
                // Call Outcome & Duration Summary
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: const Color(0xFFF1F5F9),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: const Color(0xFFE2E8F0)),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                              decoration: BoxDecoration(
                                color: _callStatus == 'Connected' ? const Color(0xFFDCFCE7) : const Color(0xFFFEF3C7),
                                borderRadius: BorderRadius.circular(6),
                              ),
                              child: Text(
                                _callStatus ?? 'Call Finished',
                                style: TextStyle(
                                  fontSize: 12,
                                  fontWeight: FontWeight.bold,
                                  color: _callStatus == 'Connected' ? const Color(0xFF047857) : const Color(0xFFB45309),
                                ),
                              ),
                            ),
                            const SizedBox(width: 10),
                            Text(
                              'Duration: ${_callDuration.inMinutes}:${(_callDuration.inSeconds % 60).toString().padLeft(2, '0')}',
                              style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: AppColors.ink),
                            ),
                            const Spacer(),
                            TextButton.icon(
                              onPressed: _startCall,
                              icon: const Icon(Icons.replay, size: 16),
                              label: const Text('Re-call', style: TextStyle(fontSize: 12)),
                              style: TextButton.styleFrom(visualDensity: VisualDensity.compact),
                            ),
                          ],
                        ),

                        const SizedBox(height: 8),

                        // Audio recording detection
                        if (_isScanningRecording)
                          const Row(
                            children: [
                              SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2)),
                              SizedBox(width: 8),
                              Text('कॉल रिकॉर्डिंग खोजी जा रही है...', style: TextStyle(fontSize: 12, color: AppColors.muted)),
                            ],
                          )
                        else if (_foundRecording != null)
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                            decoration: BoxDecoration(
                              color: const Color(0xFFEFF6FF),
                              borderRadius: BorderRadius.circular(8),
                              border: Border.all(color: const Color(0xFFBFDBFE)),
                            ),
                            child: Row(
                              children: [
                                const Icon(Icons.mic, size: 16, color: Color(0xFF2563EB)),
                                const SizedBox(width: 6),
                                Expanded(
                                  child: Text(
                                    '${_foundRecording!['name']}',
                                    style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w600, color: Color(0xFF1D4ED8)),
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ),
                                InkWell(
                                  onTap: _togglePlayLocalRecording,
                                  child: Container(
                                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                    decoration: BoxDecoration(
                                      color: _isPlayingRecording ? const Color(0xFFFEE2E2) : Colors.white,
                                      borderRadius: BorderRadius.circular(6),
                                      border: Border.all(color: _isPlayingRecording ? const Color(0xFFEF4444) : const Color(0xFF93C5FD)),
                                    ),
                                    child: Row(
                                      mainAxisSize: MainAxisSize.min,
                                      children: [
                                        Icon(_isPlayingRecording ? Icons.stop : Icons.play_arrow, size: 14, color: _isPlayingRecording ? const Color(0xFFDC2626) : const Color(0xFF2563EB)),
                                        const SizedBox(width: 3),
                                        Text(
                                          _isPlayingRecording ? 'Stop' : 'Play',
                                          style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: _isPlayingRecording ? const Color(0xFFDC2626) : const Color(0xFF2563EB)),
                                        ),
                                      ],
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          )
                        else
                          const Text(
                            'ℹ️ लोकल रिकॉर्डिंग फाइल डिटेक्ट नहीं हुई (ऑटो-रिकॉर्डर चेक करें)',
                            style: TextStyle(fontSize: 11.5, color: Color(0xFF94A3B8)),
                          ),
                      ],
                    ),
                  ),
                ),

                const SizedBox(height: 16),

                // COMPULSORY Satisfaction Selection
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Row(
                        children: [
                          Text('उपभोक्ता का फीडबैक चुनें', style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.bold, color: AppColors.ink)),
                          SizedBox(width: 4),
                          Text('*', style: TextStyle(color: Colors.red, fontWeight: FontWeight.bold)),
                        ],
                      ),
                      const SizedBox(height: 8),
                      Row(
                        children: [
                          // SATISFIED Button
                          Expanded(
                            child: InkWell(
                              onTap: () => setState(() => _satisfaction = _satisfaction == 'SATISFIED' ? null : 'SATISFIED'),
                              borderRadius: BorderRadius.circular(12),
                              child: Container(
                                padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 8),
                                decoration: BoxDecoration(
                                  color: _satisfaction == 'SATISFIED' ? const Color(0xFFDCFCE7) : Colors.white,
                                  borderRadius: BorderRadius.circular(12),
                                  border: Border.all(
                                    color: _satisfaction == 'SATISFIED' ? const Color(0xFF059669) : const Color(0xFFCBD5E1),
                                    width: _satisfaction == 'SATISFIED' ? 2 : 1,
                                  ),
                                ),
                                child: Column(
                                  children: [
                                    const Text('😊', style: TextStyle(fontSize: 22)),
                                    const SizedBox(height: 4),
                                    Text(
                                      'संतुष्ट (SATISFIED)',
                                      style: TextStyle(
                                        fontSize: 12.5,
                                        fontWeight: FontWeight.bold,
                                        color: _satisfaction == 'SATISFIED' ? const Color(0xFF047857) : const Color(0xFF334155),
                                      ),
                                    ),
                                    const SizedBox(height: 2),
                                    Text(
                                      'बिजली चालू हो गई',
                                      style: TextStyle(fontSize: 10.5, color: _satisfaction == 'SATISFIED' ? const Color(0xFF065F46) : const Color(0xFF64748B)),
                                    ),
                                  ],
                                ),
                              ),
                            ),
                          ),
                          const SizedBox(width: 10),
                          // UNSATISFIED Button
                          Expanded(
                            child: InkWell(
                              onTap: () => setState(() => _satisfaction = _satisfaction == 'UNSATISFIED' ? null : 'UNSATISFIED'),
                              borderRadius: BorderRadius.circular(12),
                              child: Container(
                                padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 8),
                                decoration: BoxDecoration(
                                  color: _satisfaction == 'UNSATISFIED' ? const Color(0xFFFEE2E2) : Colors.white,
                                  borderRadius: BorderRadius.circular(12),
                                  border: Border.all(
                                    color: _satisfaction == 'UNSATISFIED' ? const Color(0xFFDC2626) : const Color(0xFFCBD5E1),
                                    width: _satisfaction == 'UNSATISFIED' ? 2 : 1,
                                  ),
                                ),
                                child: Column(
                                  children: [
                                    const Text('🙁', style: TextStyle(fontSize: 22)),
                                    const SizedBox(height: 4),
                                    Text(
                                      'असंतुष्ट (UNSATISFIED)',
                                      style: TextStyle(
                                        fontSize: 12.5,
                                        fontWeight: FontWeight.bold,
                                        color: _satisfaction == 'UNSATISFIED' ? const Color(0xFFB91C1C) : const Color(0xFF334155),
                                      ),
                                    ),
                                    const SizedBox(height: 2),
                                    Text(
                                      'समस्या अभी भी है',
                                      style: TextStyle(fontSize: 10.5, color: _satisfaction == 'UNSATISFIED' ? const Color(0xFF991B1B) : const Color(0xFF64748B)),
                                    ),
                                  ],
                                ),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),

                const SizedBox(height: 14),

                // Followup Notes Area
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          const Text('फॉलोअप रिमार्क (Notes)', style: TextStyle(fontSize: 13, fontWeight: FontWeight.bold, color: AppColors.ink)),
                          const Spacer(),
                          InkWell(
                            onTap: _toggleListenSpeech,
                            borderRadius: BorderRadius.circular(12),
                            child: Container(
                              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                              decoration: BoxDecoration(
                                color: _isListening ? const Color(0xFFFEE2E2) : const Color(0xFFF1F5F9),
                                borderRadius: BorderRadius.circular(12),
                              ),
                              child: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Icon(Icons.mic, size: 14, color: _isListening ? Colors.red : const Color(0xFF475569)),
                                  const SizedBox(width: 4),
                                  Text(
                                    _isListening ? 'Listening...' : 'Bol kar likhein',
                                    style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: _isListening ? Colors.red : const Color(0xFF475569)),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 6),
                      TextField(
                        controller: _notesCtrl,
                        maxLines: 2,
                        decoration: InputDecoration(
                          hintText: 'उपभोक्ता से क्या बात हुई...',
                          hintStyle: const TextStyle(fontSize: 13, color: AppColors.muted),
                          border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                          contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                          isDense: true,
                        ),
                      ),
                      const SizedBox(height: 8),

                      // Quick phrase chips
                      Wrap(
                        spacing: 6,
                        runSpacing: 4,
                        children: [
                          _quickChip('सप्लाई सामान्य हो गई ✓', (text) => _notesCtrl.text = text),
                          _quickChip('उपभोक्ता संतुष्ट हैं', (text) => _notesCtrl.text = text),
                          _quickChip('अभी भी सप्लाई बाधित है', (text) => _notesCtrl.text = text),
                          _quickChip('कॉल नहीं उठाया', (text) => _notesCtrl.text = text),
                        ],
                      ),
                    ],
                  ),
                ),

                const SizedBox(height: 18),

                // Save & Submit Button
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: SizedBox(
                    width: double.infinity,
                    child: FilledButton.icon(
                      onPressed: _isSaving ? null : _submitFollowup,
                      icon: _isSaving
                          ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                          : const Icon(Icons.cloud_upload_outlined, size: 18),
                      label: Text(
                        _isSaving ? 'सेव हो रहा है...' : 'फॉलोअप कॉल सेव करें (Save & Upload)',
                        style: const TextStyle(fontSize: 14, fontWeight: FontWeight.bold),
                      ),
                      style: FilledButton.styleFrom(
                        backgroundColor: const Color(0xFF2563EB),
                        padding: const EdgeInsets.symmetric(vertical: 13),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                      ),
                    ),
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _quickChip(String text, Function(String) onPick) {
    return InkWell(
      onTap: () => onPick(text),
      borderRadius: BorderRadius.circular(14),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(
          color: const Color(0xFFF1F5F9),
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: const Color(0xFFCBD5E1)),
        ),
        child: Text(text, style: const TextStyle(fontSize: 11, color: Color(0xFF334155))),
      ),
    );
  }
}
