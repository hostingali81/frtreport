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
  static const int discoveryPort = 41234;

  static DiscoveredServer? _cachedServer;

  /// Discovers the Office PC IP automatically via UDP broadcast over Wi-Fi.
  static Future<String?> discoverOfficeServer({Duration timeout = const Duration(seconds: 3)}) async {
    // If we already have a cached server, check if it's reachable via quick ping
    if (_cachedServer != null) {
      if (await _pingServer(_cachedServer!.baseUrl)) {
        return _cachedServer!.baseUrl;
      }
    }

    // Check SharedPreferences for last known IP
    final prefs = await SharedPreferences.getInstance();
    final savedUrl = prefs.getString(_prefKeyServerUrl);
    if (savedUrl != null && await _pingServer(savedUrl)) {
      return savedUrl;
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

      // Broadcast discovery query on LAN
      final reqBytes = utf8.encode('FRT_DISCOVERY_REQ');
      socket.send(reqBytes, InternetAddress('255.255.255.255'), discoveryPort);

      final discovered = await completer.future.timeout(timeout, onTimeout: () => null);
      if (discovered != null) {
        _cachedServer = discovered;
        await prefs.setString(_prefKeyServerUrl, discovered.baseUrl);
        return discovered.baseUrl;
      }
    } catch (_) {
      // Socket or network error
    } finally {
      socket?.close();
      await CallChannel.releaseMulticastLock();
    }

    return savedUrl;
  }

  static Future<bool> _pingServer(String baseUrl) async {
    try {
      final res = await http.get(Uri.parse('$baseUrl/api/ping')).timeout(const Duration(milliseconds: 1200));
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

    try {
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
    }
  }

  static Future<void> _queueUpload(Map<String, dynamic> item) async {
    final prefs = await SharedPreferences.getInstance();
    final list = prefs.getStringList(_prefKeyQueue) ?? [];
    list.add(jsonEncode(item));
    await prefs.setStringList(_prefKeyQueue, list);
  }

  /// Flushes pending uploads when back on Office Wi-Fi.
  static Future<void> flushPendingUploads() async {
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
  }
}
