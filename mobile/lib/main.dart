import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'config.dart';
import 'screens/home_screen.dart';
import 'screens/login_screen.dart';
import 'storage.dart';
import 'theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // NOT edge-to-edge: the status/navigation bars take their own space and content
  // sits below them. Reliable across OEMs (some, e.g. ColorOS, don't report the
  // edge-to-edge insets, which made the AppBar draw under the status bar). This is
  // also enforced natively in MainActivity via setDecorFitsSystemWindows(true),
  // because Flutter 3.41 draws edge-to-edge by default and this manual-mode call
  // alone isn't honoured on every OEM.
  SystemChrome.setEnabledSystemUIMode(SystemUiMode.manual, overlays: SystemUiOverlay.values);
  SystemChrome.setSystemUIOverlayStyle(const SystemUiOverlayStyle(
    statusBarColor: Color(0xFFF6F7FB),
    statusBarIconBrightness: Brightness.dark,
    statusBarBrightness: Brightness.light,
    systemNavigationBarColor: Colors.white,
    systemNavigationBarIconBrightness: Brightness.dark,
  ));
  await Store.init();
  await Supabase.initialize(url: Config.supabaseUrl, publishableKey: Config.supabaseAnonKey);
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
