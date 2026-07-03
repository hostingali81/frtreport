import 'dart:async';

import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api.dart';
import '../call_tracker.dart';
import '../models.dart';
import '../sla.dart';
import '../theme.dart';
import '../widgets.dart';

const _callStatuses = ['Connected', 'No Answer', 'Switched Off', 'Busy', 'Wrong Number'];
const _categories = ['Meter Fault', 'Wire Broken', 'Transformer', 'Voltage', 'Pole / Line', 'No Fault Found', 'Other'];

class DetailSheet extends StatefulWidget {
  final Complaint complaint;
  final Future<void> Function() onLogged;
  const DetailSheet({super.key, required this.complaint, required this.onLogged});

  @override
  State<DetailSheet> createState() => _DetailSheetState();
}

class _DetailSheetState extends State<DetailSheet> {
  Contact? _contact;
  bool _loadingContact = true;
  String? _contactError;

  String? _callStatus;
  String? _category;
  final _notes = TextEditingController();
  bool _saving = false;
  String? _saveError;

  final _tracker = CallTracker();
  Duration? _callDuration;
  bool _callTracked = false;

  DateTime _now = DateTime.now();
  Timer? _tick;

  String _fmtMs(Duration d) => '${d.inMinutes}:${(d.inSeconds % 60).toString().padLeft(2, '0')}';

