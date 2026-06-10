// main.dart
import 'package:flutter/material.dart';
import 'screens/home_screen.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const FieldVoiceApp());
}

class FieldVoiceApp extends StatelessWidget {
  const FieldVoiceApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'FieldVoice AI',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        fontFamily: 'Roboto', // Default fallback font that is standard on Android
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF1E293B), // Slate-900 / Dark Slate tone
          primary: const Color(0xFF2563EB),   // Blue-600 premium action blue
          secondary: const Color(0xFF475569), // Slate-600 supporting color
          surface: Colors.white,
          background: const Color(0xFFF8FAFC), // Slate-50 background shade
        ),
        appBarTheme: const AppBarTheme(
          backgroundColor: Colors.white,
          foregroundColor: Color(0xFF0F172A), // Slate-900 text
          elevation: 0,
          scrolledUnderElevation: 0.5,
        ),
        cardTheme: CardTheme(
          color: Colors.white,
          elevation: 0,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(8),
            side: const BorderSide(color: Color(0xFFE2E8F0), width: 1), // Slate-200 border
          ),
        ),
        elevatedButtonTheme: ElevatedButtonThemeData(
          style: ElevatedButton.styleFrom(
            backgroundColor: const Color(0xFF2563EB), // Blue-600
            foregroundColor: Colors.white,
            elevation: 0,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(6),
            ),
          ),
        ),
      ),
      home: const HomeScreen(),
    );
  }
}
