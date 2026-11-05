import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import 'call_channel.dart';

class DiscoveredServer {
  final String ip;
  final int port;
  final String hostname;
  final String baseUrl;

  DiscoveredServer({
    required this.ip,
    required this.port,
    required this.hostname,
  }) : baseUrl = 'http://$ip:$port';
}

class OfficeSyncService {
  static const _prefKeyServerUrl = 'office_server_url';
  static const _prefKeyQueue = 'office_pending_uploads';
  static const _prefKeyFollowupCache = 'office_followup_cache';
  static const int discoveryPort = 41234;

  static DiscoveredServer? _cachedServer;
  static final Set<String> _inFlightUploadKeys = {};
  static bool _isFlushing = false;

  static DiscoveredServer? get cachedServer => _cachedServer;

  static Future<String?> getSavedServerUrl() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_prefKeyServerUrl);
  }

  /// Allows setting or overriding the server URL manually if needed.
  static Future<bool> setManualServerUrl(String url) async {
    String cleanUrl = url.trim();
    if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
      cleanUrl = 'http://$cleanUrl';
    }
    final uri = Uri.tryParse(cleanUrl);
    if (uri != null && uri.host.isNotEmpty) {
      final port = uri.port != 0 ? uri.port : 8080;
      final fullUrl = 'http://${uri.host}:$port';
      if (await _pingServer(fullUrl)) {
        _cachedServer = DiscoveredServer(ip: uri.host, port: port, hostname: 'Manual');
        final prefs = await SharedPreferences.getInstance();
        await prefs.setString(_prefKeyServerUrl, fullUrl);
        return true;
      }
    }
    return false;
  }

  /// Probes the local Wi-Fi subnet (e.g. 192.168.31.X) in parallel if UDP broadcast is blocked.
  static Future<String?> _probeSubnet() async {
    try {
      final interfaces = await NetworkInterface.list(type: InternetAddressType.IPv4);
      String? prefix;
      for (final iface in interfaces) {
        for (final addr in iface.addresses) {
          if (!addr.isLoopback && addr.address.contains('.')) {
            final parts = addr.address.split('.');
            if (parts.length == 4) {
              prefix = '${parts[0]}.${parts[1]}.${parts[2]}';
              break;
            }
          }
        }
        if (prefix != null) break;
      }

      prefix ??= '192.168.31';

      final client = http.Client();
      try {
        final futures = <Future<String?>>[];
        for (var i = 2; i <= 100; i++) {
          final targetUrl = 'http://$prefix.$i:8080';
          futures.add(() async {
            try {
              final res = await client
                  .get(Uri.parse('$targetUrl/api/ping'))
                  .timeout(const Duration(milliseconds: 700));
              if (res.statusCode == 200) {
                return targetUrl;
              }
            } catch (_) {}
            return null;
          }());
        }

        final results = await Future.wait(futures);
        for (final url in results) {
          if (url != null) {
            final uri = Uri.parse(url);
            _cachedServer = DiscoveredServer(ip: uri.host, port: uri.port, hostname: 'Discovered');
            final prefs = await SharedPreferences.getInstance();
            await prefs.setString(_prefKeyServerUrl, url);
            return url;
          }
        }
      } finally {
        client.close();
      }
    } catch (_) {}
    return null;
  }

  /// Discovers the Office PC IP automatically via UDP broadcast over Wi-Fi.
  /// Seamlessly reconnects even if the Jio AirFiber router reboots and assigns a new local IP.
  static Future<String?> discoverOfficeServer({
    Duration timeout = const Duration(seconds: 3),
    bool forceRefresh = false,
  }) async {
    // If not forcing refresh, check cached server first
    if (!forceRefresh) {
      if (_cachedServer != null) {
        if (await _pingServer(_cachedServer!.baseUrl)) {
          return _cachedServer!.baseUrl;
        }
        _cachedServer = null;
      }

      // Check SharedPreferences for last known IP
      final prefs = await SharedPreferences.getInstance();
      final savedUrl = prefs.getString(_prefKeyServerUrl);
      if (savedUrl != null && await _pingServer(savedUrl)) {
        final uri = Uri.tryParse(savedUrl);
        if (uri != null) {
          _cachedServer = DiscoveredServer(ip: uri.host, port: uri.port, hostname: 'Saved');
        }
        return savedUrl;
      }
    }

    await CallChannel.acquireMulticastLock();
    RawDatagramSocket? socket;
    try {
      socket = await RawDatagramSocket.bind(InternetAddress.anyIPv4, 0);
      socket.broadcastEnabled = true;

      final completer = Completer<DiscoveredServer?>();

      socket.listen((event) {
        if (event == RawSocketEvent.read) {
          final dg = socket?.receive();
          if (dg != null) {
            final msg = utf8.decode(dg.data).trim();
            if (msg.startsWith('FRT_DISCOVERY_ACK')) {
              // Expected: FRT_DISCOVERY_ACK:PORT:IP:HOSTNAME
              final parts = msg.split(':');
              final port = parts.length > 1 ? int.tryParse(parts[1]) ?? 8080 : 8080;
              // Use the packet sender address directly (guaranteed correct LAN IP)
              final senderIp = dg.address.address;
              final hostname = parts.length > 3 ? parts[3] : 'Office-PC';

              final server = DiscoveredServer(ip: senderIp, port: port, hostname: hostname);
              if (!completer.isCompleted) {
                completer.complete(server);
              }
            }
          }
        }
      });

      // Broadcast discovery query on 255.255.255.255
      final reqBytes = utf8.encode('FRT_DISCOVERY_REQ');
      socket.send(reqBytes, InternetAddress('255.255.255.255'), discoveryPort);

      // Also broadcast to local subnet broadcast (e.g. 192.168.31.255)
      try {
        final interfaces = await NetworkInterface.list(type: InternetAddressType.IPv4);
        for (final iface in interfaces) {
          for (final addr in iface.addresses) {
            if (!addr.isLoopback && addr.address.contains('.')) {
              final parts = addr.address.split('.');
              if (parts.length == 4) {
                final bcast = '${parts[0]}.${parts[1]}.${parts[2]}.255';
                socket.send(reqBytes, InternetAddress(bcast), discoveryPort);
              }
            }
          }
        }
      } catch (_) {}

      final discovered = await completer.future.timeout(timeout, onTimeout: () => null);
      if (discovered != null) {
        _cachedServer = discovered;
        final prefs = await SharedPreferences.getInstance();
        await prefs.setString(_prefKeyServerUrl, discovered.baseUrl);
        return discovered.baseUrl;
      }
    } catch (_) {
      // Socket or network error
    } finally {
      socket?.close();
      await CallChannel.releaseMulticastLock();
    }

    // Fallback: fast subnet probe (in case UDP broadcast was dropped by router)
    final probedUrl = await _probeSubnet();
    if (probedUrl != null) {
      return probedUrl;
    }

    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_prefKeyServerUrl);
  }

  static Future<bool> _pingServer(String baseUrl) async {
    try {
      final res = await http.get(Uri.parse('$baseUrl/api/ping')).timeout(const Duration(milliseconds: 1200));
      return res.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  /// Fetches unsatisfied complaints from the local Office Server.
  /// Falls back to local SharedPreferences cache when Wi-Fi is disconnected.
  static Future<List<Map<String, dynamic>>> fetchUnsatisfiedComplaints({bool forceRefresh = false}) async {
    final baseUrl = await discoverOfficeServer(forceRefresh: forceRefresh);
    if (baseUrl != null) {
      try {
        final uri = Uri.parse('$baseUrl/api/complaints?satisfaction=UNSATISFIED&limit=100');
        final res = await http.get(uri).timeout(const Duration(seconds: 4));
        if (res.statusCode == 200) {
          final data = jsonDecode(res.body);
          if (data is Map && data['complaints'] is List) {
            final list = (data['complaints'] as List).cast<Map<String, dynamic>>();
            final prefs = await SharedPreferences.getInstance();
            await prefs.setString(_prefKeyFollowupCache, jsonEncode(list));
            return list;
          }
        }
      } catch (_) {}
    }

    // Offline fallback: load cached complaints
    try {
      final prefs = await SharedPreferences.getInstance();
      final cachedJson = prefs.getString(_prefKeyFollowupCache);
      if (cachedJson != null && cachedJson.isNotEmpty) {
        final decoded = jsonDecode(cachedJson);
        if (decoded is List) {
          return decoded.cast<Map<String, dynamic>>();
        }
      }
    } catch (_) {}

    return [];
  }

  /// Updates a complaint's satisfaction to SATISFIED on the local Office Server.
  static Future<bool> markComplaintSatisfied(
    String complaintNo, {
    String? notes,
    String? operatorName,
  }) async {
    final baseUrl = await discoverOfficeServer();
    if (baseUrl == null) return false;

    try {
      final uri = Uri.parse('$baseUrl/api/complaints/$complaintNo/satisfaction');
      final res = await http
          .post(
            uri,
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode({
              'satisfaction': 'SATISFIED',
              'notes': notes ?? 'Marked satisfied on follow-up call',
              'operator_name': operatorName ?? 'Operator',
            }),
          )
          .timeout(const Duration(seconds: 4));
      return res.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  /// Sends a call recording + metadata directly to the Office PC.
  static Future<bool> uploadRecording({
    required String filePath,
    required String complaintNo,
    required String callTarget,
    required String phoneNumber,
    String? contactName,
    required String operatorName,
    String? operatorId,
    required int durationSeconds,
    String? callOutcome,
    String? actualProblem,
    String? operatorNotes,
    String? consumerSatisfaction,
    String? consumerName,
    String? area,
    String? substation,
    String? feeder,
    String? complaintType,
  }) async {
    final file = File(filePath);
    if (!file.existsSync()) {
      return false;
    }

    final inFlightKey = '${complaintNo}_${file.path}';
    if (_inFlightUploadKeys.contains(inFlightKey)) {
      return false; // Already uploading this recording right now
    }
    _inFlightUploadKeys.add(inFlightKey);

    try {
      final baseUrl = await discoverOfficeServer();
      if (baseUrl == null) {
        // Offline: queue for background upload when Wi-Fi connects
        await _queueUpload({
          'filePath': filePath,
          'complaint_no': complaintNo,
          'call_target': callTarget,
          'phone_number': phoneNumber,
          'contact_name': contactName ?? '',
          'operator_name': operatorName,
          'operator_id': operatorId ?? '',
          'duration_seconds': durationSeconds.toString(),
          'call_outcome': callOutcome ?? '',
          'actual_problem': actualProblem ?? '',
          'operator_notes': operatorNotes ?? '',
          'consumer_satisfaction': consumerSatisfaction ?? '',
          'consumer_name': consumerName ?? '',
          'area': area ?? '',
          'substation': substation ?? '',
          'feeder': feeder ?? '',
          'complaint_type': complaintType ?? '',
          'call_time': DateTime.now().toIso8601String(),
        });
        return false;
      }

      final uri = Uri.parse('$baseUrl/api/upload');
      final request = http.MultipartRequest('POST', uri);

      request.fields['complaint_no'] = complaintNo;
      request.fields['call_target'] = callTarget;
      request.fields['phone_number'] = phoneNumber;
      request.fields['contact_name'] = contactName ?? '';
      request.fields['operator_name'] = operatorName;
      request.fields['operator_id'] = operatorId ?? '';
      request.fields['duration_seconds'] = durationSeconds.toString();
      request.fields['call_outcome'] = callOutcome ?? '';
      request.fields['actual_problem'] = actualProblem ?? '';
      request.fields['operator_notes'] = operatorNotes ?? '';
      request.fields['consumer_satisfaction'] = consumerSatisfaction ?? '';
      request.fields['consumer_name'] = consumerName ?? '';
      request.fields['area'] = area ?? '';
      request.fields['substation'] = substation ?? '';
      request.fields['feeder'] = feeder ?? '';
      request.fields['complaint_type'] = complaintType ?? '';
      request.fields['call_time'] = DateTime.now().toIso8601String();

      request.files.add(await http.MultipartFile.fromPath('audio', filePath));

      final streamedResponse = await request.send().timeout(const Duration(seconds: 20));
      final response = await http.Response.fromStream(streamedResponse);

      if (response.statusCode == 200) {
        // Trigger flush of any previous queued uploads
        flushPendingUploads();
        return true;
      }
      return false;
    } catch (_) {
      // Save to queue
      await _queueUpload({
        'filePath': filePath,
        'complaint_no': complaintNo,
        'call_target': callTarget,
        'phone_number': phoneNumber,
        'contact_name': contactName ?? '',
        'operator_name': operatorName,
        'operator_id': operatorId ?? '',
        'duration_seconds': durationSeconds.toString(),
        'call_outcome': callOutcome ?? '',
        'actual_problem': actualProblem ?? '',
        'operator_notes': operatorNotes ?? '',
        'consumer_satisfaction': consumerSatisfaction ?? '',
        'consumer_name': consumerName ?? '',
        'area': area ?? '',
        'substation': substation ?? '',
        'feeder': feeder ?? '',
        'complaint_type': complaintType ?? '',
        'call_time': DateTime.now().toIso8601String(),
      });
      return false;
    } finally {
      _inFlightUploadKeys.remove(inFlightKey);
    }
  }

  static Future<void> _queueUpload(Map<String, dynamic> item) async {
    final prefs = await SharedPreferences.getInstance();
    final list = prefs.getStringList(_prefKeyQueue) ?? [];
    // Avoid queuing duplicate item for same complaint and file
    final isDuplicate = list.any((str) {
      try {
        final parsed = jsonDecode(str) as Map<String, dynamic>;
        return parsed['complaint_no'] == item['complaint_no'] &&
               parsed['filePath'] == item['filePath'];
      } catch (_) {
        return false;
      }
    });
    if (!isDuplicate) {
      list.add(jsonEncode(item));
      await prefs.setStringList(_prefKeyQueue, list);
    }
  }

  /// Flushes pending uploads when back on Office Wi-Fi.
  static Future<void> flushPendingUploads() async {
    if (_isFlushing) return;
    _isFlushing = true;
    try {
      final prefs = await SharedPreferences.getInstance();
      final list = prefs.getStringList(_prefKeyQueue);
      if (list == null || list.isEmpty) return;

      final baseUrl = await discoverOfficeServer();
      if (baseUrl == null) return;

      final remaining = <String>[];
      for (final jsonStr in list) {
        try {
          final item = jsonDecode(jsonStr) as Map<String, dynamic>;
          final filePath = item['filePath'] as String;
          if (!File(filePath).existsSync()) continue;

          final uri = Uri.parse('$baseUrl/api/upload');
          final request = http.MultipartRequest('POST', uri);

          item.forEach((key, val) {
            if (key != 'filePath') {
              request.fields[key] = '$val';
            }
          });
          request.files.add(await http.MultipartFile.fromPath('audio', filePath));

          final streamed = await request.send().timeout(const Duration(seconds: 15));
          if (streamed.statusCode != 200) {
            remaining.add(jsonStr);
          }
        } catch (_) {
          remaining.add(jsonStr);
        }
      }
      await prefs.setStringList(_prefKeyQueue, remaining);
    } finally {
      _isFlushing = false;
    }
  }
}
