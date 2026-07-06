import 'package:flutter/material.dart';

import '../api.dart';
import '../models.dart';
import '../theme.dart';
import '../updater.dart';
import '../widgets.dart';
import 'complaints_screen.dart';
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

class _HomeShellState extends State<_HomeShell> {
  late int _index;
  late final List<_Tab> _tabs;

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
