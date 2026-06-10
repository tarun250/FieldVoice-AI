// audio_service.dart
import 'dart:io';
import 'package:record/record.dart';
import 'package:just_audio/just_audio.dart';
import 'package:path_provider/path_provider.dart';

class AudioService {
  final _record = AudioRecorder();
  final _player = AudioPlayer();
  
  bool _isRecording = false;
  bool get isRecording => _isRecording;

  // Check and request microphone permission
  Future<bool> checkPermission() async {
    return await _record.hasPermission();
  }

  // Start recording audio and save to temporary .m4a file
  Future<String?> startRecording() async {
    try {
      if (await checkPermission()) {
        final tempDir = await getTemporaryDirectory();
        final path = '${tempDir.path}/voice_report_${DateTime.now().millisecondsSinceEpoch}.m4a';
        
        await _record.start(
          const RecordConfig(
            encoder: AudioEncoder.aacLc, 
            sampleRate: 16000, 
            bitRate: 32000
          ), 
          path: path
        );
        _isRecording = true;
        return path;
      }
    } catch (e) {
      print('AudioService: Failed to start recording: $e');
    }
    return null;
  }

  // Stop recording and return path
  Future<String?> stopRecording() async {
    try {
      final path = await _record.stop();
      _isRecording = false;
      return path;
    } catch (e) {
      print('AudioService: Failed to stop recording: $e');
      _isRecording = false;
      return null;
    }
  }

  // Play audio from local path
  Future<void> playAudio(String filePath) async {
    try {
      if (await File(filePath).exists()) {
        await _player.setFilePath(filePath);
        await _player.play();
      } else {
        print('AudioService Play Error: File does not exist at $filePath');
      }
    } catch (e) {
      print('AudioService Play Error: $e');
    }
  }

  // Stop playback
  Future<void> stopAudio() async {
    await _player.stop();
  }

  void dispose() {
    _record.dispose();
    _player.dispose();
  }
}
