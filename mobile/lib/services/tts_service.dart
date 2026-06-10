// tts_service.dart
import 'package:flutter_tts/flutter_tts.dart';

class TtsService {
  final FlutterTts _flutterTts = FlutterTts();
  bool _isSpeaking = false;
  bool get isSpeaking => _isSpeaking;

  TtsService() {
    _initTts();
  }

  void _initTts() {
    _flutterTts.setStartHandler(() {
      _isSpeaking = true;
    });

    _flutterTts.setCompletionHandler(() {
      _isSpeaking = false;
    });

    _flutterTts.setErrorHandler((msg) {
      _isSpeaking = false;
      print('TTS Service Error: $msg');
    });
  }

  // Speak a custom string message
  Future<void> speak(String text) async {
    try {
      await _flutterTts.setLanguage("en-US");
      await _flutterTts.setSpeechRate(0.45); // Standard operational reading pace
      await _flutterTts.setVolume(1.0);
      await _flutterTts.setPitch(1.0);
      
      await _flutterTts.speak(text);
    } catch (e) {
      print('TTS Service Speak failed: $e');
      _isSpeaking = false;
    }
  }

  // Read back structured inspection confirmation
  Future<void> speakInspectionConfirmation({
    required String equipmentId,
    required String faultCode,
    required String severity,
    required List<String> parts,
  }) async {
    final partsText = parts.isEmpty ? "no replacement parts" : "required parts: ${parts.join(', ')}";
    final message = "Verify report details. "
                    "Equipment ID is $equipmentId. "
                    "Detected fault code is $faultCode. "
                    "Severity is $severity. "
                    "And $partsText. "
                    "Hold to confirm and save.";
    await speak(message);
  }

  // Speak a RAG manual answering summary
  Future<void> speakAnswer(String answer) async {
    await speak("Response from knowledge manual: $answer");
  }

  // Stop current active speech
  Future<void> stop() async {
    await _flutterTts.stop();
    _isSpeaking = false;
  }
}
