import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../theme.dart';
import '../widgets.dart';

class ResetScreen extends StatefulWidget {
  final String email;
  const ResetScreen({super.key, required this.email});

  @override
  State<ResetScreen> createState() => _ResetScreenState();
}

class _ResetScreenState extends State<ResetScreen> {
  late final TextEditingController _email = TextEditingController(text: widget.email);
  final _code = TextEditingController();
  final _password = TextEditingController();
  final _confirm = TextEditingController();
  bool _loading = false;
  String? _error;

  @override
  void dispose() {
    _email.dispose();
    _code.dispose();
    _password.dispose();
    _confirm.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_password.text != _confirm.text) {
      Haptics.warn();
      setState(() => _error = 'Passwords do not match');
      return;
    }
    FocusScope.of(context).unfocus();
    Haptics.light();
    setState(() {
      _loading = true;
      _error = null;
    });
    final auth = Supabase.instance.client.auth;
    try {
      await auth.verifyOTP(email: _email.text.trim(), token: _code.text.trim(), type: OtpType.recovery);
      await auth.updateUser(UserAttributes(password: _password.text));
      await auth.signOut();
      Haptics.success();
      if (!mounted) return;
      showSnack(context, 'Password updated — please sign in.');
      Navigator.of(context).popUntil((r) => r.isFirst);
    } on AuthException catch (e) {
      Haptics.error();
      setState(() => _error = e.message);
    } catch (e) {
      Haptics.error();
      setState(() => _error = 'Reset failed: $e');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Enter code')),
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 400),
            child: AppCard(
              padding: const EdgeInsets.all(20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Text('Enter code & new password', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700, color: AppColors.ink)),
                  const SizedBox(height: 4),
                  const Text('We sent a 6-digit code to your email.', style: TextStyle(color: AppColors.muted, fontSize: 13)),
                  Gap.lg,
                  TextField(controller: _email, keyboardType: TextInputType.emailAddress, autocorrect: false, decoration: const InputDecoration(labelText: 'Email', prefixIcon: Icon(Icons.mail_outline, size: 20))),
                  Gap.md,
                  TextField(
                    controller: _code,
                    keyboardType: TextInputType.number,
                    maxLength: 6,
                    textAlign: TextAlign.center,
                    inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                    style: const TextStyle(fontSize: 24, letterSpacing: 10, fontWeight: FontWeight.w700),
                    decoration: const InputDecoration(hintText: '••••••', counterText: '', hintStyle: TextStyle(letterSpacing: 10, color: AppColors.border)),
                  ),
                  Gap.md,
                  TextField(controller: _password, obscureText: true, decoration: const InputDecoration(labelText: 'New password (min 6)', prefixIcon: Icon(Icons.lock_outline, size: 20))),
                  Gap.sm,
                  TextField(controller: _confirm, obscureText: true, decoration: const InputDecoration(labelText: 'Confirm new password', prefixIcon: Icon(Icons.lock_outline, size: 20))),
                  if (_error != null) ...[Gap.md, Text(_error!, style: const TextStyle(color: AppColors.danger, fontSize: 13))],
                  Gap.lg,
                  FilledButton(
                    onPressed: _loading ? null : _submit,
                    child: _loading
                        ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                        : const Text('Update password'),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
