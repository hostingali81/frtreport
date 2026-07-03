import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

// --- design tokens ---
class AppColors {
  static const brand = Color(0xFF4F46E5); // indigo 600
  static const brandDark = Color(0xFF4338CA);
  static const bg = Color(0xFFF6F7FB);
  static const surface = Colors.white;
  static const border = Color(0xFFE7EAF0);
  static const ink = Color(0xFF0F172A); // slate 900
  static const inkSoft = Color(0xFF475569); // slate 600
  static const muted = Color(0xFF94A3B8); // slate 400

  static const success = Color(0xFF059669);
  static const successBg = Color(0xFFD1FAE5);
  static const warning = Color(0xFFB45309);
  static const warningBg = Color(0xFFFEF3C7);
  static const danger = Color(0xFFDC2626);
  static const dangerBg = Color(0xFFFEE2E2);
}

class Gap {
  static const xs = SizedBox(height: 4, width: 4);
  static const sm = SizedBox(height: 8, width: 8);
  static const md = SizedBox(height: 12, width: 12);
  static const lg = SizedBox(height: 16, width: 16);
  static const xl = SizedBox(height: 24, width: 24);
}

const kRadius = 14.0;
const kRadiusSm = 10.0;

ThemeData buildTheme() {
  final scheme = ColorScheme.fromSeed(seedColor: AppColors.brand).copyWith(
    surface: AppColors.surface,
    onSurface: AppColors.ink,
    outlineVariant: AppColors.border,
    primary: AppColors.brand,
  );

  OutlineInputBorder border(Color c, [double w = 1]) => OutlineInputBorder(
        borderRadius: BorderRadius.circular(kRadiusSm),
        borderSide: BorderSide(color: c, width: w),
      );

  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    scaffoldBackgroundColor: AppColors.bg,
    splashFactory: InkSparkle.splashFactory,
    fontFamily: 'Roboto',
    appBarTheme: const AppBarTheme(
      backgroundColor: AppColors.bg,
      surfaceTintColor: Colors.transparent,
      scrolledUnderElevation: 0.5,
      elevation: 0,
      centerTitle: false,
      titleTextStyle: TextStyle(color: AppColors.ink, fontSize: 20, fontWeight: FontWeight.w800),
      iconTheme: IconThemeData(color: AppColors.ink),
      systemOverlayStyle: SystemUiOverlayStyle(
        statusBarColor: AppColors.bg,
        statusBarIconBrightness: Brightness.dark,
        statusBarBrightness: Brightness.light,
      ),
    ),
    cardTheme: CardThemeData(
      color: AppColors.surface,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(kRadius), side: const BorderSide(color: AppColors.border)),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 18),
        textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(kRadiusSm)),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: AppColors.inkSoft,
        side: const BorderSide(color: AppColors.border),
        padding: const EdgeInsets.symmetric(vertical: 13, horizontal: 16),
        textStyle: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(kRadiusSm)),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(foregroundColor: AppColors.brand, textStyle: const TextStyle(fontWeight: FontWeight.w600)),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: AppColors.surface,
      isDense: true,
      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
      hintStyle: const TextStyle(color: AppColors.muted, fontSize: 14),
      labelStyle: const TextStyle(color: AppColors.inkSoft, fontSize: 14),
      border: border(AppColors.border),
      enabledBorder: border(AppColors.border),
      focusedBorder: border(AppColors.brand, 1.5),
      errorBorder: border(AppColors.danger),
      focusedErrorBorder: border(AppColors.danger, 1.5),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: AppColors.surface,
      surfaceTintColor: Colors.transparent,
      indicatorColor: AppColors.brand.withValues(alpha: 0.12),
      elevation: 3,
      height: 64,
      labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
      labelTextStyle: WidgetStateProperty.resolveWith((s) => TextStyle(
            fontSize: 12,
            fontWeight: s.contains(WidgetState.selected) ? FontWeight.w700 : FontWeight.w500,
            color: s.contains(WidgetState.selected) ? AppColors.brand : AppColors.muted,
          )),
      iconTheme: WidgetStateProperty.resolveWith((s) => IconThemeData(
            color: s.contains(WidgetState.selected) ? AppColors.brand : AppColors.muted,
          )),
    ),
    segmentedButtonTheme: SegmentedButtonThemeData(
      style: ButtonStyle(
        visualDensity: VisualDensity.compact,
        textStyle: const WidgetStatePropertyAll(TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
        side: const WidgetStatePropertyAll(BorderSide(color: AppColors.border)),
        backgroundColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? AppColors.brand : Colors.white),
        foregroundColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? Colors.white : AppColors.inkSoft),
      ),
    ),
    dropdownMenuTheme: const DropdownMenuThemeData(),
    snackBarTheme: SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      backgroundColor: AppColors.ink,
      contentTextStyle: const TextStyle(color: Colors.white),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(kRadiusSm)),
    ),
    dividerTheme: const DividerThemeData(color: AppColors.border, thickness: 1, space: 1),
    progressIndicatorTheme: const ProgressIndicatorThemeData(color: AppColors.brand),
    chipTheme: const ChipThemeData(side: BorderSide(color: AppColors.border)),
  );
}

// Semantic haptics — one place so feedback stays consistent.
class Haptics {
  static void tap() => HapticFeedback.selectionClick();
  static void light() => HapticFeedback.lightImpact();
  static void medium() => HapticFeedback.mediumImpact();
  static void success() => HapticFeedback.mediumImpact();
  static void warn() => HapticFeedback.heavyImpact();
  static void error() => HapticFeedback.vibrate();
}
