import 'dart:async';

import 'package:flutter/material.dart';
import 'package:speech_to_text/speech_to_text.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api.dart';
import '../call_channel.dart';
import '../call_tracker.dart';
import '../models.dart';
import '../sla.dart';
import '../storage.dart';
import '../theme.dart';
import '../widgets.dart';

const _callStatuses = ['Connected', 'No Answer', 'Switched Off', 'Busy', 'Wrong Number'];
const _categories = ['Meter Fault', 'Wire Broken', 'Transformer', 'Voltage', 'Pole / Line', 'No Fault Found', 'Other'];

// Complaint sub-type usually hints at the problem — pre-select the category as
// a default the operator can still change.
String? _defaultCategory(String? subType) {
  final t = (subType ?? '').toLowerCase();
  if (t.contains('transformer')) return 'Transformer';
  if (t.contains('meter')) return 'Meter Fault';
  if (t.contains('wire') || t.contains('conductor') || t.contains('cable')) return 'Wire Broken';
  if (t.contains('voltage')) return 'Voltage';
  if (t.contains('pole')) return 'Pole / Line';
  return null;
}

class DetailSheet extends StatefulWidget {
  final Complaint complaint;
  final Future<void> Function() onLogged;

  // Power-dialer session: shows "n / total", auto-dials after a short
  // countdown, and swaps the buttons to End / Skip / Save & Next. The sheet
  // pops with 'logged' | 'skip' | 'exit'.
  final int? sessionIndex;
  final int? sessionTotal;

  const DetailSheet({super.key, required this.complaint, required this.onLogged, this.sessionIndex, this.sessionTotal});

  @override
  State<DetailSheet> createState() => _DetailSheetState();
}

class _DetailSheetState extends State<DetailSheet> {
  Contact? _contact;
  bool _loadingContact = true;
  String? _contactError;

  String? _callStatus;
  bool _statusManual = false;
  String? _category;
  final _notes = TextEditingController();
  bool _saving = false;
  String? _saveError;
  bool _logged = false;

  final _tracker = CallTracker();
  CallPermissions? _perms;
  Duration? _callDuration;
  bool _callTracked = false;
  bool _exact = false; // duration came from the device call log
  bool _connected = false;

  String? _claimedByOther;

  final _speech = SpeechToText();
  bool _speechReady = false;
  bool _listening = false;
  String? _speechLocale;

  int? _countdown;
  Timer? _countTimer;

  DateTime _now = DateTime.now();
  Timer? _tick;

  bool get _sessionMode => widget.sessionTotal != null;

  String _fmtMs(Duration d) => '${d.inMinutes}:${(d.inSeconds % 60).toString().padLeft(2, '0')}';

