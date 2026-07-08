import 'package:flutter/material.dart';

import '../api.dart';
import '../models.dart';
import '../storage.dart';
import '../theme.dart';
import '../updater.dart';
import '../widgets.dart';
import 'complaints_screen.dart';
import 'detail_sheet.dart';
import 'profile_screen.dart';
import 'reports_screen.dart';
import 'users_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  late Future<SessionUser> _userFuture;

  @override
  void initState() {
    super.initState();
    _userFuture = Api.me();
    // Self-update check after the first frame; silent no-op when up to date.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) Updater.checkOnLaunch(context);
    });
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<SessionUser>(
      future: _userFuture,
      builder: (context, snap) {
        if (snap.connectionState != ConnectionState.done) {
          return const Scaffold(body: Center(child: CircularProgressIndicator()));
        }
        if (snap.hasError || !snap.hasData) {
          return Scaffold(
            body: EmptyState(
              icon: Icons.error_outline,
              title: 'Could not load your profile',
              subtitle: '${snap.error ?? ''}',
              action: FilledButton(onPressed: () => setState(() => _userFuture = Api.me()), child: const Text('Retry')),
            ),
          );
        }
        return _HomeShell(user: snap.data!);
      },
    );
  }
}

class _HomeShell extends StatefulWidget {
  final SessionUser user;
  const _HomeShell({required this.user});

  @override
  State<_HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<_HomeShell> with WidgetsBindingObserver {
  late int _index;
  late final List<_Tab> _tabs;
  bool _openingPending = false;

  @override
  void initState() {
    super.initState();
    final u = widget.user;
    _tabs = [
      _Tab('Calls', Icons.phone_in_talk_outlined, Icons.phone_in_talk, const ComplaintsScreen()),
      _Tab('Reports', Icons.bar_chart_outlined, Icons.bar_chart, ReportsScreen(user: u)),
      if (u.isSuperAdmin) _Tab('Users', Icons.group_outlined, Icons.group, const UsersScreen()),
      _Tab('Profile', Icons.person_outline, Icons.person, ProfileScreen(user: u)),
    ];
    _index = u.isManager ? 1 : 0;
    WidgetsBinding.instance.addObserver(this);
    WidgetsBinding.instance.addPostFrameCallback((_) => _checkPendingIncomingCall());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _checkPendingIncomingCall();
    }
  }

  Future<void> _checkPendingIncomingCall() async {
    if (_openingPending) return;

    // Collect from the new queue AND the old single-key (backward compat).
    final ids = await Store.getPendingDataIds();
    final oldId = await Store.getPendingIncomingDataId();
    if (oldId != null) ids.add(oldId);

    if (ids.isEmpty) return;

    // Clear immediately so a second resume event doesn't re-open the same forms.
    await Store.clearPendingDataIds();
    await Store.clearPendingIncomingDataId();

    _openingPending = true;
    try {
      for (final dataid in ids) {
        final c = await _fetchComplaint(dataid);
        if (c == null || !mounted) continue;

        // Show the form and WAIT for the operator to close it before opening
        // the next one — avoids confusing stacked modals.
        await showModalBottomSheet(
          context: context,
          isScrollControlled: true,
          useSafeArea: true,
          backgroundColor: AppColors.surface,
          builder: (ctx) => DetailSheet(complaint: c, isIncomingCall: true),
        );

        // Brief pause between multiple forms so the transition feels intentional.
        if (ids.length > 1 && dataid != ids.last && mounted) {
          await Future.delayed(const Duration(milliseconds: 350));
        }
      }
    } catch (_) {
      // Silently ignore — never crash the home screen over a pending call.
    } finally {
      if (mounted) setState(() => _openingPending = false);
    }
  }

  /// Fetches a Complaint by [dataid]: tries local cache first, then the active
  /// API list, then the resolved list as a last resort.
  Future<Complaint?> _fetchComplaint(int dataid) async {
    try {
      final cached = Store.cachedComplaints()
          .firstWhere((c) => c['dataid'] == dataid, orElse: () => <String, dynamic>{});
      if (cached.isNotEmpty) return Complaint.fromJson(cached);

      final all = await Api.complaintsRaw();
      final server = all.firstWhere((x) => x['dataid'] == dataid, orElse: () => <String, dynamic>{});
      if (server.isNotEmpty) return Complaint.fromJson(server);

      // Resolved complaints are not in the normal list — try once more.
      final allResolved = await Api.complaintsRaw(includeResolved: true);
      final resolved = allResolved.firstWhere((x) => x['dataid'] == dataid, orElse: () => <String, dynamic>{});
      if (resolved.isNotEmpty) return Complaint.fromJson(resolved);

      return null;
    } catch (_) {
      return null;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeTop(
        child: IndexedStack(index: _index, children: _tabs.map((t) => t.widget).toList()),
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (i) {
          if (i != _index) Haptics.tap();
          setState(() => _index = i);
        },
        destinations: _tabs
            .map((t) => NavigationDestination(icon: Icon(t.icon), selectedIcon: Icon(t.selectedIcon), label: t.label))
            .toList(),
      ),
    );
  }
}

class _Tab {
  final String label;
  final IconData icon;
  final IconData selectedIcon;
  final Widget widget;
  _Tab(this.label, this.icon, this.selectedIcon, this.widget);
}
