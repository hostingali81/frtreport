import 'dart:async';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';

import '../call_channel.dart';
import '../office_sync.dart';
import '../theme.dart';
import '../widgets.dart';

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
  String _dateFilter = 'all'; // 'all' | 'today' | 'yesterday'
  int? _playingRecordingId;

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

    setState(() {
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

        // Date filter
        if (_dateFilter != 'all') {
          final lastAct = '${c['last_activity_at'] ?? ''}';
          final recs = c['recordings'] as List?;
          final lastRecTime = (recs != null && recs.isNotEmpty) ? '${recs.last['call_time'] ?? ''}' : '';
          final dateStr = lastRecTime.isNotEmpty ? lastRecTime.split('T').first : lastAct.split(' ').first;

          if (_dateFilter == 'today' && dateStr != todayStr) return false;
          if (_dateFilter == 'yesterday' && dateStr != yesterdayStr) return false;
        }

        return true;
      }).toList();
    });
  }

  Future<void> _makeCall(String phoneNumber) async {
    Haptics.medium();
    final clean = phoneNumber.replaceAll(RegExp(r'\D'), '');
    if (clean.isEmpty) return;

    final directOk = await CallChannel.directCall(clean);
    if (!directOk) {
      final uri = Uri.parse('tel:$clean');
      if (await canLaunchUrl(uri)) {
        await launchUrl(uri);
      }
    }
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

  Future<void> _markSatisfiedDialog(Map<String, dynamic> comp) async {
    final complaintNo = comp['complaint_no'] as String;
    final consumerName = comp['consumer_name'] ?? 'Consumer';
    final notesCtrl = TextEditingController(text: 'Follow-up call: Supply restored, consumer satisfied');

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(color: const Color(0xFFDCFCE7), borderRadius: BorderRadius.circular(10)),
              child: const Icon(Icons.check_circle_outline, color: Color(0xFF059669), size: 24),
            ),
            const SizedBox(width: 12),
            const Expanded(
              child: Text('संतुष्ट मार्क करें', style: TextStyle(fontSize: 17, fontWeight: FontWeight.bold)),
            ),
          ],
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'क्या उपभोक्ता $consumerName (#$complaintNo) अब संतुष्ट हैं?',
              style: const TextStyle(fontSize: 14, color: AppColors.ink),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: notesCtrl,
              maxLines: 2,
              decoration: const InputDecoration(
                labelText: 'फॉलोअप रिमार्क (Notes)',
                border: OutlineInputBorder(),
                alignLabelWithHint: true,
              ),
            ),
          ],
        ),
        actions: [
          OutlinedButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('रद्द करें')),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: FilledButton.styleFrom(backgroundColor: const Color(0xFF059669)),
            child: const Text('हाँ, संतुष्ट है ✓'),
          ),
        ],
      ),
    );

    if (confirmed == true) {
      Haptics.success();
      final ok = await OfficeSyncService.markComplaintSatisfied(complaintNo, notes: notesCtrl.text.trim());
      if (ok && mounted) {
        showSnack(context, 'Complaint #$complaintNo ko Satisfied mark kar diya gaya! ✓');
        _load(forceRefresh: false);
      } else if (mounted) {
        showSnack(context, 'Office PC se update nahi hua, Wi-Fi check karein', error: true);
      }
    }
  }

  void _showServerDialog() {
    final ipCtrl = TextEditingController(text: _serverUrl?.replaceAll('http://', '').replaceAll(':8080', '') ?? '');
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Text('Office PC Server', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'AirFiber router restart hone par PC ka IP badal sakta hai. App apne aap nayi IP dhoondh leta hai.',
              style: TextStyle(fontSize: 12.5, color: AppColors.inkSoft),
            ),
            const SizedBox(height: 14),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: ipCtrl,
                    decoration: const InputDecoration(
                      labelText: 'Server IP (e.g. 192.168.31.68)',
                      prefixText: 'http://',
                      suffixText: ':8080',
                      border: OutlineInputBorder(),
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
        actions: [
          OutlinedButton.icon(
            icon: const Icon(Icons.refresh, size: 16),
            label: const Text('Auto-Scan'),
            onPressed: () {
              Navigator.pop(ctx);
              _load(forceRefresh: true);
            },
          ),
          FilledButton(
            onPressed: () async {
              final raw = ipCtrl.text.trim();
              if (raw.isNotEmpty) {
                Navigator.pop(ctx);
                final ok = await OfficeSyncService.setManualServerUrl(raw);
                if (ok && mounted) {
                  showSnack(context, 'Server connected: $raw');
                  _load();
                } else if (mounted) {
                  showSnack(context, 'Is IP par server nahi mila', error: true);
                }
              }
            },
            child: const Text('Save & Connect'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final isOnline = _serverUrl != null;

    return Scaffold(
      backgroundColor: AppColors.bg,
      body: RefreshIndicator(
        onRefresh: () => _load(forceRefresh: true),
        color: AppColors.brand,
        child: CustomScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          slivers: [
            SliverAppBar(
              floating: true,
              pinned: true,
              backgroundColor: AppColors.bg,
              elevation: 0,
              title: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('Follow-up', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 19)),
                  Text(
                    '${_filtered.length} असंतोषजनक शिकायतें',
                    style: const TextStyle(fontSize: 11.5, color: Color(0xFFDC2626), fontWeight: FontWeight.bold),
                  ),
                ],
              ),
              actions: [
                // Server Connection Pill
                InkWell(
                  onTap: _showServerDialog,
                  borderRadius: BorderRadius.circular(16),
                  child: Container(
                    margin: const EdgeInsets.symmetric(vertical: 10),
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(
                      color: isOnline ? const Color(0xFFDCFCE7) : const Color(0xFFFEE2E2),
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(color: isOnline ? const Color(0xFF86EFAC) : const Color(0xFFFECACA)),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(
                          Icons.circle,
                          size: 8,
                          color: isOnline ? const Color(0xFF16A34A) : const Color(0xFFDC2626),
                        ),
                        const SizedBox(width: 5),
                        Text(
                          isOnline ? _serverUrl!.replaceAll('http://', '').split(':').first : 'Offline',
                          style: TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.bold,
                            color: isOnline ? const Color(0xFF166534) : const Color(0xFF991B1B),
                          ),
                        ),
                        const SizedBox(width: 3),
                        Icon(Icons.tune, size: 12, color: isOnline ? const Color(0xFF166534) : const Color(0xFF991B1B)),
                      ],
                    ),
                  ),
                ),
                IconButton(
                  icon: _syncing
                      ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                      : const Icon(Icons.refresh),
                  onPressed: _syncing ? null : () => _load(forceRefresh: true),
                  tooltip: 'Refresh from Server',
                ),
              ],
            ),

            // Search Bar & Filter Chips
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 4, 16, 10),
                child: Column(
                  children: [
                    TextField(
                      controller: _searchController,
                      onChanged: (val) {
                        _search = val;
                        _applyFilters();
                      },
                      decoration: InputDecoration(
                        hintText: 'Search Complaint no, Name, Phone...',
                        prefixIcon: const Icon(Icons.search, size: 20),
                        suffixIcon: _search.isNotEmpty
                            ? IconButton(
                                icon: const Icon(Icons.clear, size: 18),
                                onPressed: () {
                                  _searchController.clear();
                                  _search = '';
                                  _applyFilters();
                                },
                              )
                            : null,
                        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                        filled: true,
                        fillColor: Colors.white,
                        border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: Color(0xFFCBD5E1))),
                        enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: Color(0xFFE2E8F0))),
                      ),
                    ),
                    const SizedBox(height: 8),
                    Row(
                      children: [
                        _FilterChip(
                          label: 'All (${_complaints.length})',
                          selected: _dateFilter == 'all',
                          onTap: () {
                            setState(() => _dateFilter = 'all');
                            _applyFilters();
                          },
                        ),
                        const SizedBox(width: 8),
                        _FilterChip(
                          label: 'Today',
                          selected: _dateFilter == 'today',
                          onTap: () {
                            setState(() => _dateFilter = 'today');
                            _applyFilters();
                          },
                        ),
                        const SizedBox(width: 8),
                        _FilterChip(
                          label: 'Yesterday',
                          selected: _dateFilter == 'yesterday',
                          onTap: () {
                            setState(() => _dateFilter = 'yesterday');
                            _applyFilters();
                          },
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),

            // Content Body
            if (_loading)
              const SliverFillRemaining(child: Center(child: CircularProgressIndicator()))
            else if (_filtered.isEmpty)
              SliverFillRemaining(
                child: Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Container(
                        padding: const EdgeInsets.all(16),
                        decoration: BoxDecoration(color: const Color(0xFFDCFCE7), borderRadius: BorderRadius.circular(30)),
                        child: const Icon(Icons.sentiment_very_satisfied, size: 40, color: Color(0xFF059669)),
                      ),
                      const SizedBox(height: 14),
                      const Text(
                        'शानदार! कोई असंतोषजनक शिकायत नहीं',
                        style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: AppColors.ink),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        isOnline ? 'सभी उपभोक्ताओं ने संतुष्टि व्यक्त की है।' : 'Office Wi-Fi se connect karein nayi list ke liye.',
                        style: const TextStyle(fontSize: 12.5, color: AppColors.inkSoft),
                      ),
                    ],
                  ),
                ),
              )
            else
              SliverPadding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 80),
                sliver: SliverList(
                  delegate: SliverChildBuilderDelegate(
                    (context, idx) {
                      final comp = _filtered[idx];
                      return _FollowupCard(
                        complaint: comp,
                        playingRecordingId: _playingRecordingId,
                        onCall: () => _makeCall('${comp['consumer_phone'] ?? ''}'),
                        onToggleAudio: (recId) => _toggleAudio(recId),
                        onMarkSatisfied: () => _markSatisfiedDialog(comp),
                      );
                    },
                    childCount: _filtered.length,
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _FilterChip extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onTap;
  const _FilterChip({required this.label, required this.selected, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(16),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
        decoration: BoxDecoration(
          color: selected ? AppColors.brand : Colors.white,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: selected ? AppColors.brand : const Color(0xFFCBD5E1)),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 11.5,
            fontWeight: FontWeight.bold,
            color: selected ? Colors.white : AppColors.inkSoft,
          ),
        ),
      ),
    );
  }
}

