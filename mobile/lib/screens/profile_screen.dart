import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../api.dart';
import '../models.dart';
import '../theme.dart';
import '../widgets.dart';

class ProfileScreen extends StatefulWidget {
  final SessionUser user;
  const ProfileScreen({super.key, required this.user});

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  late final TextEditingController _name = TextEditingController(text: widget.user.displayName ?? '');
  bool _savingProfile = false;

  final _cur = TextEditingController();
  final _next = TextEditingController();
  final _confirm = TextEditingController();
  bool _savingPw = false;

  @override
  void dispose() {
    _name.dispose();
    _cur.dispose();
    _next.dispose();
    _confirm.dispose();
    super.dispose();
  }

  Future<void> _saveProfile() async {
    FocusScope.of(context).unfocus();
    Haptics.light();
    setState(() => _savingProfile = true);
    try {
      await Api.updateProfileName(_name.text.trim());
      Haptics.success();
      if (mounted) showSnack(context, 'Profile updated');
    } catch (e) {
      Haptics.error();
      if (mounted) showSnack(context, '$e', error: true);
    } finally {
      if (mounted) setState(() => _savingProfile = false);
    }
  }

  Future<void> _changePassword() async {
    if (_next.text != _confirm.text) {
      Haptics.warn();
      showSnack(context, 'New passwords do not match', error: true);
      return;
    }
    FocusScope.of(context).unfocus();
    Haptics.light();
    setState(() => _savingPw = true);
    final auth = Supabase.instance.client.auth;
    try {
      await auth.signInWithPassword(email: widget.user.email, password: _cur.text);
      await auth.updateUser(UserAttributes(password: _next.text));
      Haptics.success();
      _cur.clear();
      _next.clear();
      _confirm.clear();
      if (mounted) showSnack(context, 'Password changed');
    } on AuthException catch (e) {
      Haptics.error();
      final msg = e.message.toLowerCase().contains('invalid') ? 'Current password is incorrect' : e.message;
      if (mounted) showSnack(context, msg, error: true);
    } catch (e) {
      Haptics.error();
      if (mounted) showSnack(context, '$e', error: true);
    } finally {
      if (mounted) setState(() => _savingPw = false);
    }
  }

  Future<void> _logout() async {
    Haptics.medium();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Log out?'),
        content: const Text('You will need to sign in again.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Log out')),
        ],
      ),
    );
    if (ok == true) await Supabase.instance.client.auth.signOut();
  }

  @override
  Widget build(BuildContext context) {
    final u = widget.user;
    final initial = (u.displayName?.isNotEmpty == true ? u.displayName! : u.email).characters.first.toUpperCase();

    return Scaffold(
      appBar: AppBar(
        title: const Text('Profile'),
        actions: [IconButton(onPressed: _logout, icon: const Icon(Icons.logout), tooltip: 'Log out')],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          AppCard(
            child: Row(
              children: [
                Container(
                  width: 52,
                  height: 52,
                  decoration: BoxDecoration(color: AppColors.brand.withValues(alpha: 0.12), shape: BoxShape.circle),
                  alignment: Alignment.center,
                  child: Text(initial, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: AppColors.brand)),
                ),
                Gap.md,
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(u.displayName ?? u.email, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: AppColors.ink)),
                      const SizedBox(height: 2),
                      Text(u.email, style: const TextStyle(fontSize: 12.5, color: AppColors.muted)),
                    ],
                  ),
                ),
                Pill(u.role.replaceAll('_', ' '), fg: AppColors.brand),
              ],
            ),
          ),
          Gap.lg,
          AppCard(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const SectionHeader('Account details'),
                TextField(controller: _name, decoration: const InputDecoration(labelText: 'Display name', prefixIcon: Icon(Icons.badge_outlined, size: 20))),
                Gap.md,
                FilledButton(
                  onPressed: _savingProfile ? null : _saveProfile,
                  child: _savingProfile ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Text('Save changes'),
                ),
              ],
            ),
          ),
          Gap.lg,
          AppCard(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const SectionHeader('Change password'),
                TextField(controller: _cur, obscureText: true, decoration: const InputDecoration(labelText: 'Current password', prefixIcon: Icon(Icons.lock_outline, size: 20))),
                Gap.sm,
                TextField(controller: _next, obscureText: true, decoration: const InputDecoration(labelText: 'New password (min 6)', prefixIcon: Icon(Icons.lock_reset, size: 20))),
                Gap.sm,
                TextField(controller: _confirm, obscureText: true, decoration: const InputDecoration(labelText: 'Confirm new password', prefixIcon: Icon(Icons.lock_reset, size: 20))),
                Gap.md,
                FilledButton(
                  onPressed: _savingPw ? null : _changePassword,
                  style: FilledButton.styleFrom(backgroundColor: AppColors.ink),
                  child: _savingPw ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Text('Change password'),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