  @override
  void initState() {
    super.initState();
    _category = _defaultCategory(widget.complaint.complaintSubType ?? widget.complaint.complaintType);
    _tick = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() => _now = DateTime.now());
    });
    _fetchContact();
    _claim();
  }

  @override
  void dispose() {
    _tick?.cancel();
    _countTimer?.cancel();
    _tracker.stop();
    _speech.cancel();
    _notes.dispose();
    if (!_logged) {
      // Free the complaint for other operators and keep the un-logged call as
      // a draft so it can't be forgotten.
      Api.release(widget.complaint.dataid);
      if (_callTracked) {
        Store.saveDraft({
          'dataid': widget.complaint.dataid,
          'complaint_number': widget.complaint.complaintNumber,
          'title': widget.complaint.complaintSubType ?? widget.complaint.complaintType,
          'area': widget.complaint.area,
          'duration_seconds': _callDuration?.inSeconds,
          'connected': _exact ? _connected : null,
          'suggested_status': _callStatus,
          'call_time': DateTime.now().toIso8601String(),
        });
      }
    }
    super.dispose();
  }

  Future<void> _claim() async {
    try {
      final r = await Api.claim(widget.complaint.dataid);
      if (!mounted) return;
      if (r['claimed'] == false) {
        setState(() => _claimedByOther = '${r['claimed_by_name'] ?? 'Another operator'}');
      }
    } catch (_) {
      // Advisory only — never block the operator on a claim failure.
    }
  }

  Future<void> _fetchContact() async {
    try {
      final c = await Api.contact(widget.complaint.dataid);
      if (!mounted) return;
      setState(() {
        _contact = c;
        _loadingContact = false;
      });
      if (_sessionMode && (c.mobile ?? '').isNotEmpty) _startCountdown(c.mobile!);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _contactError = '$e';
        _loadingContact = false;
      });
    }
  }

  // --- power-dialer auto-call countdown ---

  void _startCountdown(String mobile) {
    _countTimer?.cancel();
    setState(() => _countdown = 3);
    _countTimer = Timer.periodic(const Duration(seconds: 1), (t) {
      if (!mounted) {
        t.cancel();
        return;
      }
      final next = (_countdown ?? 1) - 1;
      if (next <= 0) {
        t.cancel();
        setState(() => _countdown = null);
        _call(mobile);
      } else {
        setState(() => _countdown = next);
      }
    });
  }

  void _cancelCountdown() {
    Haptics.tap();
    _countTimer?.cancel();
    setState(() => _countdown = null);
  }

  // --- calling ---

  Future<void> _call(String mobile) async {
    Haptics.medium();
    _cancelCountdownSilently();
    final perms = await CallChannel.ensureCallPermissions();
    _perms = perms;

    if (perms.phoneState) {
      try {
        _tracker.start((outcome) => _onCallEnded(mobile, outcome));
        // Foreground service: keeps tracking alive during the call, shows the
        // info bubble, and brings the app back when the call ends.
        CallChannel.startCallMonitor(
          line1: _contact?.consumerName ?? widget.complaint.complaintNumber ?? 'Consumer',
          line2: [
            widget.complaint.complaintSubType ?? widget.complaint.complaintType,
            widget.complaint.area,
          ].whereType<String>().join(' · '),
        );
      } catch (_) {
        /* still place the call */
      }
    }

    var placed = false;
    if (perms.callPhone) {
      String? accountId;
      var aborted = false;
      final saved = Store.simAccountId();
      if (saved != null) {
        accountId = saved == '__default__' ? null : saved;
      } else {
        final accounts = await CallChannel.phoneAccounts();
        if (accounts.length > 1 && mounted) {
          (aborted, accountId) = await _chooseSim(accounts);
        }
      }
      if (aborted) {
        _tracker.stop();
        CallChannel.stopCallMonitor();
        return;
      }
      placed = await CallChannel.directCall(mobile, accountId: accountId);
    }

    if (!placed) {
      // No CALL_PHONE permission (or native dial failed) — classic dialer.
      final uri = Uri.parse('tel:$mobile');
      if (!await launchUrl(uri)) {
        _tracker.stop();
        CallChannel.stopCallMonitor();
        if (mounted) showSnack(context, 'Could not open the dialer', error: true);
      }
    }
  }

  void _cancelCountdownSilently() {
    _countTimer?.cancel();
    if (_countdown != null) setState(() => _countdown = null);
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
              Gap.sm,
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
              Gap.sm,
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

  Future<void> _onCallEnded(String mobile, CallOutcome outcome) async {
    if (!mounted) return;
    Haptics.light();
    setState(() {
      _callDuration = outcome.duration;
      _callTracked = true;
      if (!_statusManual) _callStatus = outcome.likelyConnected ? 'Connected' : 'No Answer';
    });
    if (_perms?.callLog != true) return;
    // The OS writes the call-log row a moment after the call ends; poll
    // briefly for the exact post-pickup duration (the real "did they answer").
    for (var attempt = 0; attempt < 3; attempt++) {
      await Future.delayed(Duration(milliseconds: 900 + attempt * 900));
      final entry = await CallChannel.lastOutgoingCall(mobile);
      if (entry == null) continue;
      if (DateTime.now().millisecondsSinceEpoch - entry.dateMillis > 30 * 60 * 1000) continue;
      if (!mounted) return;
      setState(() {
        _exact = true;
        _connected = entry.answered;
        _callDuration = entry.answered ? Duration(seconds: entry.durationSeconds) : outcome.duration;
        if (!_statusManual) _callStatus = entry.answered ? 'Connected' : 'No Answer';
      });
      break;
    }
  }

  // --- voice notes ---

  Future<void> _toggleListen() async {
    Haptics.tap();
    if (_listening) {
      await _speech.stop();
      if (mounted) setState(() => _listening = false);
      return;
    }
    if (!_speechReady) {
      _speechReady = await _speech.initialize(
        onStatus: (s) {
          if ((s == 'done' || s == 'notListening') && mounted) setState(() => _listening = false);
        },
        onError: (_) {
          if (mounted) setState(() => _listening = false);
        },
      );
      if (!_speechReady) {
        if (mounted) showSnack(context, 'Speech recognition unavailable on this phone', error: true);
        return;
      }
      try {
        final locales = await _speech.locales();
        for (final l in locales) {
          if (l.localeId.toLowerCase().startsWith('hi')) {
            _speechLocale = l.localeId;
            break;
          }
        }
      } catch (_) {}
    }
    setState(() => _listening = true);
    await _speech.listen(
      listenOptions: SpeechListenOptions(localeId: _speechLocale, partialResults: false, cancelOnError: true),
      onResult: (r) {
        if (r.finalResult && r.recognizedWords.isNotEmpty) {
          final base = _notes.text.trim();
          _notes.text = base.isEmpty ? r.recognizedWords : '$base ${r.recognizedWords}';
          _notes.selection = TextSelection.collapsed(offset: _notes.text.length);
        }
      },
    );
  }

  // --- save ---

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
    final base = _notes.text.trim();
    final notes = _callTracked && _callDuration != null
        ? 'Call ${_fmtMs(_callDuration!)}${base.isEmpty ? '' : ' · $base'}'
        : (base.isEmpty ? null : base);
    final payload = {
      'dataid': widget.complaint.dataid,
      'complaint_number': widget.complaint.complaintNumber,
      'call_status': _callStatus,
      'problem_category': _category,
      'notes': notes,
      'duration_seconds': _callTracked ? _callDuration?.inSeconds : null,
      'connected': _callTracked ? (_exact ? _connected : _callStatus == 'Connected') : null,
    };
    try {
      await Api.logRaw(payload);
    } on ApiException catch (e) {
      Haptics.error();
      if (mounted) {
        setState(() {
          _saveError = '$e';
          _saving = false;
        });
      }
      return;
    } catch (_) {
      // Network down — keep it in the outbox; it syncs on the next refresh.
      _logged = true;
      await Store.queueLog(payload);
      await Store.removeDraft(widget.complaint.dataid);
      Haptics.success();
      if (mounted) {
        showSnack(context, 'No internet — log saved on the phone, will sync');
        Navigator.pop(context, 'logged');
      }
      return;
    }
    _logged = true;
    await Store.removeDraft(widget.complaint.dataid);
    Haptics.success();
    await widget.onLogged();
    if (mounted) {
      showSnack(context, 'Call logged');
      Navigator.pop(context, 'logged');
    }
  }

  // --- UI ---

  String get _endedBannerText {
    final d = _callDuration ?? Duration.zero;
    if (_exact) {
      return _connected
          ? 'Connected · talked ${_fmtMs(d)} · suggested "${_callStatus ?? '—'}"'
          : 'No talk time recorded (not answered) · suggested "${_callStatus ?? '—'}"';
    }
    return 'Call ended · lasted ${_fmtMs(d)} · suggested "${_callStatus ?? '—'}". Adjust if needed.';
  }

  @override
  Widget build(BuildContext context) {
    final c = widget.complaint;
    final sla = slaFor(c, _now);
    final limitH = (c.areaType ?? '').toLowerCase().contains('urban') ? 1 : 2;
    // Clear the system navigation bar so the Save/Call buttons aren't hidden.
    final bottomSafe = MediaQuery.of(context).viewPadding.bottom;

    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: DraggableScrollableSheet(
        initialChildSize: 0.9,
        maxChildSize: 0.96,
        minChildSize: 0.5,
        expand: false,
        builder: (_, controller) => ListView(
          controller: controller,
          padding: EdgeInsets.fromLTRB(16, 0, 16, 20 + bottomSafe),
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
                if (_sessionMode) ...[
                  Pill('${widget.sessionIndex}/${widget.sessionTotal}', fg: AppColors.brand),
                  Gap.sm,
                ],
                Pill(c.actionStatus ?? '—', fg: statusColor(c.actionStatus)),
              ],
            ),
            Gap.md,

            // Someone else is on this complaint right now (advisory).
            if (_claimedByOther != null) ...[
              AppCard(
                background: AppColors.warningBg,
                borderColor: const Color(0xFFFDE68A),
                padding: const EdgeInsets.all(11),
                child: Row(children: [
                  const Icon(Icons.phone_in_talk, size: 18, color: AppColors.warning),
                  Gap.sm,
                  Expanded(
                    child: Text('$_claimedByOther is calling this consumer right now — avoid a double call.',
                        style: const TextStyle(fontSize: 12.5, color: AppColors.warning, fontWeight: FontWeight.w600)),
                  ),
                ]),
              ),
              Gap.md,
            ],

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
                  ? _contactSkeleton()
                  : _contactError != null
                      ? Row(children: [const Icon(Icons.error_outline, color: AppColors.danger, size: 18), Gap.sm, Expanded(child: Text(_contactError!, style: const TextStyle(color: AppColors.danger)))])
                      : _contactCard(_contact!),
            ),
            Gap.lg,

            // Power-dialer countdown
            AnimatedSize(
              duration: const Duration(milliseconds: 220),
              child: _countdown != null
                  ? Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                        decoration: BoxDecoration(
                          color: AppColors.brand.withValues(alpha: 0.10),
                          borderRadius: BorderRadius.circular(kRadiusSm),
                          border: Border.all(color: AppColors.brand.withValues(alpha: 0.35)),
                        ),
                        child: Row(children: [
                          const Icon(Icons.phone_forwarded, size: 18, color: AppColors.brand),
                          Gap.sm,
                          Expanded(child: Text('Auto-calling in $_countdown…', style: const TextStyle(fontWeight: FontWeight.w700, color: AppColors.brand))),
                          TextButton(onPressed: _cancelCountdown, child: const Text('Cancel')),
                        ]),
                      ),
                    )
                  : const SizedBox(width: double.infinity),
            ),

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
                          Icon(_exact ? Icons.verified : Icons.call_end, size: 18, color: AppColors.success),
                          Gap.sm,
                          Expanded(child: Text(_endedBannerText, style: const TextStyle(fontSize: 12.5, color: Color(0xFF065F46)))),
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
                      _statusManual = true;
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
              decoration: InputDecoration(
                labelText: 'Notes — what did the consumer say?',
                alignLabelWithHint: true,
                suffixIcon: IconButton(
                  tooltip: 'Speak notes (Hindi)',
                  icon: Icon(_listening ? Icons.mic : Icons.mic_none, color: _listening ? AppColors.danger : AppColors.muted),
                  onPressed: _toggleListen,
                ),
              ),
            ),
            if (_listening)
              const Padding(
                padding: EdgeInsets.only(top: 6),
                child: Text('Listening… speak now', style: TextStyle(fontSize: 12, color: AppColors.danger, fontWeight: FontWeight.w600)),
              ),
            if (_saveError != null) ...[Gap.sm, Text(_saveError!, style: const TextStyle(color: AppColors.danger))],
            Gap.lg,
            if (!_sessionMode)
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
              )
            else
              Row(
                children: [
                  OutlinedButton(onPressed: () => Navigator.pop(context, 'exit'), child: const Text('End')),
                  Gap.sm,
                  Expanded(child: OutlinedButton(onPressed: () => Navigator.pop(context, 'skip'), child: const Text('Skip'))),
                  Gap.sm,
                  Expanded(
                    flex: 2,
                    child: FilledButton(
                      onPressed: _saving ? null : _save,
                      child: _saving
                          ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                          : const Text('Save & Next'),
                    ),
                  ),
                ],
              ),
          ],
        ),
      ),
    );
  }

  Widget _contactSkeleton() {
    Widget bar(double w, double h) => Container(
          width: w,
          height: h,
          decoration: BoxDecoration(color: const Color(0xFFE9EDF3), borderRadius: BorderRadius.circular(6)),
        );
    return Shimmer(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          bar(150, 16),
          const SizedBox(height: 10),
          bar(220, 12),
          const SizedBox(height: 8),
          bar(120, 12),
          const SizedBox(height: 16),
          Container(
            width: double.infinity,
            height: 48,
            decoration: BoxDecoration(color: const Color(0xFFE9EDF3), borderRadius: BorderRadius.circular(kRadiusSm)),
          ),
        ],
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
