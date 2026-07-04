import 'package:flutter/material.dart';

import '../api.dart';
import '../storage.dart';
import '../theme.dart';
import '../widgets.dart';

const _statuses = ['Connected', 'No Answer', 'Switched Off', 'Busy', 'Wrong Number'];

// Everything that still needs attention after calls were made:
//  - drafts: a call happened but no outcome was chosen (finish them here),
//  - outbox: complete logs waiting for the network.
class PendingSheet extends StatefulWidget {
  final Future<void> Function() onChanged; // refresh complaints behind the sheet
  const PendingSheet({super.key, required this.onChanged});

  @override
  State<PendingSheet> createState() => _PendingSheetState();
}

class _PendingSheetState extends State<PendingSheet> {
  bool _syncing = false;

  String _ago(String? iso) {
    final t = iso == null ? null : DateTime.tryParse(iso);
    if (t == null) return '';
    final m = DateTime.now().difference(t).inMinutes;
    if (m < 1) return 'just now';
    if (m < 60) return '${m}m ago';
    return '${m ~/ 60}h ${m % 60}m ago';
  }

  String _fmtDur(int? secs) {
    if (secs == null) return '';
    return '${secs ~/ 60}:${(secs % 60).toString().padLeft(2, '0')}';
  }

  Future<void> _syncNow() async {
    Haptics.medium();
    setState(() => _syncing = true);
    final n = await Store.syncOutbox();
    if (!mounted) return;
    setState(() => _syncing = false);
    if (n > 0) {
      showSnack(context, '$n log${n == 1 ? '' : 's'} synced');
      widget.onChanged();
    } else {
      showSnack(context, 'Still offline — will retry automatically', error: true);
    }
  }

  Future<void> _finishDraft(Map<String, dynamic> draft) async {
    final saved = await showDialog<bool>(
      context: context,
      builder: (_) => _DraftDialog(draft: draft),
    );
    if (saved == true) {
      Haptics.success();
      widget.onChanged();
    }
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final drafts = Store.drafts();
    final outbox = Store.outbox();
    final bottomSafe = MediaQuery.of(context).viewPadding.bottom;

    return SafeArea(
      child: SingleChildScrollView(
        padding: EdgeInsets.fromLTRB(16, 4, 16, 20 + bottomSafe),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Pending call logs', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: AppColors.ink)),
            Gap.md,

            if (drafts.isEmpty && outbox.isEmpty)
              const EmptyState(icon: Icons.task_alt, title: 'All caught up', subtitle: 'No pending call logs.'),

            if (drafts.isNotEmpty) ...[
              SectionHeader('Needs outcome (${drafts.length})'),
              ...drafts.reversed.map((d) => Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: AppCard(
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                      onTap: () => _finishDraft(d),
                      child: Row(children: [
                        Expanded(
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Text('${d['complaint_number'] ?? '#${d['dataid']}'}', style: const TextStyle(fontFamily: 'monospace', fontWeight: FontWeight.bold, fontSize: 13)),
                            const SizedBox(height: 2),
                            Text('${d['title'] ?? ''} · ${d['area'] ?? ''}', style: const TextStyle(fontSize: 12, color: AppColors.inkSoft), overflow: TextOverflow.ellipsis),
                            const SizedBox(height: 4),
                            Row(children: [
                              if (d['duration_seconds'] != null) Pill('Call ${_fmtDur((d['duration_seconds'] as num?)?.toInt())}', fg: AppColors.inkSoft, bg: const Color(0xFFEFF2F7)),
                              Gap.xs,
                              Text(_ago(d['call_time']), style: const TextStyle(fontSize: 11, color: AppColors.muted)),
                            ]),
                          ]),
                        ),
                        IconButton(
                          tooltip: 'Discard',
                          icon: const Icon(Icons.delete_outline, size: 19, color: AppColors.muted),
                          onPressed: () async {
                            await Store.removeDraft((d['dataid'] as num).toInt());
                            if (mounted) setState(() {});
                          },
                        ),
                        const Icon(Icons.chevron_right, size: 18, color: AppColors.muted),
                      ]),
                    ),
                  )),
              Gap.md,
            ],

            if (outbox.isNotEmpty) ...[
              SectionHeader(
                'Waiting for network (${outbox.length})',
                trailing: TextButton.icon(
                  onPressed: _syncing ? null : _syncNow,
                  icon: _syncing
                      ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2))
                      : const Icon(Icons.sync, size: 16),
                  label: const Text('Sync now'),
                ),
              ),
              ...outbox.reversed.map((o) => Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: AppCard(
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                      child: Row(children: [
                        const Icon(Icons.cloud_upload_outlined, size: 18, color: AppColors.muted),
                        Gap.sm,
                        Expanded(
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Text('${o['complaint_number'] ?? '#${o['dataid']}'} · ${o['call_status'] ?? ''}', style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: AppColors.ink)),
                            Text('Queued ${_ago(o['_queued_at'])}', style: const TextStyle(fontSize: 11, color: AppColors.muted)),
                          ]),
                        ),
                        IconButton(
                          tooltip: 'Discard',
                          icon: const Icon(Icons.delete_outline, size: 19, color: AppColors.muted),
                          onPressed: () async {
                            await Store.removeFromOutbox((o['_qid'] as num?)?.toInt() ?? -1);
                            if (mounted) setState(() {});
                          },
                        ),
                      ]),
                    ),
                  )),
            ],
          ],
        ),
      ),
    );
  }
}

