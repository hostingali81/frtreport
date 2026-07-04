// Data models mirroring the Next.js /api/calling responses.

int? _int(dynamic v) => v == null ? null : (v is int ? v : int.tryParse('$v'));

class Complaint {
  final int dataid;
  final String? complaintNumber;
  final String? complaintType;
  final String? complaintSubType;
  final String? district;
  final String? area;
  final String? areaType;
  final String? feeder;
  final String? actionStatus;
  final String? complaintDate;
  final int callCount;
  final String? lastCallStatus;
  final String? lastCallTime;
  final String? claimedByName;
  final String? claimedAt;

  Complaint({
    required this.dataid,
    this.complaintNumber,
    this.complaintType,
    this.complaintSubType,
    this.district,
    this.area,
    this.areaType,
    this.feeder,
    this.actionStatus,
    this.complaintDate,
    this.callCount = 0,
    this.lastCallStatus,
    this.lastCallTime,
    this.claimedByName,
    this.claimedAt,
  });

  factory Complaint.fromJson(Map<String, dynamic> j) => Complaint(
        dataid: _int(j['dataid']) ?? 0,
        complaintNumber: j['complaint_number'],
        complaintType: j['complaint_type'],
        complaintSubType: j['complaint_sub_type'],
        district: j['district'],
        area: j['area'],
        areaType: j['area_type'],
        feeder: j['feeder'],
        actionStatus: j['action_status'],
        complaintDate: j['complaint_date'],
        callCount: _int(j['call_count']) ?? 0,
        lastCallStatus: j['last_call_status'],
        lastCallTime: j['last_call_time'],
        claimedByName: j['claimed_by_name'],
        claimedAt: j['claimed_at'],
      );

  // Someone (possibly me) opened this complaint to call in the last 3 minutes.
  bool get activeClaim {
    if (claimedByName == null || claimedAt == null) return false;
    final t = DateTime.tryParse(claimedAt!);
    return t != null && DateTime.now().difference(t) < const Duration(minutes: 3);
  }
}

class Contact {
  final int dataid;
  final String? consumerName;
  final String? mobile;
  final String? address;
  final String? landmark;
  final String? remarks;
  final String? substation;
  final String? assignedCrew;
  final String? crewMobile;

  Contact({
    required this.dataid,
    this.consumerName,
    this.mobile,
    this.address,
    this.landmark,
    this.remarks,
    this.substation,
    this.assignedCrew,
    this.crewMobile,
  });

  factory Contact.fromJson(Map<String, dynamic> j) => Contact(
        dataid: _int(j['dataid']) ?? 0,
        consumerName: j['consumer_name'],
        mobile: j['mobile'],
        address: j['address'],
        landmark: j['landmark'],
        remarks: j['remarks'],
        substation: j['substation'],
        assignedCrew: j['assigned_crew'],
        crewMobile: j['crew_mobile'],
      );
}

class SessionUser {
  final String id;
  final String email;
  final String role; // operator | admin | super_admin
  final String? displayName;

  SessionUser({required this.id, required this.email, required this.role, this.displayName});

  factory SessionUser.fromJson(Map<String, dynamic> j) => SessionUser(
        id: '${j['id']}',
        email: j['email'] ?? '',
        role: j['role'] ?? 'operator',
        displayName: j['displayName'],
      );

  bool get isManager => role == 'admin' || role == 'super_admin';
  bool get isSuperAdmin => role == 'super_admin';
}