class _FollowupCard extends StatelessWidget {
  final Map<String, dynamic> complaint;
  final int? playingRecordingId;
  final VoidCallback onCall;
  final Function(int) onToggleAudio;
  final VoidCallback onMarkSatisfied;

  const _FollowupCard({
    required this.complaint,
    required this.playingRecordingId,
    required this.onCall,
    required this.onToggleAudio,
    required this.onMarkSatisfied,
  });

  @override
  Widget build(BuildContext context) {
    final complaintNo = '${complaint['complaint_no'] ?? ''}';
    final consumerName = '${complaint['consumer_name'] ?? 'Consumer'}';
    final phone = '${complaint['consumer_phone'] ?? ''}';
    final area = '${complaint['area'] ?? ''}';
    final feeder = '${complaint['feeder'] ?? ''}';
    final type = '${complaint['complaint_type'] ?? 'No Supply'}';

    final recs = (complaint['recordings'] as List?) ?? [];
    final lastRec = recs.isNotEmpty ? recs.last as Map<String, dynamic> : null;
    final lastOp = lastRec != null ? '${lastRec['operator_name'] ?? 'Operator'}' : '';
    final lastProblem = lastRec != null ? '${lastRec['actual_problem'] ?? ''}' : '';
    final lastNotes = lastRec != null ? '${lastRec['operator_notes'] ?? ''}' : '';
    final recId = lastRec != null ? lastRec['id'] as int? : null;
    final isPlaying = recId != null && playingRecordingId == recId;

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
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Top Header
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
                    // Call Button
                    FilledButton.icon(
                      onPressed: onCall,
                      icon: const Icon(Icons.call, size: 16),
                      label: Text(phone, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
                      style: FilledButton.styleFrom(
                        backgroundColor: const Color(0xFF2563EB),
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                        visualDensity: VisualDensity.compact,
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
                          Text(
                            'Previous Call ($lastOp):',
                            style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Color(0xFF475569)),
                          ),
                          const Spacer(),
                          if (recId != null)
                            InkWell(
                              onTap: () => onToggleAudio(recId),
                              borderRadius: BorderRadius.circular(12),
                              child: Container(
                                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                decoration: BoxDecoration(
                                  color: isPlaying ? const Color(0xFFFEE2E2) : const Color(0xFFEFF6FF),
                                  borderRadius: BorderRadius.circular(12),
                                  border: Border.all(color: isPlaying ? const Color(0xFFEF4444) : const Color(0xFF93C5FD)),
                                ),
                                child: Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    Icon(isPlaying ? Icons.stop : Icons.play_arrow, size: 13, color: isPlaying ? const Color(0xFFDC2626) : const Color(0xFF1D4ED8)),
                                    const SizedBox(width: 3),
                                    Text(
                                      isPlaying ? 'Stop' : 'Audio',
                                      style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.bold, color: isPlaying ? const Color(0xFFDC2626) : const Color(0xFF1D4ED8)),
                                    ),
                                  ],
                                ),
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

                // Bottom Actions: Mark Satisfied Button
                SizedBox(
                  width: double.infinity,
                  child: OutlinedButton.icon(
                    onPressed: onMarkSatisfied,
                    icon: const Text('😊', style: TextStyle(fontSize: 14)),
                    label: const Text(
                      'Mark Satisfied (संतुष्ट मार्क करें)',
                      style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12.5, color: Color(0xFF047857)),
                    ),
                    style: OutlinedButton.styleFrom(
                      side: const BorderSide(color: Color(0xFF10B981), width: 1.2),
                      backgroundColor: const Color(0xFFF0FDF4),
                      padding: const EdgeInsets.symmetric(vertical: 9),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
