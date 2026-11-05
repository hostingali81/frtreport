import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:speech_to_text/speech_to_text.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api.dart';
import '../call_channel.dart';
import '../call_tracker.dart';
import '../models.dart';
import '../office_sync.dart';
import '../main.dart';
import '../sla.dart';
import '../storage.dart';
import '../theme.dart';
import '../widgets.dart';

const _callStatuses = ['Connected', 'No Answer', 'Switched Off', 'Busy', 'Wrong Number'];
// Grouped for the dropdown: network faults from the highest voltage level down
// to the consumer end, then scheduled/emergency cuts, voltage quality, and
// billing/metering. Stored as free text — old logs keep their original labels.
const _categories = [
  '33 KV Line Fault',
  '11 KV Line Fault',
  'Transformer (DT) Fault',
  'Lead/Cable Cut from DT',
  'LT Line Fault',
  'Underground Cable Fault',
  'Service Cable Fault (Individual)',
  'Pole Damage',
  'Phase Missing',
  'Scheduled Rostering',
  'Emergency Rostering',
  'Low Voltage',
  'High Voltage',
  'Voltage Fluctuation',
  'Billing Issue',
  'Meter Issue',
  'Other',
];

// Pops with 'logged' when a call log was saved — the complaints screen reacts
// by reloading the list and kicking off an FRT sync.
class DetailSheet extends StatefulWidget {
  final Complaint complaint;
  final bool isIncomingCall;

  /// For incoming calls: whether the native side saw the call get answered
  /// (OFFHOOK). null = unknown (queued by an old app build).
  final bool? incomingAnswered;

  /// For incoming calls: OFFHOOK→IDLE talk time in seconds (0 = missed,
  /// null = queued by a build that didn't record it). The operator didn't dial
  /// from the app, so this is the only duration source for incoming calls.
  final int? incomingDurationSeconds;

  const DetailSheet({super.key, required this.complaint, this.isIncomingCall = false, this.incomingAnswered, this.incomingDurationSeconds});

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
  bool _isSubmitting = false;
  bool _recordingAlreadyUploaded = false;
  String? _saveError;
  bool _logged = false;

  final _tracker = CallTracker();
  CallPermissions? _perms;
  Duration? _callDuration;
  Duration? _wallDuration; // OFFHOOK→IDLE wall time (dial + ring + talk)
  bool _callTracked = false;
  bool _exact = false; // duration came from the device call log
  bool _connected = false;
  // When the consumer call was placed. The device call log is searched by
  // number, so without this a repeat call could read the PREVIOUS call's row
  // (written minutes ago) before the OS has written this one — and save that
  // call's talk time and Connected verdict against this attempt.
  DateTime? _dialedAt;
  String? _lastDialedMobile;
  String _callTarget = 'CONSUMER';
  Map<String, dynamic>? _foundRecording;
  bool _sendToOffice = true;
  bool _isPlayingRecording = false;
  String? _satisfaction; // Local recording satisfaction: 'SATISFIED' | 'UNSATISFIED' | null
  bool _hasStoragePermission = false;
  bool _isScanningRecording = false;
  bool _isUploadingNow = false;

  String? _claimedByOther;

  // Previous attempts on this complaint (all operators), newest first.
  List<Map<String, dynamic>>? _history;

  final _speech = SpeechToText();
  bool _speechReady = false;
  bool _listening = false;
  String? _speechLocale;

  DateTime _now = DateTime.now();
  Timer? _tick;
  Timer? _claimHeartbeat;

  String _fmtMs(Duration d) => '${d.inMinutes}:${(d.inSeconds % 60).toString().padLeft(2, '0')}';