// Minimal "finish the log" dialog for a draft: outcome + optional note.
class _DraftDialog extends StatefulWidget {
  final Map<String, dynamic> draft;
  const _DraftDialog({required this.draft});

  @override
  State<_DraftDialog> createState() => _DraftDialogState();
}

class _DraftDialogState extends State<_DraftDialog> {
  String? _status;
  final _notes = TextEditingController();
  bool _saving = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _status = widget.draft['suggested_status'] as String?;
  }

  @override
  void dispose() {
    _notes.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_status == null) {
      setState(() => _error = 'Select the call outcome');
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    final d = widget.draft;
    final secs = (d['duration_seconds'] as num?)?.toInt();
    final base = _notes.text.trim();
    final durText = secs == null ? '' : 'Call ${secs ~/ 60}:${(secs % 60).toString().padLeft(2, '0')}';
    final payload = {
      'dataid': (d['dataid'] as num).toInt(),
      'complaint_number': d['complaint_number'],
      'call_status': _status,
      'problem_category': null,
      'notes': [durText, base].where((s) => s.isNotEmpty).join(' · ').isEmpty ? null : [durText, base].where((s) => s.isNotEmpty).join(' · '),
      'duration_seconds': secs,
      'connected': d['connected'] ?? (_status == 'Connected'),
    };
    try {
      await Api.logRaw(payload);
    } on ApiException catch (e) {
      if (mounted) {
        setState(() {
          _error = '$e';
          _saving = false;
        });
      }
      return;
    } catch (_) {
      await Store.queueLog(payload); // offline — moves to the outbox
    }
    await Store.removeDraft((d['dataid'] as num).toInt());
    if (mounted) Navigator.pop(context, true);
  }

  @override
  Widget build(BuildContext context) {
    final d = widget.draft;
    return AlertDialog(
      backgroundColor: AppColors.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(kRadius)),
      title: Text('${d['complaint_number'] ?? '#${d['dataid']}'}', style: const TextStyle(fontFamily: 'monospace', fontSize: 15, fontWeight: FontWeight.bold)),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: _statuses.map((s) {
              final sel = _status == s;
              return ChoiceChip(
                label: Text(s),
                selected: sel,
                showCheckmark: false,
                selectedColor: AppColors.brand,
                backgroundColor: Colors.white,
                side: BorderSide(color: sel ? AppColors.brand : AppColors.border),
                labelStyle: TextStyle(color: sel ? Colors.white : AppColors.inkSoft, fontWeight: FontWeight.w600, fontSize: 12.5),
                onSelected: (_) => setState(() => _status = s),
              );
            }).toList(),
          ),
          Gap.md,
          TextField(
            controller: _notes,
            maxLines: 2,
            decoration: const InputDecoration(labelText: 'Notes (optional)', alignLabelWithHint: true),
          ),
          if (_error != null) ...[Gap.sm, Text(_error!, style: const TextStyle(color: AppColors.danger, fontSize: 12.5))],
        ],
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
        FilledButton(
          onPressed: _saving ? null : _save,
          child: _saving
              ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
              : const Text('Save'),
        ),
      ],
    );
  }
}
