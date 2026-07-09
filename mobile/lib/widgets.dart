import 'package:flutter/material.dart';

import 'theme.dart';

// Phone-app-style call direction/outcome icon, shared by the Reports "Recent
// calls" list and the detail-sheet call history so they read the same:
//   outgoing answered  -> call_made          (green)
//   outgoing no-answer -> call_missed_outgoing (amber)
//   incoming answered  -> call_received       (green)
//   incoming missed    -> call_missed          (red)
class CallGlyph {
  final IconData icon;
  final Color color;
  const CallGlyph(this.icon, this.color);
}

CallGlyph callGlyph({required bool isIncoming, required bool connected}) {
  if (isIncoming) {
    return connected
        ? const CallGlyph(Icons.call_received, AppColors.success)
        : const CallGlyph(Icons.call_missed, AppColors.danger);
  }
  return connected
      ? const CallGlyph(Icons.call_made, AppColors.success)
      : const CallGlyph(Icons.call_missed_outgoing, AppColors.warning);
}

// A white, rounded, bordered surface used everywhere. Tappable variant adds ink
// ripple + a light haptic.
class AppCard extends StatelessWidget {
  final Widget child;
  final EdgeInsetsGeometry padding;
  final VoidCallback? onTap;
  final Color? background;
  final Color? borderColor;
  const AppCard({super.key, required this.child, this.padding = const EdgeInsets.all(14), this.onTap, this.background, this.borderColor});

  @override
  Widget build(BuildContext context) {
    final content = AnimatedContainer(
      duration: const Duration(milliseconds: 180),
      decoration: BoxDecoration(
        color: background ?? AppColors.surface,
        borderRadius: BorderRadius.circular(kRadius),
        border: Border.all(color: borderColor ?? AppColors.border),
      ),
      padding: padding,
      child: child,
    );
    if (onTap == null) return content;
    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: BorderRadius.circular(kRadius),
        onTap: () {
          Haptics.light();
          onTap!();
        },
        child: content,
      ),
    );
  }
}

class SectionHeader extends StatelessWidget {
  final String title;
  final Widget? trailing;
  const SectionHeader(this.title, {super.key, this.trailing});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8, top: 4),
      child: Row(
        children: [
          Expanded(child: Text(title, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: AppColors.ink))),
          ?trailing,
        ],
      ),
    );
  }
}

class Pill extends StatelessWidget {
  final String text;
  final Color fg;
  final Color? bg;
  final FontWeight weight;
  const Pill(this.text, {super.key, this.fg = AppColors.inkSoft, this.bg, this.weight = FontWeight.w600});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
      decoration: BoxDecoration(color: bg ?? fg.withValues(alpha: 0.10), borderRadius: BorderRadius.circular(20)),
      child: Text(text, style: TextStyle(color: fg, fontSize: 11, fontWeight: weight)),
    );
  }
}

class EmptyState extends StatelessWidget {
  final IconData icon;
  final String title;
  final String? subtitle;
  final Widget? action;
  const EmptyState({super.key, required this.icon, required this.title, this.subtitle, this.action});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 64,
              height: 64,
              decoration: BoxDecoration(color: AppColors.brand.withValues(alpha: 0.08), shape: BoxShape.circle),
              child: Icon(icon, color: AppColors.brand, size: 30),
            ),
            Gap.lg,
            Text(title, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: AppColors.ink), textAlign: TextAlign.center),
            if (subtitle != null) ...[Gap.xs, Text(subtitle!, style: const TextStyle(fontSize: 13, color: AppColors.muted), textAlign: TextAlign.center)],
            if (action != null) ...[Gap.lg, action!],
          ],
        ),
      ),
    );
  }
}

// Lightweight shimmer sweep used for loading skeletons.
class Shimmer extends StatefulWidget {
  final Widget child;
  const Shimmer({super.key, required this.child});

  @override
  State<Shimmer> createState() => _ShimmerState();
}

class _ShimmerState extends State<Shimmer> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 1200))..repeat();

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _c,
      builder: (context, child) {
        return ShaderMask(
          blendMode: BlendMode.srcATop,
          shaderCallback: (bounds) {
            final dx = (bounds.width + 200) * _c.value - 100;
            return LinearGradient(
              colors: const [Color(0xFFECEFF4), Color(0xFFF7F9FC), Color(0xFFECEFF4)],
              stops: const [0.35, 0.5, 0.65],
              begin: Alignment(-1 + dx / bounds.width, 0),
              end: Alignment(1 + dx / bounds.width, 0),
            ).createShader(bounds);
          },
          child: child,
        );
      },
      child: widget.child,
    );
  }
}

class _SkelBox extends StatelessWidget {
  final double w;
  final double h;
  const _SkelBox(this.w, this.h);
  @override
  Widget build(BuildContext context) => Container(
        width: w,
        height: h,
        decoration: BoxDecoration(color: const Color(0xFFECEFF4), borderRadius: BorderRadius.circular(6)),
      );
}

// Skeleton list of complaint-card placeholders.
class SkeletonList extends StatelessWidget {
  final int count;
  const SkeletonList({super.key, this.count = 6});

  @override
  Widget build(BuildContext context) {
    return Shimmer(
      child: ListView.separated(
        padding: const EdgeInsets.all(12),
        itemCount: count,
        separatorBuilder: (_, _) => Gap.sm,
        itemBuilder: (_, _) => Container(
          decoration: BoxDecoration(color: AppColors.surface, borderRadius: BorderRadius.circular(kRadius), border: Border.all(color: AppColors.border)),
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: const [
              Row(children: [_SkelBox(120, 14), Spacer(), _SkelBox(72, 18)]),
              SizedBox(height: 10),
              _SkelBox(180, 12),
              SizedBox(height: 8),
              _SkelBox(140, 10),
              SizedBox(height: 14),
              Row(children: [_SkelBox(90, 10), Spacer(), _SkelBox(70, 20)]),
            ],
          ),
        ),
      ),
    );
  }
}

void showSnack(BuildContext context, String message, {bool error = false}) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(
      content: Text(message),
      backgroundColor: error ? AppColors.danger : AppColors.ink,
    ));
}

class SafeTop extends StatelessWidget {
  final Widget child;
  const SafeTop({super.key, required this.child});

  @override
  Widget build(BuildContext context) {
    final mediaQuery = MediaQuery.of(context);
    final topPadding = mediaQuery.viewPadding.top > 0 ? mediaQuery.viewPadding.top : 36.0;

    return MediaQuery(
      data: mediaQuery.copyWith(
        padding: mediaQuery.padding.copyWith(top: 0),
        viewPadding: mediaQuery.viewPadding.copyWith(top: 0),
      ),
      child: Padding(
        padding: EdgeInsets.only(top: topPadding),
        child: child,
      ),
    );
  }
}
