import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;

import 'config.dart';
import 'widgets.dart';

// In-app self-update (no Play Store): a `latest.json` manifest in the public
// Supabase Storage bucket `app-updates` describes the newest APK. On app start
// we compare its build number with ours; if newer, a dialog offers to download
// the APK (streamed, with progress) and hand it to the system installer via the
// native `installApk` channel method. `scripts/release-app.mjs` publishes both
// the APK and the manifest.

class UpdateInfo {
  final int build; // Android versionCode — the number after `+` in pubspec.
  final int minBuild; // builds older than this can't dismiss the dialog
  final String version;
  final String url; // fallback APK (arm64)
  final Map<String, String> urls; // per-ABI APKs, keyed like Build.SUPPORTED_ABIS
  final String notes;
  UpdateInfo({
    required this.build,
    required this.minBuild,
    required this.version,
    required this.url,
    required this.urls,
    required this.notes,
  });

  static UpdateInfo? fromJson(dynamic j) {
    if (j is! Map) return null;
    // `buildNumber` is the plain pubspec build. The legacy `build` field is a
    // bridge for 1.0.1/1.0.2 installs, which compared their RAW split-per-abi
    // versionCode (arm64 = 2000+N) — the script publishes it as 2000+N so
    // those installs still see updates.
    final build = (j['buildNumber'] as num?)?.toInt() ?? (j['build'] as num?)?.toInt() ?? 0;
    final url = j['url']?.toString() ?? '';
    if (build <= 0 || url.isEmpty) return null;
    final urls = <String, String>{};
    (j['urls'] as Map?)?.forEach((k, v) => urls['$k'] = '$v');
    return UpdateInfo(
      build: build,
      minBuild: (j['minBuild'] as num?)?.toInt() ?? 0,
      version: j['version']?.toString() ?? '',
      url: url,
      urls: urls,
      notes: j['notes']?.toString() ?? '',
    );
  }

  // APKs are built per ABI (fat APK exceeds Supabase's 50MB upload limit);
  // pick the first manifest URL matching this device's ABIs, in device
  // preference order.
  String urlForAbis(List<String> abis) {
    for (final abi in abis) {
      final u = urls[abi];
      if (u != null) return u;
    }
    return url;
  }
}

class Updater {
  // Same channel as CallChannel; the update methods live in MainActivity too.
  static const _ch = MethodChannel('frt/call');
  static bool _promptedThisSession = false;

  // Fire-and-forget check on app start. Silent on any failure (offline, bad
  // manifest, native side missing) — the app must never be blocked by this.
  static Future<void> checkOnLaunch(BuildContext context) async {
    if (_promptedThisSession) return;
    try {
      final info = await fetchLatest();
      final current = await currentBuild();
      if (info == null || current <= 0 || info.build <= current) return;
      _promptedThisSession = true;
      if (!context.mounted) return;
      await _prompt(context, info, current);
    } catch (_) {}
  }

  // Manual check (profile screen): always answers, update or not.
  static Future<void> checkNow(BuildContext context) async {
    UpdateInfo? info;
    var current = 0;
    try {
      info = await fetchLatest();
      current = await currentBuild();
    } catch (_) {}
    if (!context.mounted) return;
    if (info == null || current <= 0) {
      showSnack(context, 'Could not check for updates — try again', error: true);
    } else if (info.build <= current) {
      showSnack(context, 'App is up to date');
    } else {
      await _prompt(context, info, current);
    }
  }

  static Future<void> _prompt(BuildContext context, UpdateInfo info, int current) {
    return showDialog(
      context: context,
      barrierDismissible: false,
      builder: (_) => _UpdateDialog(info: info, force: current < info.minBuild),
    );
  }

  static Future<int> currentBuild() async {
    try {
      final raw = await _ch.invokeMethod<int>('getBuildNumber') ?? 0;
      // `flutter build apk --split-per-abi` offsets the versionCode per ABI
      // (armeabi-v7a = 1000+N, arm64-v8a = 2000+N, x86_64 = 3000+N); strip the
      // offset to get back the plain pubspec build number.
      return raw % 1000;
    } catch (_) {
      return 0;
    }
  }

  static Future<String> versionName() async {
    try {
      return await _ch.invokeMethod<String>('getVersionName') ?? '';
    } catch (_) {
      return '';
    }
  }

