// tts_service.dart
import 'dart:async';

class TtsService {
  bool get isSpeaking => false;
  Function()? onCompletion;

  TtsService() {
    // No-op
  }

  // Speak a custom string message
  Future<void> speak(String text) async {
    // No-op
  }

  // Speak a message and await its completion
  Future<void> speakAndAwait(String text, {Duration timeout = const Duration(seconds: 10)}) async {
    // No-op
  }

  // Read back structured inspection confirmation
  Future<void> speakInspectionConfirmation({
    required String equipmentId,
    required String faultCode,
    required String severity,
    required List<String> parts,
  }) async {
    // No-op
  }

  // Speak a RAG manual answering summary
  Future<void> speakAnswer(String answer) async {
    // No-op
  }

  // Stop current active speech
  Future<void> stop() async {
    // No-op
  }
}
