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
  late String _displayName = widget.user.displayName ?? '';

  Future<void> _openEditName() async {
    Haptics.tap();
    final result = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      backgroundColor: AppColors.surface,
      builder: (_) => _EditNameSheet(initial: _displayName),
    );
    if (result != null && mounted) setState(() => _displayName = result);
  }

  void _openChangePassword() {
    Haptics.tap();
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      backgroundColor: AppColors.surface,
      builder: (_) => _ChangePasswordSheet(email: widget.user.email),
    );
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
    final name = _displayName.isEmpty ? u.email : _displayName;
    final initial = name.characters.first.toUpperCase();

    return Scaffold(
      appBar: AppBar(title: const Text('Profile')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          AppCard(
            child: Row(
              children: [
                Container(
                  width: 56,
                  height: 56,
                  decoration: BoxDecoration(color: AppColors.brand.withValues(alpha: 0.12), shape: BoxShape.circle),
                  alignment: Alignment.center,
                  child: Text(initial, style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w800, color: AppColors.brand)),
                ),
                Gap.md,
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(name, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: AppColors.ink)),
                      const SizedBox(height: 2),
                      Text(u.email, style: const TextStyle(fontSize: 12.5, color: AppColors.muted)),
                    ],
                  ),
                ),
              ],
            ),
          ),
          Gap.lg,

          // Read-only details
          AppCard(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
            child: Column(
              children: [
                _detailRow(Icons.badge_outlined, 'Display name', _displayName.isEmpty ? 'Not set' : _displayName),
                const Divider(height: 1),
                _detailRow(Icons.mail_outline, 'Email', u.email),
                const Divider(height: 1),
                _detailRow(Icons.shield_outlined, 'Role', u.role.replaceAll('_', ' ')),
              ],
            ),
          ),
          Gap.lg,

          // Actions
          AppCard(
            padding: EdgeInsets.zero,
            child: Column(
              children: [
                _actionTile(Icons.edit_outlined, 'Edit profile', 'Change your display name', _openEditName),
                const Divider(height: 1, indent: 56),
                _actionTile(Icons.lock_reset, 'Change password', 'Update your account password', _openChangePassword),
              ],
            ),
          ),
          Gap.lg,
          OutlinedButton.icon(
            onPressed: _logout,
            icon: const Icon(Icons.logout, size: 18),
            label: const Text('Log out'),
            style: OutlinedButton.styleFrom(foregroundColor: AppColors.danger, padding: const EdgeInsets.symmetric(vertical: 14)),
          ),
        ],
      ),
    );
  }

  Widget _detailRow(IconData icon, String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 12),
      child: Row(
        children: [
          Icon(icon, size: 18, color: AppColors.muted),
          Gap.md,
          Text(label, style: const TextStyle(fontSize: 13, color: AppColors.muted)),
          const Spacer(),
          Flexible(child: Text(value, textAlign: TextAlign.right, style: const TextStyle(fontSize: 14, color: AppColors.ink, fontWeight: FontWeight.w500), overflow: TextOverflow.ellipsis)),
        ],
      ),
    );
  }

  Widget _actionTile(IconData icon, String title, String subtitle, VoidCallback onTap) {
    return ListTile(
      onTap: onTap,
      leading: CircleAvatar(backgroundColor: AppColors.brand.withValues(alpha: 0.1), child: Icon(icon, color: AppColors.brand, size: 20)),
      title: Text(title, style: const TextStyle(fontWeight: FontWeight.w600, color: AppColors.ink)),
      subtitle: Text(subtitle, style: const TextStyle(fontSize: 12, color: AppColors.muted)),
      trailing: const Icon(Icons.chevron_right, color: AppColors.muted),
    );
  }
}

// --- Edit display name (bottom sheet) ---
class _EditNameSheet extends StatefulWidget {
  final String initial;
  const _EditNameSheet({required this.initial});

  @override
  State<_EditNameSheet> createState() => _EditNameSheetState();
}

class _EditNameSheetState extends State<_EditNameSheet> {
  late final TextEditingController _name = TextEditingController(text: widget.initial);
  bool _saving = false;

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    FocusScope.of(context).unfocus();
    Haptics.light();
    setState(() => _saving = true);
    try {
      final v = _name.text.trim();
      await Api.updateProfileName(v);
      Haptics.success();
      if (mounted) {
        showSnack(context, 'Profile updated');
        Navigator.pop(context, v);
      }
    } catch (e) {
      Haptics.error();
      if (mounted) {
        setState(() => _saving = false);
        showSnack(context, '$e', error: true);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(left: 16, right: 16, bottom: MediaQuery.of(context).viewInsets.bottom + 24, top: 4),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const SectionHeader('Edit profile'),
          TextField(controller: _name, autofocus: true, decoration: const InputDecoration(labelText: 'Display name', prefixIcon: Icon(Icons.badge_outlined, size: 20))),
          Gap.lg,
          FilledButton(
            onPressed: _saving ? null : _save,
            child: _saving ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Text('Save'),
          ),
        ],
      ),
    );
  }
}

// --- Change password (bottom sheet) ---
class _ChangePasswordSheet extends StatefulWidget {
  final String email;
  const _ChangePasswordSheet({required this.email});

  @override
  State<_ChangePasswordSheet> createState() => _ChangePasswordSheetState();
}

class _ChangePasswordSheetState extends State<_ChangePasswordSheet> {
  final _cur = TextEditingController();
  final _next = TextEditingController();
  final _confirm = TextEditingController();
  bool _saving = false;

  @override
  void dispose() {
    _cur.dispose();
    _next.dispose();
    _confirm.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_next.text != _confirm.text) {
      Haptics.warn();
      showSnack(context, 'New passwords do not match', error: true);
      return;
    }
    FocusScope.of(context).unfocus();
    Haptics.light();
    setState(() => _saving = true);
    final auth = Supabase.instance.client.auth;
    try {
      await auth.signInWithPassword(email: widget.email, password: _cur.text);
      await auth.updateUser(UserAttributes(password: _next.text));
      Haptics.success();
      if (mounted) {
        showSnack(context, 'Password changed');
        Navigator.pop(context);
      }
    } on AuthException catch (e) {
      Haptics.error();
      final msg = e.message.toLowerCase().contains('invalid') ? 'Current password is incorrect' : e.message;
      if (mounted) {
        setState(() => _saving = false);
        showSnack(context, msg, error: true);
      }
    } catch (e) {
      Haptics.error();
      if (mounted) {
        setState(() => _saving = false);
        showSnack(context, '$e', error: true);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(left: 16, right: 16, bottom: MediaQuery.of(context).viewInsets.bottom + 24, top: 4),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const SectionHeader('Change password'),
          TextField(controller: _cur, obscureText: true, decoration: const InputDecoration(labelText: 'Current password', prefixIcon: Icon(Icons.lock_outline, size: 20))),
          Gap.sm,
          TextField(controller: _next, obscureText: true, decoration: const InputDecoration(labelText: 'New password (min 6)', prefixIcon: Icon(Icons.lock_reset, size: 20))),
          Gap.sm,
          TextField(controller: _confirm, obscureText: true, decoration: const InputDecoration(labelText: 'Confirm new password', prefixIcon: Icon(Icons.lock_reset, size: 20))),
          Gap.lg,
          FilledButton(
            onPressed: _saving ? null : _save,
            child: _saving ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Text('Change password'),
          ),
        ],
      ),
    );
  }
}