  @override
  void initState() {
    super.initState();
    _tick = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() => _now = DateTime.now());
    });
    _fetchContact();
  }

  @override
  void dispose() {
    _tick?.cancel();
    _tracker.stop();
    _notes.dispose();
    super.dispose();
  }

  Future<void> _fetchContact() async {
    try {
      final c = await Api.contact(widget.complaint.dataid);
      if (!mounted) return;
      setState(() {
        _contact = c;
        _loadingContact = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _contactError = '$e';
        _loadingContact = false;
      });
    }
  }

  Future<void> _call(String mobile) async {
    Haptics.medium();
    try {
      if (await _tracker.ensurePermission()) {
        _tracker.start((outcome) {
          if (!mounted) return;
          Haptics.light();
          setState(() {
            _callDuration = outcome.duration;
            _callTracked = true;
            _callStatus ??= outcome.likelyConnected ? 'Connected' : 'No Answer';
          });
        });
      }
    } catch (_) {
      /* still place the call */
    }
    final uri = Uri.parse('tel:$mobile');
    if (!await launchUrl(uri)) {
      if (mounted) showSnack(context, 'Could not open the dialer', error: true);
    }
  }

  Future<void> _save() async {
    if (_callStatus == null) {
      Haptics.warn();
      setState(() => _saveError = 'Select a call outcome');
      return;
    }
    setState(() {
      _saving = true;
      _saveError = null;
    });
    try {
      final base = _notes.text.trim();
      final notes = _callTracked && _callDuration != null
          ? 'Call ${_fmtMs(_callDuration!)}${base.isEmpty ? '' : ' · $base'}'
          : (base.isEmpty ? null : base);
      await Api.log(
        dataid: widget.complaint.dataid,
        complaintNumber: widget.complaint.complaintNumber,
        callStatus: _callStatus!,
        problemCategory: _category,
        notes: notes,
      );
      Haptics.success();
      await widget.onLogged();
      if (mounted) {
        showSnack(context, 'Call logged');
        Navigator.pop(context);
      }
    } catch (e) {
      Haptics.error();
      if (mounted) setState(() => _saveError = '$e');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = widget.complaint;
    final sla = slaFor(c, _now);
    final limitH = (c.areaType ?? '').toLowerCase().contains('urban') ? 1 : 2;

    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: DraggableScrollableSheet(
        initialChildSize: 0.9,
        maxChildSize: 0.96,
        minChildSize: 0.5,
        expand: false,
        builder: (_, controller) => ListView(
          controller: controller,
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(c.complaintNumber ?? '#${c.dataid}', style: const TextStyle(fontFamily: 'monospace', fontWeight: FontWeight.bold, fontSize: 15)),
                      const SizedBox(height: 2),
                      Text('${c.complaintSubType ?? c.complaintType ?? ''} · ${c.area ?? ''}', style: const TextStyle(fontSize: 12.5, color: AppColors.inkSoft)),
                    ],
                  ),
                ),
                Pill(c.actionStatus ?? '—', fg: statusColor(c.actionStatus)),
              ],
            ),
            Gap.md,

            // SLA / timing
            AppCard(
              padding: const EdgeInsets.all(12),
              child: Row(
                children: [
                  const Icon(Icons.schedule, size: 18, color: AppColors.muted),
                  Gap.sm,
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(fmtDateTime(c.complaintDate), style: const TextStyle(fontSize: 13, color: AppColors.ink, fontWeight: FontWeight.w500)),
                        Text('${elapsedLabel(c.complaintDate, _now)} · SLA ${limitH}h (${c.areaType ?? 'Rural'})', style: const TextStyle(fontSize: 12, color: AppColors.inkSoft)),
                      ],
                    ),
                  ),
                  AnimatedContainer(
                    duration: const Duration(milliseconds: 300),
                    padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 6),
                    decoration: BoxDecoration(color: sla.bg, borderRadius: BorderRadius.circular(kRadiusSm)),
                    child: Text(sla.text, style: TextStyle(color: sla.fg, fontWeight: FontWeight.bold, fontFeatures: const [FontFeature.tabularFigures()])),
                  ),
                ],
              ),
            ),
            Gap.md,

            // Contact
            AppCard(
              background: const Color(0xFFFBFCFE),
              child: _loadingContact
                  ? const Padding(padding: EdgeInsets.symmetric(vertical: 16), child: Center(child: Text('Fetching consumer contact…', style: TextStyle(color: AppColors.muted))))
                  : _contactError != null
                      ? Row(children: [const Icon(Icons.error_outline, color: AppColors.danger, size: 18), Gap.sm, Expanded(child: Text(_contactError!, style: const TextStyle(color: AppColors.danger)))])
                      : _contactCard(_contact!),
            ),
            Gap.lg,

            // Auto call-outcome banner
            AnimatedSize(
              duration: const Duration(milliseconds: 220),
              child: _callTracked
                  ? Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: Container(
                        width: double.infinity,
                        padding: const EdgeInsets.all(11),
                        decoration: BoxDecoration(color: AppColors.successBg, borderRadius: BorderRadius.circular(kRadiusSm), border: Border.all(color: const Color(0xFFA7F3D0))),
                        child: Row(children: [
                          const Icon(Icons.call_end, size: 18, color: AppColors.success),
                          Gap.sm,
                          Expanded(child: Text('Call ended · lasted ${_fmtMs(_callDuration ?? Duration.zero)} · suggested "${_callStatus ?? '—'}". Adjust if needed.', style: const TextStyle(fontSize: 12.5, color: Color(0xFF065F46)))),
                        ]),
                      ),
                    )
                  : const SizedBox(width: double.infinity),
            ),

            const SectionHeader('Call outcome'),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: _callStatuses.map((s) {
                final sel = _callStatus == s;
                return ChoiceChip(
                  label: Text(s),
                  selected: sel,
                  showCheckmark: false,
                  selectedColor: AppColors.brand,
                  backgroundColor: Colors.white,
                  side: BorderSide(color: sel ? AppColors.brand : AppColors.border),
                  labelStyle: TextStyle(color: sel ? Colors.white : AppColors.inkSoft, fontWeight: FontWeight.w600, fontSize: 13),
                  onSelected: (_) {
                    Haptics.tap();
                    setState(() {
                      _callStatus = s;
                      _saveError = null;
                    });
                  },
                );
              }).toList(),
            ),
            Gap.md,
            DropdownButtonFormField<String>(
              initialValue: _category,
              isExpanded: true,
              icon: const Icon(Icons.expand_more, color: AppColors.muted),
              decoration: const InputDecoration(labelText: 'Problem category (optional)'),
              items: _categories.map((e) => DropdownMenuItem(value: e, child: Text(e))).toList(),
              onChanged: (v) {
                Haptics.tap();
                setState(() => _category = v);
              },
            ),
            Gap.sm,
            TextField(
              controller: _notes,
              maxLines: 2,
              decoration: const InputDecoration(labelText: 'Notes — what did the consumer say?', alignLabelWithHint: true),
            ),
            if (_saveError != null) ...[Gap.sm, Text(_saveError!, style: const TextStyle(color: AppColors.danger))],
            Gap.lg,
            Row(
              children: [
                Expanded(child: OutlinedButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel'))),
                Gap.sm,
                Expanded(
                  flex: 2,
                  child: FilledButton(
                    onPressed: _saving ? null : _save,
                    child: _saving
                        ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                        : const Text('Save call log'),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _contactCard(Contact c) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(children: [
          const Icon(Icons.person, size: 18, color: AppColors.inkSoft),
          Gap.sm,
          Expanded(child: Text(c.consumerName ?? 'Unknown consumer', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: AppColors.ink))),
        ]),
        if (c.address != null) Padding(padding: const EdgeInsets.only(top: 6), child: Text(c.address!, style: const TextStyle(fontSize: 13.5, color: AppColors.inkSoft))),
        if (c.landmark != null) Text('Landmark: ${c.landmark}', style: const TextStyle(fontSize: 12, color: AppColors.muted)),
        if (c.substation != null || c.assignedCrew != null)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Wrap(spacing: 6, runSpacing: 6, children: [
              if (c.substation != null) Pill('SS: ${c.substation}', fg: AppColors.inkSoft, bg: const Color(0xFFEFF2F7)),
              if (c.assignedCrew != null) Pill('Crew: ${c.assignedCrew}', fg: AppColors.inkSoft, bg: const Color(0xFFEFF2F7)),
            ]),
          ),
        if (c.remarks != null) Padding(padding: const EdgeInsets.only(top: 6), child: Text('"${c.remarks}"', style: const TextStyle(fontSize: 12.5, fontStyle: FontStyle.italic, color: AppColors.muted))),
        Gap.md,
        if (c.mobile != null && c.mobile!.isNotEmpty)
          SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              onPressed: () => _call(c.mobile!),
              icon: const Icon(Icons.phone),
              label: Text('Call  ${c.mobile}', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
              style: FilledButton.styleFrom(backgroundColor: AppColors.success, padding: const EdgeInsets.symmetric(vertical: 15)),
            ),
          )
        else
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(11),
            decoration: BoxDecoration(color: AppColors.warningBg, borderRadius: BorderRadius.circular(kRadiusSm)),
            child: const Text('No mobile number on record', textAlign: TextAlign.center, style: TextStyle(color: AppColors.warning, fontWeight: FontWeight.w600)),
          ),
      ],
    );
  }
}
