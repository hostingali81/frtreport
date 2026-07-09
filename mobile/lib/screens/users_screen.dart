import 'package:flutter/material.dart';

import '../api.dart';
import '../theme.dart';
import '../widgets.dart';

const _roles = ['operator', 'admin', 'super_admin'];

class UsersScreen extends StatefulWidget {
  const UsersScreen({super.key});

  @override
  State<UsersScreen> createState() => _UsersScreenState();
}

class _UsersScreenState extends State<UsersScreen> {
  List<Map<String, dynamic>> _users = [];
  bool _loading = true;
  String? _error;

  final _email = TextEditingController();
  final _name = TextEditingController();
  final _password = TextEditingController();
  String _role = 'operator';
  bool _creating = false;
  bool _pwVisible = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _email.dispose();
    _name.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final u = await Api.listUsers();
      if (!mounted) return;
      setState(() {
        _users = u;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = '$e';
        _loading = false;
      });
    }
  }

  Future<void> _create() async {
    FocusScope.of(context).unfocus();
    Haptics.light();
    setState(() => _creating = true);
    try {
      await Api.createUser(email: _email.text.trim(), password: _password.text, role: _role, displayName: _name.text.trim());
      Haptics.success();
      _email.clear();
      _name.clear();
      _password.clear();
      setState(() => _role = 'operator');
      await _load();
      if (mounted) showSnack(context, 'User created');
    } catch (e) {
      Haptics.error();
      if (mounted) showSnack(context, '$e', error: true);
    } finally {
      if (mounted) setState(() => _creating = false);
    }
  }

  Future<void> _patch(String id, Map<String, dynamic> changes) async {
    Haptics.tap();
    try {
      await Api.patchUser(id, changes);
      await _load();
    } catch (e) {
      Haptics.error();
      if (mounted) showSnack(context, '$e', error: true);
    }
  }

  Future<void> _resetPassword(String id) async {
    final ctrl = TextEditingController();
    final pw = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Reset password'),
        content: TextField(controller: ctrl, autofocus: true, decoration: const InputDecoration(labelText: 'New password (min 6)')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, ctrl.text), child: const Text('Set')),
        ],
      ),
    );
    if (pw != null && pw.isNotEmpty) _patch(id, {'password': pw});
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Users')),
      body: RefreshIndicator(
        onRefresh: () {
          Haptics.light();
          return _load();
        },
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            AppCard(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const SectionHeader('Add user'),
                  TextField(controller: _email, keyboardType: TextInputType.emailAddress, autocorrect: false, decoration: const InputDecoration(labelText: 'Email', prefixIcon: Icon(Icons.mail_outline, size: 20))),
                  Gap.sm,
                  TextField(controller: _name, decoration: const InputDecoration(labelText: 'Display name', prefixIcon: Icon(Icons.badge_outlined, size: 20))),
                  Gap.sm,
                  TextField(
                    controller: _password,
                    obscureText: !_pwVisible,
                    decoration: InputDecoration(
                      labelText: 'Password (min 6)',
                      prefixIcon: const Icon(Icons.lock_outline, size: 20),
                      suffixIcon: IconButton(
                        icon: Icon(_pwVisible ? Icons.visibility_outlined : Icons.visibility_off_outlined, size: 20, color: AppColors.muted),
                        onPressed: () => setState(() => _pwVisible = !_pwVisible),
                      ),
                    ),
                  ),
                  Gap.sm,
                  DropdownButtonFormField<String>(
                    initialValue: _role,
                    decoration: const InputDecoration(labelText: 'Role', prefixIcon: Icon(Icons.shield_outlined, size: 20)),
                    items: _roles.map((r) => DropdownMenuItem(value: r, child: Text(r))).toList(),
                    onChanged: (v) {
                      Haptics.tap();
                      setState(() => _role = v ?? 'operator');
                    },
                  ),
                  Gap.md,
                  FilledButton.icon(
                    onPressed: _creating ? null : _create,
                    icon: _creating ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.person_add_alt, size: 18),
                    label: Text(_creating ? 'Creating…' : 'Create user'),
                  ),
                ],
              ),
            ),
            Gap.lg,
            if (_loading)
              const Padding(padding: EdgeInsets.only(top: 40), child: Center(child: CircularProgressIndicator()))
            else if (_error != null)
              Padding(padding: const EdgeInsets.only(top: 20), child: EmptyState(icon: Icons.cloud_off, title: 'Could not load users', subtitle: _error, action: FilledButton(onPressed: _load, child: const Text('Retry'))))
            else
              ..._users.map(_userCard),
          ],
        ),
      ),
    );
  }

  Widget _userCard(Map<String, dynamic> u) {
    final id = '${u['id']}';
    final active = u['active'] == true;
    final role = _roles.contains(u['role']) ? u['role'] as String : 'operator';
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: AppCard(
        background: active ? AppColors.surface : const Color(0xFFF4F5F8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(u['display_name'] ?? u['email'] ?? '', style: TextStyle(fontWeight: FontWeight.w700, color: active ? AppColors.ink : AppColors.muted)),
                      Text('${u['email'] ?? ''}', style: const TextStyle(fontSize: 12, color: AppColors.muted)),
                    ],
                  ),
                ),
                if (!active) const Pill('inactive', fg: AppColors.muted),
              ],
            ),
            Gap.sm,
            Wrap(
              spacing: 8,
              runSpacing: 8,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6),
                  decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(8), border: Border.all(color: AppColors.border)),
                  child: DropdownButton<String>(
                    value: role,
                    isDense: true,
                    underline: const SizedBox.shrink(),
                    icon: const Icon(Icons.expand_more, size: 18, color: AppColors.muted),
                    items: _roles.map((r) => DropdownMenuItem(value: r, child: Text(r, style: const TextStyle(fontSize: 13)))).toList(),
                    onChanged: (v) => v == null ? null : _patch(id, {'role': v}),
                  ),
                ),
                OutlinedButton.icon(onPressed: () => _resetPassword(id), icon: const Icon(Icons.key_outlined, size: 15), label: const Text('Reset', style: TextStyle(fontSize: 13))),
                OutlinedButton.icon(
                  onPressed: () => _patch(id, {'active': !active}),
                  icon: Icon(active ? Icons.block : Icons.check_circle_outline, size: 15),
                  label: Text(active ? 'Deactivate' : 'Activate', style: const TextStyle(fontSize: 13)),
                  style: OutlinedButton.styleFrom(foregroundColor: active ? AppColors.danger : AppColors.success),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