  @override
  void initState() {
    super.initState();
    // Problem stays unselected by default; picking the blank first option
    // keeps it that way and nothing is written to the database for it.
    _tick = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() => _now = DateTime.now());
    });
    _fetchContact();
    _claim();
    // Keep the claim fresh while this sheet is open so a long call doesn't let
    // it expire (server treats a claim as stale after ~3 min) — otherwise other
    // operators would stop seeing "on call" mid-conversation and might dial too.
    _claimHeartbeat = Timer.periodic(const Duration(seconds: 90), (_) {
      if (!_logged) Api.claim(widget.complaint.dataid);
    });
    if (widget.complaint.callCount > 0) _fetchHistory();
    _setupIncomingCallDefault();
    CallChannel.onPlaybackComplete = () {
      if (mounted) setState(() => _isPlayingRecording = false);
    };
    CallChannel.hasStoragePermission().then((has) {
      if (mounted) setState(() => _hasStoragePermission = has);
    });
  }

  Future<void> _fetchHistory() async {
    try {
      final h = await Api.callHistory(widget.complaint.dataid);
      if (mounted) setState(() => _history = h);
    } catch (_) {
      if (mounted) setState(() => _history = []);
    }
  }

  @override
  void dispose() {
    _tick?.cancel();
    _claimHeartbeat?.cancel();
    CallChannel.onPlaybackComplete = null;
    CallChannel.stopRecording();
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
      if (c.mobile != null && c.mobile!.isNotEmpty) {
        // Base caller-ID info (available immediately).
        final baseInfo = {
          'complaint_number': widget.complaint.complaintNumber ?? 'Complaint',
          'consumer_name': c.consumerName ?? 'Consumer',
          'substation': widget.complaint.area ?? 'Unknown',
          'dataid': widget.complaint.dataid,
          'complaint_sub_type': widget.complaint.complaintSubType ?? widget.complaint.complaintType ?? '',
          'remarks': c.remarks ?? '',
          'total_complaints': 0,
          'last_status': '',
        };

        // Enrich with complaint history (active + closed) in the background.
        // If it fails (offline, etc.) the basic info is still saved.
        try {
          final lookup = await Api.callerLookup(c.mobile!);
          final complaints = lookup['complaints'] as List? ?? [];
          final total = lookup['total_complaints'] ?? complaints.length;
          if (complaints.isNotEmpty) {
            final last = complaints.first as Map<String, dynamic>;
            final stillInFeed = last['still_in_feed'] == true;
            baseInfo['total_complaints'] = total;
            baseInfo['last_status'] = stillInFeed ? 'Pending' : 'Resolved';
            baseInfo['last_date'] = last['complaint_date'] ?? '';
          }
        } catch (_) {
          // Lookup failed — save with base info only.
        }

        Store.saveCallerId(c.mobile!, jsonEncode(baseInfo));
      }
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _contactError = '$e';
        _loadingContact = false;
      });
    }
  }

  void _setupIncomingCallDefault() {
    if (!widget.isIncomingCall) return;
    // Runs from initState (before the first build), so plain assignment is fine.
    // A missed/declined incoming call must not default to "Connected".
    if (widget.incomingAnswered == false) {
      _callStatus = 'No Answer';
      _connected = false;
    } else {
      _callStatus = 'Connected';
      _connected = true;
    }
  }

  // --- calling ---

  Future<void> _call(String mobile) async {
    _lastDialedMobile = mobile;
    _callTarget = 'CONSUMER';
    CallChannel.hasStoragePermission().then((has) {
      if (mounted) setState(() => _hasStoragePermission = has);
    });
    Haptics.medium();
    final perms = await CallChannel.ensureCallPermissions();
    _perms = perms;
    _dialedAt = DateTime.now();

    if (perms.phoneState) {
      try {
        _tracker.start((outcome) => _onCallEnded(mobile, outcome));
        // Foreground service: keeps tracking alive during the call, shows the
        // info bubble, and brings the app back when the call ends.
        final infoJson = jsonEncode({
          'dataid': widget.complaint.dataid,
          'complaint_number': widget.complaint.complaintNumber,
          'consumer_name': _contact?.consumerName ?? 'Consumer',
          'substation': widget.complaint.area,
          'complaint_sub_type': widget.complaint.complaintSubType ?? widget.complaint.complaintType,
          'remarks': _contact?.remarks,
          'total_complaints': _history?.length ?? 0,
          'last_status': (_history != null && _history!.isNotEmpty) ? _history!.first['call_status'] ?? '' : '',
        });
        CallChannel.startCallMonitor(info: infoJson);
      } catch (_) {
        /* still place the call */
      }
    }

    // This is the consumer call — its outcome is what the complaint log records,
    // so tear the tracker/monitor back down if the operator backs out of the
    // SIM picker or the dialer won't open.
    final ok = await _placeCall(mobile, perms);
    if (!ok) {
      CallChannel.stopRecording();
    _tracker.stop();
      CallChannel.stopCallMonitor();
    }
  }

  // Calls the field crew (FRT) linked to this complaint. Pure coordination
  // call: it deliberately skips the call tracker, the info bubble and the
  // auto call-outcome guess — those belong to the consumer call this sheet logs
  // against, and reusing them here would mislabel the saved outcome.
  Future<void> _callCrew(String mobile) async {
    _lastDialedMobile = mobile;
    _callTarget = 'CREW';
    _dialedAt = DateTime.now();
    CallChannel.hasStoragePermission().then((has) {
      if (mounted) setState(() => _hasStoragePermission = has);
    });
    Haptics.medium();
    final perms = await CallChannel.ensureCallPermissions();
    if (perms.phoneState) {
      _tracker.start((outcome) => _onCallEnded(mobile, outcome));
    }
    await _placeCall(mobile, perms);
  }

  // Shared dialer: honours a remembered SIM (or prompts when the phone has two)
  // and places a native direct call, falling back to the system dialer. Returns
  // false if the operator dismissed the SIM picker or the dialer wouldn't open.
  Future<bool> _placeCall(String mobile, CallPermissions perms) async {
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
      if (aborted) return false;
      placed = await CallChannel.directCall(mobile, accountId: accountId);
    }

    if (!placed) {
      // No CALL_PHONE permission (or native dial failed) — classic dialer.
      final uri = Uri.parse('tel:$mobile');
      if (!await launchUrl(uri)) {
        if (mounted) showSnack(context, 'Could not open the dialer', error: true);
        return false;
      }
    }
    return true;
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
    final hasCallLog = _perms?.callLog == true;
    setState(() {
      _callDuration = outcome.duration;
      _wallDuration = outcome.duration;
      _callTracked = true;
      // The wall time (dial + ring + talk) can't tell "talked 30s" from "rang
      // 30s unanswered", so the >=10s guess is only used when the call log is
      // unavailable. With call-log access the exact answer lands in a few
      // seconds — don't pre-fill a guess the operator might save first.
      if (!_statusManual && !hasCallLog) {
        _callStatus = outcome.likelyConnected ? 'Connected' : 'No Answer';
      }
    });
    if (!hasCallLog) return;
    // The OS writes the call-log row a moment after the call ends — some OEMs
    // take several seconds, so keep polling for ~15s total.
    for (var attempt = 0; attempt < 6; attempt++) {
      await Future.delayed(Duration(milliseconds: 800 + attempt * 700));
      final entry = await CallChannel.lastOutgoingCall(mobile);
      if (entry == null) continue;
      // The row for THIS call starts at or after the tap (small slack for clock
      // rounding / SIM-picker timing); anything older is an earlier call.
      final since = (_dialedAt ?? DateTime.now().subtract(const Duration(minutes: 30)))
          .subtract(const Duration(seconds: 10));
      if (entry.dateMillis < since.millisecondsSinceEpoch) continue;
      if (!mounted) return;
      setState(() {
        _exact = true;
        _connected = entry.answered;
        // Outgoing-call duration only counts after pickup: unanswered means
        // zero talk time — the wall duration was just ringing.
        _callDuration = Duration(seconds: entry.answered ? entry.durationSeconds : 0);
        if (!_statusManual) _callStatus = entry.answered ? 'Connected' : 'No Answer';
      });
      break;
    }
    // Call log never showed the call (rare) — fall back to the wall-time guess.
    if (!_exact && mounted && !_statusManual && _callStatus == null) {
      setState(() => _callStatus = outcome.likelyConnected ? 'Connected' : 'No Answer');
    }

    // Re-check storage permission & scan for Redmi recording
    final hasPerm = await CallChannel.hasStoragePermission();
    if (mounted) setState(() => _hasStoragePermission = hasPerm);

    if (hasPerm) {
      for (var recAttempt = 0; recAttempt < 4; recAttempt++) {
        try {
          final rec = await CallChannel.findLatestRecording(mobile, sinceMillis: _dialedAt?.millisecondsSinceEpoch);
          if (rec != null && mounted) {
            setState(() {
              _foundRecording = rec;
              _sendToOffice = true;
            });
            break;
          }
        } catch (_) {}
        if (recAttempt < 3) await Future.delayed(const Duration(milliseconds: 900));
      }
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

  /// If calling a consumer and call was connected, prompt the operator if satisfaction wasn't chosen.
  Future<bool> _confirmSatisfactionIfNeeded() async {
    if (_callTarget == 'CONSUMER' &&
        _callStatus == 'Connected' &&
        (_satisfaction == null || _satisfaction!.isEmpty)) {
      Haptics.warn();
      final proceed = await showDialog<bool>(
        context: context,
        barrierDismissible: false,
        builder: (ctx) => AlertDialog(
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          titlePadding: const EdgeInsets.fromLTRB(20, 20, 20, 10),
          contentPadding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
          actionsPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
          title: Row(
            children: [
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: const Color(0xFFFEF3C7),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: const Icon(Icons.help_outline, color: Color(0xFFD97706), size: 24),
              ),
              const SizedBox(width: 12),
              const Expanded(
                child: Text(
                  'फीडबैक नहीं चुना गया',
                  style: TextStyle(fontSize: 17, fontWeight: FontWeight.bold, color: Color(0xFF1E293B)),
                ),
              ),
            ],
          ),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const SizedBox(height: 8),
              const Text(
                'आपने उपभोक्ता की संतुष्टि स्थिति (संतुष्ट / असंतुष्ट) सेलेक्ट नहीं किया है।',
                style: TextStyle(fontSize: 14, color: Color(0xFF334155), height: 1.4),
              ),
              const SizedBox(height: 12),
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: const Color(0xFFF1F5F9),
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: const Color(0xFFE2E8F0)),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'यहाँ से तुरंत चुनें:',
                      style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Color(0xFF64748B)),
                    ),
                    const SizedBox(height: 8),
                    Row(
                      children: [
                        Expanded(
                          child: InkWell(
                            onTap: () {
                              if (mounted) setState(() => _satisfaction = 'SATISFIED');
                              Navigator.pop(ctx, true);
                            },
                            borderRadius: BorderRadius.circular(8),
                            child: Container(
                              padding: const EdgeInsets.symmetric(vertical: 8),
                              decoration: BoxDecoration(
                                color: const Color(0xFFDCFCE7),
                                border: Border.all(color: const Color(0xFF10B981), width: 1.2),
                                borderRadius: BorderRadius.circular(8),
                              ),
                              child: const Row(
                                mainAxisAlignment: MainAxisAlignment.center,
                                children: [
                                  Text('😊', style: TextStyle(fontSize: 14)),
                                  SizedBox(width: 6),
                                  Text(
                                    'संतुष्ट',
                                    style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.bold, color: Color(0xFF047857)),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: InkWell(
                            onTap: () {
                              if (mounted) setState(() => _satisfaction = 'UNSATISFIED');
                              Navigator.pop(ctx, true);
                            },
                            borderRadius: BorderRadius.circular(8),
                            child: Container(
                              padding: const EdgeInsets.symmetric(vertical: 8),
                              decoration: BoxDecoration(
                                color: const Color(0xFFFEE2E2),
                                border: Border.all(color: const Color(0xFFEF4444), width: 1.2),
                                borderRadius: BorderRadius.circular(8),
                              ),
                              child: const Row(
                                mainAxisAlignment: MainAxisAlignment.center,
                                children: [
                                  Text('🙁', style: TextStyle(fontSize: 14)),
                                  SizedBox(width: 6),
                                  Text(
                                    'असंतुष्ट',
                                    style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.bold, color: Color(0xFFB91C1C)),
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
              const SizedBox(height: 12),
              const Text(
                'क्या आप बिना सेलेक्ट किए ही भेजना चाहते हैं?',
                style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: Color(0xFF475569)),
              ),
            ],
          ),
          actions: [
            OutlinedButton(
              onPressed: () => Navigator.pop(ctx, false),
              style: OutlinedButton.styleFrom(
                foregroundColor: const Color(0xFF64748B),
                side: const BorderSide(color: Color(0xFFCBD5E1)),
              ),
              child: const Text('वापस जाएं'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(ctx, true),
              style: FilledButton.styleFrom(
                backgroundColor: const Color(0xFF2563EB),
              ),
              child: const Text('बिना सेलेक्ट किए भेजें'),
            ),
          ],
        ),
      );
      return proceed == true;
    }
    return true;
  }

  Future<void> _save() async {
    // Prevent double-clicking / duplicate submissions
    if (_saving || _isSubmitting) return;

    if (_callStatus == null) {
      Haptics.warn();
      setState(() => _saveError = 'Select a call outcome');
      return;
    }

    final proceedWithFeedback = await _confirmSatisfactionIfNeeded();
    if (!proceedWithFeedback || !mounted) return;

    // Incoming calls: the consumer called us, so _callTracked will always be
    // false (the operator didn't dial from the app). Skip the warning.
    if (!_callTracked && !widget.isIncomingCall) {
      Haptics.warn();
      final ok = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Log without calling?'),
          content: const Text('No call was made from the app for this complaint. The log will be marked "No call from app".'),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
            FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Log anyway')),
          ],
        ),
      );
      if (ok != true) return;
    }
    _isSubmitting = true;
    setState(() {
      _saving = true;
      _saveError = null;
    });
    final base = _notes.text.trim();
    // Audit prefix, written by the app (the operator can't edit it out):
    //  - talked             -> "Call 1:23" (exact talk time)
    //  - rang, not picked   -> "Rang 0:27 · not picked" (how long it rang)
    //  - tracked, no log    -> "Call ended after 0:41" (talk vs ring unknown)
    //  - no call from app   -> "⚠ No call from app" (spot desk-filled logs)
    // Incoming: the consumer dialed us, so the only talk-time we have is the
    // OFFHOOK→IDLE duration the native side recorded (0/absent for a missed
    // call). It rides in `duration_seconds` below and shows as a duration chip,
    // so the note prefix stays clean.
    final int? incomingDur = widget.incomingDurationSeconds;
    final String prefix;
    if (widget.isIncomingCall) {
      prefix = widget.incomingAnswered == false ? '📞 Incoming call · missed' : '📞 Incoming call';
    } else if (!_callTracked) {
      prefix = '⚠ No call from app';
    } else if (_exact && !_connected) {
      prefix = 'Rang ${_fmtMs(_wallDuration ?? Duration.zero)} · not picked';
    } else if (_exact) {
      prefix = 'Call ${_fmtMs(_callDuration ?? Duration.zero)}';
    } else {
      prefix = 'Call ended after ${_fmtMs(_callDuration ?? Duration.zero)}';
    }
    final notes = base.isEmpty ? prefix : '$prefix · $base';
    final payload = {
      'dataid': widget.complaint.dataid,
      'complaint_number': widget.complaint.complaintNumber,
      'call_status': _callStatus,
      'problem_category': _category,
      'notes': notes,
      // Incoming: talk time from the native OFFHOOK→IDLE timer (missed = null,
      // so the report screen shows no duration chip). Outgoing: the exact
      // call-log duration captured while the sheet was open.
      'duration_seconds': widget.isIncomingCall
          ? ((incomingDur != null && incomingDur > 0) ? incomingDur : null)
          : (_callTracked ? _callDuration?.inSeconds : null),
      // Incoming: trust the native answered flag when we have it (a missed call
      // is never "connected", whatever status the operator picks); otherwise
      // fall back to the chosen status. Outgoing: exact call-log verdict wins.
      'connected': widget.isIncomingCall
          ? (widget.incomingAnswered ?? (_callStatus == 'Connected'))
          : (_callTracked ? (_exact ? _connected : _callStatus == 'Connected') : (_callStatus == 'Connected')),
      'is_incoming': widget.isIncomingCall,
    };
    try {
      await Api.logRaw(payload);
    } on ApiException catch (e) {
      // A permanent rejection (bad payload) needs the operator's attention. A
      // transient one — server 5xx, auth mid-refresh, rate limit — is the same
      // situation as no internet: keep the log on the phone and let the outbox
      // retry it, instead of leaving the operator stuck on a failing Save.
      if (e.retryable) {
        await _queueOffline(payload, 'Server busy — log saved on the phone, will sync');
        return;
      }
      Haptics.error();
      if (mounted) {
        setState(() {
          _saveError = '$e';
          _saving = false;
          _isSubmitting = false;
        });
      }
      return;
    } catch (_) {
      // Network down — keep it in the outbox; it syncs on the next refresh.
      await _queueOffline(payload, 'No internet — log saved on the phone, will sync');
      return;
    }
    _logged = true;
    await Store.removeDraft(widget.complaint.dataid);
    _syncRecordingToOffice();
    Haptics.success();
    if (mounted) {
      showSnack(context, 'Call logged');
      // The complaints screen sees the 'logged' result and refreshes.
      Navigator.pop(context, 'logged');
    }
  }

  Future<void> _queueOffline(Map<String, dynamic> payload, String message) async {
    _logged = true;
    await Store.queueLog(payload);
    await Store.removeDraft(widget.complaint.dataid);
    _syncRecordingToOffice();
    Haptics.success();
    if (mounted) {
      showSnack(context, message);
      Navigator.pop(context, 'logged');
    }
  }

  void _syncRecordingToOffice() {
    if (_recordingAlreadyUploaded) {
      debugPrint('[OfficeSync] Recording already uploaded during this session, skipping duplicate sync.');
      return;
    }
    final hasAudio = _foundRecording != null;
    final hasCall = _lastDialedMobile != null || (_callDuration != null && _callDuration!.inSeconds > 0);
    if ((hasAudio || hasCall) && _sendToOffice) {
      _recordingAlreadyUploaded = true;
      final user = supabase.auth.currentUser;
      final metadata = user?.userMetadata;
      String opName = 'Operator';
      if (metadata != null && metadata['name'] != null && '${metadata['name']}'.trim().isNotEmpty) {
        opName = '${metadata['name']}'.trim();
      } else if (user?.email != null && user!.email!.isNotEmpty) {
        opName = user.email!.split('@').first;
      }
      final opId = user?.id ?? '';

      OfficeSyncService.uploadRecording(
        filePath: _foundRecording?['path'] as String?,
        complaintNo: widget.complaint.complaintNumber ?? '${widget.complaint.dataid}',
        callTarget: _callTarget,
        phoneNumber: _lastDialedMobile ?? _contact?.mobile ?? '',
        contactName: _callTarget == 'CREW' ? (_contact?.assignedCrew ?? 'Crew') : (_contact?.consumerName ?? 'Consumer'),
        operatorName: opName,
        operatorId: opId,
        durationSeconds: _callDuration?.inSeconds ?? 0,
        callOutcome: _callStatus,
        actualProblem: _category,
        operatorNotes: _notes.text.trim(),
        consumerSatisfaction: _callStatus == 'Connected' ? _satisfaction : null,
        consumerName: _contact?.consumerName,
        area: widget.complaint.area,
        substation: _contact?.substation ?? widget.complaint.area,
        feeder: widget.complaint.feeder,
        complaintType: widget.complaint.complaintSubType ?? widget.complaint.complaintType,
      );
    }
  }

  Future<void> _scanForRecording() async {
    if (!mounted) return;
    setState(() => _isScanningRecording = true);
    final mobile = _lastDialedMobile ?? _contact?.mobile ?? '';
    try {
      final rec = await CallChannel.findLatestRecording(mobile, sinceMillis: _dialedAt?.millisecondsSinceEpoch);
      if (rec != null && mounted) {
        setState(() {
          _foundRecording = rec;
          _sendToOffice = true;
        });
      }
    } catch (_) {}
    if (mounted) setState(() => _isScanningRecording = false);
  }

  Future<void> _requestStoragePermission() async {
    Haptics.tap();
    await CallChannel.requestStoragePermission();
    for (var i = 0; i < 6; i++) {
      await Future.delayed(const Duration(seconds: 1));
      if (!mounted) return;
      final has = await CallChannel.hasStoragePermission();
      if (has) {
        setState(() => _hasStoragePermission = true);
        _scanForRecording();
        break;
      }
    }
  }

  Future<void> _uploadRecordingNow() async {
    if (_isUploadingNow || _recordingAlreadyUploaded) return;
    if (_foundRecording == null) return;

    final proceedWithFeedback = await _confirmSatisfactionIfNeeded();
    if (!proceedWithFeedback || !mounted) return;

    setState(() => _isUploadingNow = true);
    Haptics.tap();

    final user = supabase.auth.currentUser;
    final metadata = user?.userMetadata;
    String opName = 'Operator';
    if (metadata != null && metadata['name'] != null && '${metadata['name']}'.trim().isNotEmpty) {
      opName = '${metadata['name']}'.trim();
    } else if (user?.email != null && user!.email!.isNotEmpty) {
      opName = user.email!.split('@').first;
    }
    final opId = user?.id ?? '';

    final ok = await OfficeSyncService.uploadRecording(
      filePath: _foundRecording!['path'] as String,
      complaintNo: widget.complaint.complaintNumber ?? '${widget.complaint.dataid}',
      callTarget: _callTarget,
      phoneNumber: _lastDialedMobile ?? _contact?.mobile ?? '',
      contactName: _callTarget == 'CREW' ? (_contact?.assignedCrew ?? 'Crew') : (_contact?.consumerName ?? 'Consumer'),
      operatorName: opName,
      operatorId: opId,
      durationSeconds: _callDuration?.inSeconds ?? 0,
      callOutcome: _callStatus,
      actualProblem: _category,
      operatorNotes: _notes.text.trim(),
      consumerSatisfaction: _callStatus == 'Connected' ? _satisfaction : null,
      consumerName: _contact?.consumerName,
      area: widget.complaint.area,
      substation: _contact?.substation ?? widget.complaint.area,
      feeder: widget.complaint.feeder,
      complaintType: widget.complaint.complaintSubType ?? widget.complaint.complaintType,
    );

    if (mounted) {
      setState(() {
        _isUploadingNow = false;
        if (ok) _recordingAlreadyUploaded = true;
      });
      if (ok) {
        showSnack(context, 'Recording Office PC (D: drive) par upload ho gayi!');
      } else {
        showSnack(context, 'Office Wi-Fi se connect nahi hua — queue me save ho gaya, Wi-Fi aane par auto-upload hoga');
      }
    }
  }

  Future<void> _openRecordingPicker() async {
    Haptics.tap();
    if (!_hasStoragePermission) {
      await _requestStoragePermission();
      if (!_hasStoragePermission) return;
    }

    final mobile = _lastDialedMobile ?? _contact?.mobile ?? '';
    final list = await CallChannel.listRecordings(number: mobile, limit: 50);

    if (!mounted) return;

    if (list.isEmpty) {
      showSnack(context, 'Koi recording nahi mili phone par (MIUI/sound_recorder)', error: true);
      return;
    }

    String? playingPath;

    final picked = await showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSheetState) {
          return DraggableScrollableSheet(
            initialChildSize: 0.7,
            minChildSize: 0.4,
            maxChildSize: 0.9,
            expand: false,
            builder: (ctx, scrollController) {
              return Column(
                children: [
                  Container(
                    margin: const EdgeInsets.symmetric(vertical: 8),
                    width: 40,
                    height: 4,
                    decoration: BoxDecoration(
                      color: Colors.grey.shade300,
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                    child: Row(
                      children: [
                        const Icon(Icons.audio_file, color: AppColors.brand, size: 22),
                        const SizedBox(width: 8),
                        const Expanded(
                          child: Text(
                            'Call Recordings (Phone Storage)',
                            style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold, color: AppColors.ink),
                          ),
                        ),
                        Text(
                          '${list.length} files',
                          style: const TextStyle(fontSize: 12, color: AppColors.muted),
                        ),
                      ],
                    ),
                  ),
                  const Divider(height: 1),
                  Expanded(
                    child: ListView.separated(
                      controller: scrollController,
                      itemCount: list.length,
                      separatorBuilder: (_, _) => const Divider(height: 1),
                      itemBuilder: (ctx, idx) {
                        final item = list[idx];
                        final name = item['name'] as String? ?? 'Recording';
                        final path = item['path'] as String? ?? '';
                        final sizeKb = ((item['size'] as num?)?.toInt() ?? 0) ~/ 1024;
                        final matches = item['matchesNumber'] == true;
                        final lm = (item['lastModified'] as num?)?.toInt() ?? 0;
                        final dateStr = lm > 0
                            ? DateTime.fromMillisecondsSinceEpoch(lm).toString().substring(5, 16)
                            : '';
                        final isPlayingThis = playingPath == path;

                        return ListTile(
                          tileColor: matches ? const Color(0xFFEFF6FF) : null,
                          contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                          leading: IconButton(
                            icon: Icon(
                              isPlayingThis ? Icons.pause_circle_filled : Icons.play_circle_filled,
                              color: isPlayingThis ? const Color(0xFF2563EB) : AppColors.brand,
                              size: 34,
                            ),
                            onPressed: () async {
                              if (isPlayingThis) {
                                await CallChannel.pauseRecording();
                                setSheetState(() => playingPath = null);
                              } else {
                                await CallChannel.playRecording(path);
                                setSheetState(() => playingPath = path);
                                CallChannel.onPlaybackComplete = () {
                                  if (mounted) {
                                    setSheetState(() => playingPath = null);
                                    setState(() => _isPlayingRecording = false);
                                  }
                                };
                              }
                            },
                          ),
                          title: Row(
                            children: [
                              Expanded(
                                child: Text(
                                  name,
                                  style: TextStyle(
                                    fontSize: 12.5,
                                    fontWeight: matches ? FontWeight.bold : FontWeight.w600,
                                    color: matches ? const Color(0xFF1E40AF) : AppColors.ink,
                                  ),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                              if (matches)
                                Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                  decoration: BoxDecoration(
                                    color: const Color(0xFFDBEAFE),
                                    borderRadius: BorderRadius.circular(4),
                                  ),
                                  child: const Text(
                                    'Matches',
                                    style: TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: Color(0xFF1D4ED8)),
                                  ),
                                ),
                            ],
                          ),
                          subtitle: Text(
                            '$dateStr • $sizeKb KB',
                            style: const TextStyle(fontSize: 11, color: AppColors.muted),
                          ),
                          trailing: FilledButton.tonal(
                            style: FilledButton.styleFrom(
                              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                              visualDensity: VisualDensity.compact,
                            ),
                            child: const Text('Select', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
                            onPressed: () {
                              CallChannel.stopRecording();
                              Navigator.pop(ctx, item);
                            },
                          ),
                        );
                      },
                    ),
                  ),
                ],
              );
            },
          );
        },
      ),
    );

    CallChannel.stopRecording();
    CallChannel.onPlaybackComplete = () {
      if (mounted) setState(() => _isPlayingRecording = false);
    };

    if (picked != null && mounted) {
      setState(() {
        _foundRecording = picked;
        _sendToOffice = true;
      });
      showSnack(context, 'Recording selected: ${picked['name']}');
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
    // Waiting for the call-log poll — no premature Connected/No Answer guess.
    if (_callStatus == null) return 'Call ended · checking the call log for the exact result…';
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
                if (c.callCount > 0) ...[
                  Pill('${c.callCount}× called', fg: AppColors.warning, bg: AppColors.warningBg),
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

            // History of earlier attempts — full context before a repeat call.
            if (c.callCount > 0) ...[
              SectionHeader('Previous calls (${_history?.length ?? c.callCount})'),
              AppCard(
                padding: EdgeInsets.zero,
                child: _history == null
                    ? const Padding(
                        padding: EdgeInsets.all(14),
                        child: Row(children: [
                          SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2)),
                          Gap.sm,
                          Text('Loading history…', style: TextStyle(fontSize: 12.5, color: AppColors.muted)),
                        ]),
                      )
                    : _history!.isEmpty
                        ? const Padding(
                            padding: EdgeInsets.all(14),
                            child: Text('Could not load call history', style: TextStyle(fontSize: 12.5, color: AppColors.muted)),
                          )
                        : Column(children: [
                            for (var i = 0; i < _history!.length; i++) ...[
                              if (i > 0) const Divider(height: 1),
                              _historyTile(_history![i], _history!.length - i),
                            ],
                          ]),
              ),
              Gap.lg,
            ],

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
            DropdownButtonFormField<String?>(
              initialValue: _category,
              isExpanded: true,
              borderRadius: BorderRadius.circular(kRadiusSm),
              dropdownColor: Colors.white,
              menuMaxHeight: 380,
              elevation: 4,
              icon: Icon(Icons.expand_more, color: _category != null ? AppColors.brand : AppColors.muted),
              decoration: InputDecoration(
                labelText: 'Problem category (optional)',
                prefixIcon: Icon(Icons.build_circle_outlined, size: 20, color: _category != null ? AppColors.brand : AppColors.muted),
              ),
              // Blank first row (default): selecting it saves nothing.
              items: [
                const DropdownMenuItem<String?>(
                  value: null,
                  child: Text('—  Not selected', style: TextStyle(fontSize: 13.5, color: AppColors.muted, fontWeight: FontWeight.w500)),
                ),
                ..._categories.map((e) => DropdownMenuItem<String?>(
                      value: e,
                      child: Text(e, style: const TextStyle(fontSize: 13.5, color: AppColors.ink, fontWeight: FontWeight.w500)),
                    )),
              ],
              selectedItemBuilder: (context) => [
                const Text('—  Not selected', style: TextStyle(fontSize: 13.5, color: AppColors.muted)),
                ..._categories.map((e) => Text(e, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 13.5, color: AppColors.ink, fontWeight: FontWeight.w700))),
              ],
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
            Gap.sm,

            // --- Recording & Office PC Sync Section ---
            if (!_hasStoragePermission) ...[
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: const Color(0xFFFEF3C7),
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: const Color(0xFFFCD34D)),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Row(
                      children: [
                        Icon(Icons.folder_shared_outlined, color: Color(0xFFD97706), size: 20),
                        SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            'Storage Permission Required',
                            style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: Color(0xFF92400E)),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 6),
                    const Text(
                      'Redmi call recordings ko detect karne aur Office Server par bhejne ke liye storage permission allow karein.',
                      style: TextStyle(fontSize: 11.5, color: Color(0xFF78350F)),
                    ),
                    const SizedBox(height: 10),
                    SizedBox(
                      width: double.infinity,
                      child: FilledButton.icon(
                        style: FilledButton.styleFrom(backgroundColor: const Color(0xFFD97706)),
                        icon: const Icon(Icons.security, size: 16),
                        label: const Text('Storage Permission Allow Karein', style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.bold)),
                        onPressed: _requestStoragePermission,
                      ),
                    ),
                  ],
                ),
              ),
            ] else if (_foundRecording != null) ...[
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                decoration: BoxDecoration(
                  color: const Color(0xFFEFF6FF),
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: const Color(0xFFBFDBFE)),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        const Icon(Icons.mic, size: 20, color: Color(0xFF2563EB)),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                '${_foundRecording!['name']}',
                                style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12, color: Color(0xFF1E3A8A)),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                              Text(
                                'Size: ${((_foundRecording!['size'] as num?)?.toInt() ?? 0) ~/ 1024} KB',
                                style: const TextStyle(fontSize: 10, color: Color(0xFF6B7280)),
                              ),
                            ],
                          ),
                        ),
                        IconButton(
                          padding: EdgeInsets.zero,
                          constraints: const BoxConstraints(),
                          icon: Icon(
                            _isPlayingRecording ? Icons.pause_circle_filled : Icons.play_circle_filled,
                            color: const Color(0xFF2563EB),
                            size: 34,
                          ),
                          onPressed: () async {
                            final path = _foundRecording!['path'] as String;
                            if (_isPlayingRecording) {
                              await CallChannel.pauseRecording();
                              if (mounted) setState(() => _isPlayingRecording = false);
                            } else {
                              await CallChannel.playRecording(path);
                              if (mounted) setState(() => _isPlayingRecording = true);
                            }
                          },
                        ),
                      ],
                    ),
                    const Divider(height: 14, thickness: 0.5, color: Color(0xFFBFDBFE)),
                    InkWell(
                      onTap: () => setState(() => _sendToOffice = !_sendToOffice),
                      child: Row(
                        children: [
                          SizedBox(
                            width: 22,
                            height: 22,
                            child: Checkbox(
                              value: _sendToOffice,
                              activeColor: const Color(0xFF2563EB),
                              onChanged: (v) => setState(() => _sendToOffice = v ?? true),
                            ),
                          ),
                          const SizedBox(width: 8),
                          const Expanded(
                            child: Text(
                              'Office System par bhejein (D: drive)',
                              style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Color(0xFF1E40AF)),
                            ),
                          ),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                            decoration: BoxDecoration(
                              color: const Color(0xFFDBEAFE),
                              borderRadius: BorderRadius.circular(4),
                            ),
                            child: Text(
                              _callTarget,
                              style: const TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: Color(0xFF1D4ED8)),
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 8),
                    Row(
                      children: [
                        Expanded(
                          child: OutlinedButton.icon(
                            style: OutlinedButton.styleFrom(
                              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                              visualDensity: VisualDensity.compact,
                              side: BorderSide(
                                color: _recordingAlreadyUploaded ? const Color(0xFF86EFAC) : const Color(0xFF93C5FD),
                              ),
                              backgroundColor: _recordingAlreadyUploaded ? const Color(0xFFF0FDF4) : null,
                            ),
                            icon: _isUploadingNow
                                ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2))
                                : Icon(
                                    _recordingAlreadyUploaded ? Icons.check_circle : Icons.cloud_upload_outlined,
                                    size: 15,
                                    color: _recordingAlreadyUploaded ? const Color(0xFF16A34A) : const Color(0xFF1D4ED8),
                                  ),
                            label: Text(
                              _isUploadingNow
                                  ? 'Uploading…'
                                  : (_recordingAlreadyUploaded ? 'Uploaded ✓' : 'Abhi Server Par Bhejein'),
                              style: TextStyle(
                                fontSize: 11,
                                fontWeight: FontWeight.bold,
                                color: _recordingAlreadyUploaded ? const Color(0xFF16A34A) : const Color(0xFF1D4ED8),
                              ),
                            ),
                            onPressed: (_isUploadingNow || _recordingAlreadyUploaded) ? null : _uploadRecordingNow,
                          ),
                        ),
                        const SizedBox(width: 6),
                        OutlinedButton.icon(
                          style: OutlinedButton.styleFrom(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                            visualDensity: VisualDensity.compact,
                            side: const BorderSide(color: Color(0xFF93C5FD)),
                          ),
                          icon: const Icon(Icons.folder_open, size: 15, color: Color(0xFF1D4ED8)),
                          label: const Text('Dusri Chunein', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Color(0xFF1D4ED8))),
                          onPressed: _openRecordingPicker,
                        ),
                      ],
                    ),
                    if (_callTarget == 'CONSUMER' && _callStatus == 'Connected') ...[
                      const Divider(height: 14, thickness: 0.5, color: Color(0xFFBFDBFE)),
                      Wrap(
                        spacing: 8,
                        runSpacing: 6,
                        crossAxisAlignment: WrapCrossAlignment.center,
                        alignment: WrapAlignment.spaceBetween,
                        children: [
                          const Text(
                            'Consumer Feedback:',
                            style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: Color(0xFF1E3A8A)),
                          ),
                          Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              InkWell(
                                onTap: () {
                                  Haptics.tap();
                                  setState(() => _satisfaction = _satisfaction == 'SATISFIED' ? null : 'SATISFIED');
                                },
                                borderRadius: BorderRadius.circular(16),
                                child: AnimatedContainer(
                                  duration: const Duration(milliseconds: 150),
                                  padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
                                  decoration: BoxDecoration(
                                    color: _satisfaction == 'SATISFIED' ? const Color(0xFF10B981) : Colors.white,
                                    borderRadius: BorderRadius.circular(16),
                                    border: Border.all(
                                      color: _satisfaction == 'SATISFIED' ? const Color(0xFF059669) : const Color(0xFFA7F3D0),
                                      width: 1.2,
                                    ),
                                  ),
                                  child: Row(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      const Text('😊', style: TextStyle(fontSize: 12)),
                                      const SizedBox(width: 4),
                                      Text(
                                        'Satisfied',
                                        style: TextStyle(
                                          fontSize: 11,
                                          fontWeight: FontWeight.w700,
                                          color: _satisfaction == 'SATISFIED' ? Colors.white : const Color(0xFF047857),
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                              const SizedBox(width: 6),
                              InkWell(
                                onTap: () {
                                  Haptics.tap();
                                  setState(() => _satisfaction = _satisfaction == 'UNSATISFIED' ? null : 'UNSATISFIED');
                                },
                                borderRadius: BorderRadius.circular(16),
                                child: AnimatedContainer(
                                  duration: const Duration(milliseconds: 150),
                                  padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
                                  decoration: BoxDecoration(
                                    color: _satisfaction == 'UNSATISFIED' ? const Color(0xFFEF4444) : Colors.white,
                                    borderRadius: BorderRadius.circular(16),
                                    border: Border.all(
                                      color: _satisfaction == 'UNSATISFIED' ? const Color(0xFFDC2626) : const Color(0xFFFECACA),
                                      width: 1.2,
                                    ),
                                  ),
                                  child: Row(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      const Text('🙁', style: TextStyle(fontSize: 12)),
                                      const SizedBox(width: 4),
                                      Text(
                                        'Unsatisfied',
                                        style: TextStyle(
                                          fontSize: 11,
                                          fontWeight: FontWeight.w700,
                                          color: _satisfaction == 'UNSATISFIED' ? Colors.white : const Color(0xFFB91C1C),
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ],
                  ],
                ),
              ),
            ] else ...[
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                decoration: BoxDecoration(
                  color: const Color(0xFFF8FAFC),
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: const Color(0xFFCBD5E1)),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Icon(
                          _callTracked ? Icons.mic_none : Icons.mic_outlined,
                          color: const Color(0xFF64748B),
                          size: 18,
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            _callTracked
                                ? 'Recording auto-detect nahi hui (call abhi hui thi toh Rescan karein)'
                                : 'Call cut hone par recording auto-attach hogi',
                            style: TextStyle(
                              fontWeight: FontWeight.bold,
                              fontSize: 12,
                              color: _callTracked ? const Color(0xFF334155) : const Color(0xFF64748B),
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Row(
                      children: [
                        if (_callTracked) ...[
                          OutlinedButton.icon(
                            style: OutlinedButton.styleFrom(
                              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                              visualDensity: VisualDensity.compact,
                            ),
                            icon: _isScanningRecording
                                ? const SizedBox(width: 12, height: 12, child: CircularProgressIndicator(strokeWidth: 2))
                                : const Icon(Icons.refresh, size: 14),
                            label: Text(_isScanningRecording ? 'Scanning…' : 'Rescan', style: const TextStyle(fontSize: 11)),
                            onPressed: _isScanningRecording ? null : _scanForRecording,
                          ),
                          const SizedBox(width: 8),
                        ],
                        Expanded(
                          child: OutlinedButton.icon(
                            style: OutlinedButton.styleFrom(
                              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                              visualDensity: VisualDensity.compact,
                              side: const BorderSide(color: AppColors.brand),
                            ),
                            icon: const Icon(Icons.folder_open, size: 14, color: AppColors.brand),
                            label: const Text(
                              'Purani Recording Chunein',
                              style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: AppColors.brand),
                            ),
                            onPressed: _openRecordingPicker,
                          ),
                        ),
                      ],
                    ),
                    if (_callTarget == 'CONSUMER' && _callStatus == 'Connected') ...[
                      const Divider(height: 14, thickness: 0.5, color: Color(0xFFCBD5E1)),
                      Wrap(
                        spacing: 8,
                        runSpacing: 6,
                        crossAxisAlignment: WrapCrossAlignment.center,
                        alignment: WrapAlignment.spaceBetween,
                        children: [
                          const Text(
                            'Consumer Feedback:',
                            style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: AppColors.ink),
                          ),
                          Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              InkWell(
                                onTap: () {
                                  Haptics.tap();
                                  setState(() => _satisfaction = _satisfaction == 'SATISFIED' ? null : 'SATISFIED');
                                },
                                borderRadius: BorderRadius.circular(16),
                                child: Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
                                  decoration: BoxDecoration(
                                    color: _satisfaction == 'SATISFIED' ? const Color(0xFF10B981) : Colors.white,
                                    borderRadius: BorderRadius.circular(16),
                                    border: Border.all(
                                      color: _satisfaction == 'SATISFIED' ? const Color(0xFF059669) : const Color(0xFFA7F3D0),
                                    ),
                                  ),
                                  child: Row(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      const Text('😊', style: TextStyle(fontSize: 12)),
                                      const SizedBox(width: 4),
                                      Text(
                                        'Satisfied',
                                        style: TextStyle(
                                          fontSize: 11,
                                          fontWeight: FontWeight.w700,
                                          color: _satisfaction == 'SATISFIED' ? Colors.white : const Color(0xFF047857),
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                              const SizedBox(width: 6),
                              InkWell(
                                onTap: () {
                                  Haptics.tap();
                                  setState(() => _satisfaction = _satisfaction == 'UNSATISFIED' ? null : 'UNSATISFIED');
                                },
                                borderRadius: BorderRadius.circular(16),
                                child: Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
                                  decoration: BoxDecoration(
                                    color: _satisfaction == 'UNSATISFIED' ? const Color(0xFFEF4444) : Colors.white,
                                    borderRadius: BorderRadius.circular(16),
                                    border: Border.all(
                                      color: _satisfaction == 'UNSATISFIED' ? const Color(0xFFDC2626) : const Color(0xFFFECACA),
                                    ),
                                  ),
                                  child: Row(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      const Text('🙁', style: TextStyle(fontSize: 12)),
                                      const SizedBox(width: 4),
                                      Text(
                                        'Unsatisfied',
                                        style: TextStyle(
                                          fontSize: 11,
                                          fontWeight: FontWeight.w700,
                                          color: _satisfaction == 'UNSATISFIED' ? Colors.white : const Color(0xFFB91C1C),
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ],
                  ],
                ),
              ),
            ],
            if (_saveError != null) ...[Gap.sm, Text(_saveError!, style: const TextStyle(color: AppColors.danger))],
            Gap.lg,
            Row(
              children: [
                Expanded(child: OutlinedButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel'))),
                Gap.sm,
                Expanded(
                  flex: 2,
                  child: FilledButton(
                    onPressed: (_saving || _isSubmitting) ? null : _save,
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

  // One earlier attempt, full details: status + exact time, talk duration and
  // problem chips, the complete remark (never truncated), and who called.
  Widget _historyTile(Map<String, dynamic> l, int attemptNo) {
    final connected = l['connected'] == true || l['call_status'] == 'Connected';
    final isIncoming = l['is_incoming'] == true;
    final glyph = callGlyph(isIncoming: isIncoming, connected: connected);
    final color = connected ? AppColors.success : AppColors.inkSoft;
    final secs = (l['duration_seconds'] as num?)?.toInt();
    final notesRaw = '${l['notes'] ?? ''}';
    // Older saves only carried the duration inside the "Call m:ss" notes
    // prefix — use it as a fallback, and strip it since the chip shows it.
    final prefix = RegExp(r'^Call (\d+:\d{2})\s*(·\s*)?').firstMatch(notesRaw);
    final dur = secs != null && secs > 0
        ? '${secs ~/ 60}:${(secs % 60).toString().padLeft(2, '0')}'
        : prefix?.group(1);
    final notes = notesRaw.replaceFirst(RegExp(r'^Call \d+:\d{2}\s*(·\s*)?'), '').trim();
    final category = l['problem_category'] as String?;
    final operator = l['operator'] as String?;

    Widget chip(IconData icon, String text, Color fg, Color bg) => Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
          decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(6)),
          child: Row(mainAxisSize: MainAxisSize.min, children: [
            Icon(icon, size: 12, color: fg),
            const SizedBox(width: 4),
            Text(text, style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: fg)),
          ]),
        );

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
              decoration: BoxDecoration(color: const Color(0xFFEFF2F7), borderRadius: BorderRadius.circular(5)),
              child: Text('#$attemptNo', style: const TextStyle(fontSize: 10.5, fontWeight: FontWeight.w800, color: AppColors.inkSoft)),
            ),
            const SizedBox(width: 7),
            Icon(glyph.icon, size: 15, color: glyph.color),
            const SizedBox(width: 4),
            Expanded(
              child: Text('${isIncoming ? 'Incoming · ' : ''}${l['call_status'] ?? '—'}', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w800, color: color)),
            ),
            Text(fmtDateTime(l['call_time']), style: const TextStyle(fontSize: 10.5, color: AppColors.muted)),
          ]),
          const SizedBox(height: 6),
          Wrap(spacing: 6, runSpacing: 5, children: [
            if (dur != null)
              chip(Icons.timer_outlined, 'Talked $dur min', AppColors.brand, AppColors.brand.withValues(alpha: 0.10))
            else if (!connected)
              chip(Icons.phone_missed, 'No talk', AppColors.muted, const Color(0xFFEFF2F7)),
            if (category != null) chip(Icons.build_circle_outlined, category, AppColors.warning, AppColors.warningBg),
          ]),
          if (notes.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Container(
                width: double.infinity,
                padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 7),
                decoration: BoxDecoration(color: const Color(0xFFF6F7FB), borderRadius: BorderRadius.circular(7)),
                child: Text('"$notes"', style: const TextStyle(fontSize: 12, fontStyle: FontStyle.italic, color: AppColors.inkSoft)),
              ),
            ),
          if (operator != null)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text('by $operator', style: const TextStyle(fontSize: 11, color: AppColors.muted)),
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
        // Call the field crew (FRT) assigned to this complaint to coordinate the
        // fix. Shown independently of the consumer number — the crew can still be
        // reached even when the consumer's mobile is missing.
        if (c.crewMobile != null && c.crewMobile!.isNotEmpty) ...[
          Gap.sm,
          SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              onPressed: () => _callCrew(c.crewMobile!),
              icon: const Icon(Icons.engineering),
              label: Text(
                c.assignedCrew != null && c.assignedCrew!.isNotEmpty
                    ? 'Call FRT · ${c.assignedCrew}'
                    : 'Call FRT (crew)  ${c.crewMobile}',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
              ),
              style: FilledButton.styleFrom(backgroundColor: AppColors.brand, padding: const EdgeInsets.symmetric(vertical: 15)),
            ),
          ),
        ],
      ],
    );
  }
}
