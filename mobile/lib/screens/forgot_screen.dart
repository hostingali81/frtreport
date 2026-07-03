import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../theme.dart';
import '../widgets.dart';
import 'reset_screen.dart';

class ForgotScreen extends StatefulWidget {
  const ForgotScreen({super.key});

  @override
  State<ForgotScreen> createState() => _ForgotScreenState();
}

class _ForgotScreenState extends State<ForgotScreen> {
  final _email = TextEditingController();
  bool _loading = false;
  String? _error;

  @override
  void dispose() {
    _email.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    FocusScope.of(context).unfocus();
    Haptics.light();
    setState(() {
      _loading = true;
      _error = null;
    });
    final email = _email.text.trim();
    try {
      await Supabase.instance.client.auth.resetPasswordForEmail(email);
      Haptics.success();
      if (!mounted) return;
      Navigator.pushReplacement(context, MaterialPageRoute(builder: (_) => ResetScreen(email: email)));
    } on AuthException catch (e) {
      Haptics.error();
      setState(() => _error = e.message);
    } catch (e) {
      Haptics.error();
      setState(() => _error = 'Request failed: $e');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Reset password')),
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
                  Container(
                    width: 52,
                    height: 52,
                    decoration: BoxDecoration(color: AppColors.brand.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(14)),
                    child: const Icon(Icons.lock_reset, color: AppColors.brand, size: 26),
                  ),
                  Gap.md,
                  const Text('Forgot your password?', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700, color: AppColors.ink)),
                  const SizedBox(height: 4),
                  const Text("Enter your email and we'll send a 6-digit code.", style: TextStyle(color: AppColors.muted, fontSize: 13)),
                  Gap.lg,
                  TextField(
                    controller: _email,
                    keyboardType: TextInputType.emailAddress,
                    autocorrect: false,
                    onSubmitted: (_) => _submit(),
                    decoration: const InputDecoration(labelText: 'Email', prefixIcon: Icon(Icons.mail_outline, size: 20)),
                  ),
                  if (_error != null) ...[Gap.md, Text(_error!, style: const TextStyle(color: AppColors.danger, fontSize: 13))],
                  Gap.lg,
                  FilledButton(
                    onPressed: _loading ? null : _submit,
                    child: _loading
                        ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                        : const Text('Send code'),
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