  static Future<List<String>> supportedAbis() async {
    try {
      final list = await _ch.invokeMethod<List<dynamic>>('getAbis');
      return (list ?? []).map((e) => '$e').toList();
    } catch (_) {
      return [];
    }
  }

  static Future<UpdateInfo?> fetchLatest() async {
    // Cache-buster: Supabase CDN caches public objects; a fresh query string
    // guarantees we see a just-published release.
    final uri = Uri.parse('${Config.updateManifestUrl}?ts=${DateTime.now().millisecondsSinceEpoch}');
    final r = await http.get(uri).timeout(const Duration(seconds: 15));
    if (r.statusCode != 200) return null;
    return UpdateInfo.fromJson(jsonDecode(utf8.decode(r.bodyBytes)));
  }
}

class _UpdateDialog extends StatefulWidget {
  final UpdateInfo info;
  final bool force; // mandatory update: no "Later" button
  const _UpdateDialog({required this.info, required this.force});

  @override
  State<_UpdateDialog> createState() => _UpdateDialogState();
}

class _UpdateDialogState extends State<_UpdateDialog> {
  bool _downloading = false;
  bool _downloaded = false;
  double? _progress;
  String? _error;
  String? _apkPath;
  http.Client? _client;

  @override
  void dispose() {
    _client?.close();
    super.dispose();
  }

  Future<void> _download() async {
    setState(() {
      _downloading = true;
      _progress = null;
      _error = null;
    });
    final client = http.Client();
    _client = client;
    try {
      final path = await Updater._ch.invokeMethod<String>('getUpdateApkPath');
      if (path == null) throw Exception('native side unavailable');
      final apkUrl = widget.info.urlForAbis(await Updater.supportedAbis());
      final resp = await client.send(http.Request('GET', Uri.parse(apkUrl)));
      if (resp.statusCode != 200) throw Exception('HTTP ${resp.statusCode}');
      final total = resp.contentLength ?? 0;
      final file = File(path);
      final sink = file.openWrite();
      var received = 0;
      try {
        await for (final chunk in resp.stream) {
          sink.add(chunk);
          received += chunk.length;
          if (total > 0 && mounted) setState(() => _progress = received / total);
        }
      } finally {
        await sink.close();
      }
      if (total > 0 && received < total) throw Exception('download incomplete');
      _apkPath = path;
      if (mounted) setState(() => _downloaded = true);
      await _install();
    } catch (e) {
      if (mounted) {
        setState(() {
          _downloading = false;
          _error = 'Download failed. Check your internet and try again.';
        });
      }
    } finally {
      client.close();
      if (identical(_client, client)) _client = null;
    }
  }

  // Returns false when the "install unknown apps" permission is missing — the
  // native side has already opened the right settings screen in that case.
  Future<void> _install() async {
    final path = _apkPath;
    if (path == null) return;
    bool ok = false;
    try {
      ok = await Updater._ch.invokeMethod<bool>('installApk', {'path': path}) ?? false;
    } catch (_) {}
    if (!ok && mounted) {
      setState(() {
        _error = 'Allow "install unknown apps" for FRT Calling in the settings screen that opened, then come back and tap Install.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final info = widget.info;
    return AlertDialog(
      title: const Text('Update available'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('A new version ${info.version.isNotEmpty ? '(${info.version}) ' : ''}is ready to install.'),
          if (info.notes.isNotEmpty) ...[
            const SizedBox(height: 8),
            Text(info.notes, style: Theme.of(context).textTheme.bodySmall),
          ],
          if (_downloading && !_downloaded) ...[
            const SizedBox(height: 16),
            LinearProgressIndicator(value: _progress),
            const SizedBox(height: 8),
            Text(
              _progress == null ? 'Downloading…' : 'Downloading… ${(_progress! * 100).round()}%',
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],
          if (_error != null) ...[
            const SizedBox(height: 12),
            Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error, fontSize: 13)),
          ],
        ],
      ),
      actions: [
        if (!widget.force && !_downloading)
          TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Later')),
        if (_downloaded)
          FilledButton(onPressed: _install, child: const Text('Install'))
        else
          FilledButton(
            onPressed: _downloading ? null : _download,
            child: Text(_error == null ? 'Update' : 'Retry'),
          ),
      ],
    );
  }
}
