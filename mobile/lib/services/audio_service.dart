// audio_service.dart
import 'dart:io';
import 'dart:typed_data';
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

  // Start streaming raw PCM 16-bit audio
  Future<Stream<Uint8List>?> startStream() async {
    try {
      if (await checkPermission()) {
        final stream = await _record.startStream(
          const RecordConfig(
            encoder: AudioEncoder.pcm16bits,
            sampleRate: 16000,
            numChannels: 1,
          ),
        );
        _isRecording = true;
        return stream;
      }
    } catch (e) {
      print('AudioService: Failed to start stream: $e');
    }
    return null;
  }

  // Stop recording and return path (also stops stream)
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

  // Prepend standard 44-byte WAV header to PCM bytes
  Uint8List _getWavHeader(int numChannels, int sampleRate, int bitsPerSample, int pcmDataLength) {
    final int byteRate = sampleRate * numChannels * bitsPerSample ~/ 8;
    final int blockAlign = numChannels * bitsPerSample ~/ 8;
    final int subChunk2Size = pcmDataLength;
    final int chunkSize = 36 + subChunk2Size;

    final header = ByteData(44);
    
    // "RIFF"
    header.setUint8(0, 0x52); // R
    header.setUint8(1, 0x49); // I
    header.setUint8(2, 0x46); // F
    header.setUint8(3, 0x46); // F
    
    // ChunkSize
    header.setUint32(4, chunkSize, Endian.little);
    
    // "WAVE"
    header.setUint8(8, 0x57);  // W
    header.setUint8(9, 0x41);  // A
    header.setUint8(10, 0x56); // V
    header.setUint8(11, 0x45); // E
    
    // "fmt "
    header.setUint8(12, 0x66); // f
    header.setUint8(13, 0x6d); // m
    header.setUint8(14, 0x74); // t
    header.setUint8(15, 0x20); //  
    
    // Subchunk1Size (16 for PCM)
    header.setUint32(16, 16, Endian.little);
    
    // AudioFormat (1 for PCM)
    header.setUint16(20, 1, Endian.little);
    
    // NumChannels
    header.setUint16(22, numChannels, Endian.little);
    
    // SampleRate
    header.setUint32(24, sampleRate, Endian.little);
    
    // ByteRate
    header.setUint32(28, byteRate, Endian.little);
    
    // BlockAlign
    header.setUint16(32, blockAlign, Endian.little);
    
    // BitsPerSample
    header.setUint16(34, bitsPerSample, Endian.little);
    
    // "data"
    header.setUint8(36, 0x64); // d
    header.setUint8(37, 0x61); // a
    header.setUint8(38, 0x74); // t
    header.setUint8(39, 0x61); // a
    
    // Subchunk2Size (data length in bytes)
    header.setUint32(40, subChunk2Size, Endian.little);
    
    return header.buffer.asUint8List();
  }

  // Save raw PCM bytes to a valid WAV file
  Future<void> savePcmToWav(Uint8List pcmBytes, String targetPath) async {
    final file = File(targetPath);
    final header = _getWavHeader(1, 16000, 16, pcmBytes.length);
    final raf = await file.open(mode: FileMode.write);
    await raf.writeFrom(header);
    await raf.writeFrom(pcmBytes);
    await raf.close();
  }

  void dispose() {
    _record.dispose();
    _player.dispose();
  }
}
