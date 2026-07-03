import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'config.dart';
import 'screens/home_screen.dart';
import 'screens/login_screen.dart';
import 'theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setSystemUIOverlayStyle(const SystemUiOverlayStyle(
    statusBarColor: Colors.transparent,
    statusBarIconBrightness: Brightness.dark,
  ));
  await Supabase.initialize(url: Config.supabaseUrl, anonKey: Config.supabaseAnonKey);
  runApp(const FrtApp());
}

SupabaseClient get supabase => Supabase.instance.client;

class FrtApp extends StatelessWidget {
  const FrtApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'FRT Calling',
      debugShowCheckedModeBanner: false,
      theme: buildTheme(),
      home: const AuthGate(),
    );
  }
}

// Shows the login screen when signed out, the app when signed in. Rebuilds on
// every Supabase auth state change.
class AuthGate extends StatelessWidget {
  const AuthGate({super.key});

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<AuthState>(
      stream: supabase.auth.onAuthStateChange,
      builder: (context, _) {
        final signedIn = supabase.auth.currentSession != null;
        return signedIn ? const HomeScreen() : const LoginScreen();
      },
    );
  }
}
