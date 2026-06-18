// home_screen.dart
import 'dart:async';
import 'package:flutter/material.dart';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:speech_to_text/speech_to_text.dart' as stt;
import '../config/constants.dart';
import '../services/audio_service.dart';
import '../services/tts_service.dart';
import '../services/api_service.dart';
import '../services/database_service.dart';
import 'queue_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> with SingleTickerProviderStateMixin {
  final AudioService _audioService = AudioService();
  final TtsService _ttsService = TtsService();
  final ApiService _apiService = ApiService();
  final DatabaseService _dbService = DatabaseService.instance;

  // Speech to Text (local) variables
  final stt.SpeechToText _speechToText = stt.SpeechToText();
  bool _speechEnabled = false;
  String _localSpeechResult = '';
  bool _explicitSpeechStop = false;
  String _speechSessionAccumulated = '';
  bool _isStartingRecording = false;
  bool _isSpeechListening = false;

  // Network and Sync States
  bool _isOnline = true;
  bool _isSyncing = false;
  int _pendingCount = 0;
  late StreamSubscription<List<ConnectivityResult>> _connectivitySubscription;

  // App Modes: 'inspection' (Log Work Order) or 'query' (RAG Manual Search)
  String _activeMode = 'inspection'; 

  // Recording & Pipeline States
  bool _isRecording = false;
  String? _recordedFilePath;
  bool _isProcessing = false;
  String _statusMessage = 'System ready. Select mode and hold button to speak.';
  
  // Console log outputs
  String? _rawTranscript;
  Map<String, dynamic>? _extractedData;
  String? _ragResponse;

  // Animation controller for mic record pulse waves
  late AnimationController _pulseController;

  // Hands-free Voice Confirmation States
  bool _waitingForVoiceConfirmation = false;
  String? _currentAudioStorageUrl;
  Timer? _confirmationTimer;

  @override
  void initState() {
    super.initState();
    _initConnectivity();
    _initDatabase();
    _initSpeech();
    
    _pulseController = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 1),
    );

    _ttsService.onCompletion = () {
      _onTtsCompleted();
    };
  }

  Future<void> _initSpeech() async {
    try {
      bool available = await _speechToText.initialize(
        onStatus: _onSpeechStatus,
        onError: (errorNotification) => print('Speech error: $errorNotification'),
      );
      setState(() {
        _speechEnabled = available;
      });
      if (available) {
        _startIdleVoiceTriggerListener();
      }
    } catch (e) {
      print('SpeechToText init error: $e');
    }
  }

  void _onSpeechStatus(String status) {
    print('Speech status: $status');
    setState(() {
      _isSpeechListening = (status == 'listening');
    });
    if (status == 'notListening' || status == 'done') {
      if (_explicitSpeechStop) {
        _explicitSpeechStop = false;
        return;
      }
      _handleImplicitSpeechStop();
    }
  }

  void _handleImplicitSpeechStop() {
    if (!mounted) return;

    if (_waitingForVoiceConfirmation) {
      print('Speech stopped implicitly during confirmation phase. Words: "$_localSpeechResult"');
      
      final words = _localSpeechResult.trim().toLowerCase();
      if (words.isNotEmpty) {
        final bool isConfirm = words.contains('confirm') ||
                              words.contains('yes') ||
                              words.contains('yeah') ||
                              words.contains('ok') ||
                              words.contains('submit') ||
                              words.contains('approved');

        final bool isCancel = words.contains('cancel') ||
                             words.contains('reject') ||
                             words.contains('no') ||
                             words.contains('try again') ||
                             words.contains('reset');

        _cancelConfirmationRecording();
        _processVoiceConfirmation(isConfirm, isCancel);
      } else {
        // Silent stop: just restart listening without resetting timer
        _startVoiceConfirmationListener(resetTimer: false);
      }
    } else if (_isRecording) {
      print('Speech stopped implicitly during recording. Restarting listener...');
      _restartRecordingSpeechListener();
    } else if (!_isProcessing) {
      print('Speech stopped implicitly in idle. Restarting idle listener...');
      _startIdleVoiceTriggerListener();
    }
  }

  Future<void> _startIdleVoiceTriggerListener() async {
    if (!mounted || _isRecording || _waitingForVoiceConfirmation || _isProcessing || _isStartingRecording) return;

    if (!_speechEnabled) return;

    setState(() {
      _statusMessage = 'System ready. Say "Start Inspection" or tap Start button.';
    });

    try {
      _explicitSpeechStop = false;
      await _speechToText.listen(
        onResult: (result) {
          final words = result.recognizedWords.toLowerCase().trim();
          if (words.contains('start inspection') || words.contains('start recording')) {
            _cancelConfirmationRecording();
            _startRecording();
          }
        },
        listenFor: const Duration(hours: 1),
        pauseFor: const Duration(seconds: 60),
        listenOptions: stt.SpeechListenOptions(
          cancelOnError: false,
          partialResults: true,
        ),
      );
    } catch (e) {
      print('Idle trigger listener failed: $e');
    }
  }

  void _cancelIdleVoiceTriggerListener() {
    _explicitSpeechStop = true;
    if (_speechToText.isListening) {
      _speechToText.stop();
    }
  }

  Future<void> _initConnectivity() async {
    final connectivity = Connectivity();
    final result = await connectivity.checkConnectivity();
    _updateConnectionStatus(result);

    _connectivitySubscription = connectivity.onConnectivityChanged.listen((results) {
      _updateConnectionStatus(results);
    });
  }

  void _updateConnectionStatus(List<ConnectivityResult> results) {
    final hasConnection = !results.contains(ConnectivityResult.none);
    setState(() {
      _isOnline = hasConnection;
      if (_isOnline) {
        _statusMessage = 'Connected. Ready for live processing.';
        _triggerQueueSync();
      } else {
        _statusMessage = 'Offline. Inspections will be queued locally.';
      }
    });
  }

  Future<void> _initDatabase() async {
    // Access database to update pending count badge
    await _refreshPendingCount();
  }

  Future<void> _refreshPendingCount() async {
    final pending = await _dbService.getPending();
    setState(() {
      _pendingCount = pending.length;
    });
  }

  @override
  void dispose() {
    _connectivitySubscription.cancel();
    _audioService.dispose();
    _ttsService.stop();
    _pulseController.dispose();
    _confirmationTimer?.cancel();
    super.dispose();
  }

  // Handle Recording Trigger
  Future<void> _startRecording() async {
    if (_isRecording || _isStartingRecording) return;
    
    _isStartingRecording = true;
    _cancelConfirmationRecording();
    _cancelIdleVoiceTriggerListener();
    await _ttsService.stop(); // Stop any reading voice
    
    setState(() {
      _statusMessage = 'Starting inspection...';
    });

    try {
      await _ttsService.speakAndAwait('Inspection started.');
    } catch (e) {
      print('TTS failed during start recording: $e');
    }

    if (!mounted) {
      _isStartingRecording = false;
      return;
    }

    await _startRecordingExecution();
  }

  Future<void> _startRecordingExecution() async {
    _localSpeechResult = '';
    _speechSessionAccumulated = '';
    
    // Check permission first
    final hasPerm = await _audioService.checkPermission();
    if (!hasPerm) {
      setState(() {
        _statusMessage = 'Microphone permission denied.';
      });
      _isStartingRecording = false;
      _startIdleVoiceTriggerListener();
      return;
    }

    setState(() {
      _waitingForVoiceConfirmation = false;
      _isRecording = true;
      _statusMessage = 'Recording audio... Speak clearly.';
      _rawTranscript = null;
      _extractedData = null;
      _ragResponse = null;
      _currentAudioStorageUrl = null;
    });
    _pulseController.repeat(reverse: true);

    // Try initializing again if it wasn't enabled in initState
    if (!_speechEnabled) {
      await _initSpeech();
    }

    // Start speech recognition first
    if (_speechEnabled) {
      try {
        _explicitSpeechStop = false;
        await _speechToText.listen(
          onResult: (result) {
            final words = result.recognizedWords.toLowerCase().trim();
            setState(() {
              _localSpeechResult = '$_speechSessionAccumulated ${result.recognizedWords}'.trim();
              if (_localSpeechResult.trim().isNotEmpty) {
                _statusMessage = 'Listening: "$_localSpeechResult"';
              }
            });

            // Check if user says "stop inspection" or "stop recording" to trigger stop hands-free
            if (words.contains('stop inspection') || words.contains('stop recording')) {
              _stopRecordingAndProcess();
            }
          },
          listenFor: const Duration(seconds: 45),
          pauseFor: const Duration(seconds: 10),
          listenOptions: stt.SpeechListenOptions(
            cancelOnError: true,
            partialResults: true,
          ),
        );
      } catch (e) {
        print('SpeechToText listen failed: $e');
      }
    }

    // Start raw audio recording second
    final path = await _audioService.startRecording();
    if (path != null) {
      setState(() {
        _recordedFilePath = path;
      });
    }

    _isStartingRecording = false;
  }

  Future<void> _stopRecordingAndProcess() async {
    if (!_isRecording) return;
    
    _pulseController.stop();
    _pulseController.reset();
    
    if (_speechToText.isListening) {
      _explicitSpeechStop = true;
      await _speechToText.stop();
    }
    
    final path = await _audioService.stopRecording();
    setState(() {
      _isRecording = false;
    });

    // Speak "Inspection stopped" and wait for completion to avoid overlapping speech
    await _ttsService.speakAndAwait('Inspection stopped.');

    if (path != null) {
      _recordedFilePath = path;
      if (_isOnline) {
        _processAudioLive(path);
      } else {
        _enqueueAudioOffline(path);
      }
    } else {
      _startIdleVoiceTriggerListener();
    }
  }

  Future<void> _restartRecordingSpeechListener() async {
    if (!mounted || !_isRecording || _waitingForVoiceConfirmation || _isProcessing) return;
    if (!_speechEnabled) return;
    try {
      _speechSessionAccumulated = _localSpeechResult;
      _explicitSpeechStop = false;
      await _speechToText.listen(
        onResult: (result) {
          final words = result.recognizedWords.toLowerCase().trim();
          setState(() {
            _localSpeechResult = '$_speechSessionAccumulated ${result.recognizedWords}'.trim();
            if (_localSpeechResult.trim().isNotEmpty) {
              _statusMessage = 'Listening: "$_localSpeechResult"';
            }
          });

          // Check if user says "stop inspection" or "stop recording" to trigger stop hands-free
          if (words.contains('stop inspection') || words.contains('stop recording')) {
            _stopRecordingAndProcess();
          }
        },
        listenFor: const Duration(seconds: 45),
        pauseFor: const Duration(seconds: 10),
        listenOptions: stt.SpeechListenOptions(
          cancelOnError: true,
          partialResults: true,
        ),
      );
    } catch (e) {
      print('Error restarting recording speech listener: $e');
    }
  }

  // 1. Live Processing Loop (Online Path)
  Future<void> _processAudioLive(String filePath) async {
    setState(() {
      _isProcessing = true;
      _statusMessage = 'Processing audio... Transcribing...';
    });

    try {
      // Strip out the hands-free trigger words from the transcript
      String cleanText = _localSpeechResult.trim();
      final lower = cleanText.toLowerCase();
      if (lower.endsWith('stop inspection')) {
        cleanText = cleanText.substring(0, cleanText.length - 'stop inspection'.length).trim();
      } else if (lower.endsWith('stop recording')) {
        cleanText = cleanText.substring(0, cleanText.length - 'stop recording'.length).trim();
      }

      // Step A: Transcribe audio
      final localTx = cleanText.isNotEmpty ? cleanText : null;
      final sttResult = await _apiService.transcribeAudio(
        filePath, 
        'live-tx-${DateTime.now().millisecondsSinceEpoch}',
        localTranscript: localTx,
      );
      final transcriptText = sttResult['text'] as String;
      
      setState(() {
        _rawTranscript = transcriptText;
        _statusMessage = 'Transcribed. Analyzing transcript...';
      });

      if (_activeMode == 'inspection') {
        // Step B: Extract structured fields
        final extractResult = await _apiService.extractStructuredData(transcriptText);
        setState(() {
          _extractedData = extractResult;
          _currentAudioStorageUrl = sttResult['file']['storage_path'] as String?;
          _waitingForVoiceConfirmation = true;
          _isProcessing = false;
          _statusMessage = 'Reviewing. Speak confirmation or tap confirm.';
        });

        // Trigger TTS read back confirmation to Rahul
        final parts = List<String>.from(extractResult['parts_required'] ?? []);
        await _ttsService.speakInspectionConfirmation(
          equipmentId: extractResult['equipment_id'] ?? 'Unspecified machine',
          faultCode: extractResult['fault_code'] ?? 'Unspecified fault',
          severity: extractResult['severity'] ?? 'MEDIUM',
          parts: parts,
        );
      } else {
        // Step B: RAG Search manual
        final answer = await _apiService.queryKnowledgeBase(transcriptText);
        setState(() {
          _ragResponse = answer;
          _isProcessing = false;
          _statusMessage = 'Query answered. Synthesizing voice response...';
        });

        // Playback query answer verbally
        await _ttsService.speakAnswer(answer);
        _startIdleVoiceTriggerListener(); // Restart wake trigger listener
      }
    } catch (e) {
      setState(() {
        _isProcessing = false;
        _statusMessage = 'Error: ${e.toString()}';
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Processing Failed: ${e.toString()}')),
      );
      _startIdleVoiceTriggerListener(); // Restart wake trigger listener
    }
  }

  // Hands-free voice confirmation completion handler
  void _onTtsCompleted() {
    if (_waitingForVoiceConfirmation) {
      _startVoiceConfirmationListener(resetTimer: false);
    }
  }

  void _cancelConfirmationRecording() {
    _confirmationTimer?.cancel();
    _confirmationTimer = null;
    _explicitSpeechStop = true;
    if (_speechToText.isListening) {
      _speechToText.stop();
    }
  }

  Future<void> _startVoiceConfirmationListener({bool resetTimer = true}) async {
    if (!mounted || !_waitingForVoiceConfirmation) return;
    
    // Stop any active recording/listening first
    if (_isRecording) {
      await _audioService.stopRecording();
    }
    if (_speechToText.isListening) {
      _explicitSpeechStop = true;
      await _speechToText.stop();
    }
    
    setState(() {
      _statusMessage = 'Listening for confirmation...';
      _isRecording = true;
      _localSpeechResult = '';
    });

    _pulseController.repeat(reverse: true);

    // Try initializing again if it wasn't enabled
    if (!_speechEnabled) {
      await _initSpeech();
    }

    if (_speechEnabled) {
      try {
        _explicitSpeechStop = false;
        await _speechToText.listen(
          onResult: (result) {
            final words = result.recognizedWords.toLowerCase();
            setState(() {
              _localSpeechResult = result.recognizedWords;
              _statusMessage = 'Heard: "${result.recognizedWords}"';
            });

            // Check keywords in real-time
            final bool isConfirm = words.contains('confirm') ||
                                  words.contains('yes') ||
                                  words.contains('yeah') ||
                                  words.contains('ok') ||
                                  words.contains('submit') ||
                                  words.contains('approved');

            final bool isCancel = words.contains('cancel') ||
                                 words.contains('reject') ||
                                 words.contains('no') ||
                                 words.contains('try again') ||
                                 words.contains('reset');

            if (isConfirm || isCancel) {
              _cancelConfirmationRecording();
              _processVoiceConfirmation(isConfirm, isCancel);
            }
          },
          listenFor: const Duration(seconds: 15),
          pauseFor: const Duration(seconds: 3),
          listenOptions: stt.SpeechListenOptions(
            cancelOnError: false, // Keep listening on silence/errors
            partialResults: true,
          ),
        );
      } catch (e) {
        print('SpeechToText listen confirmation failed: $e');
      }
    }

    if (resetTimer) {
      _confirmationTimer?.cancel();
      // Stop listening and timeout after 15 seconds automatically
      _confirmationTimer = Timer(const Duration(seconds: 15), () async {
        if (_waitingForVoiceConfirmation) {
          if (_speechToText.isListening) {
            _explicitSpeechStop = true;
            await _speechToText.stop();
          }
          _pulseController.stop();
          _pulseController.reset();

          setState(() {
            _waitingForVoiceConfirmation = false;
            _isRecording = false;
            _statusMessage = 'Confirmation timed out. Submit manually.';
          });

          await _ttsService.speak('Confirmation timed out. Please tap confirm or cancel.');
          _startIdleVoiceTriggerListener();
        }
      });
    }
  }

  Future<void> _processVoiceConfirmation(bool isConfirm, bool isCancel) async {
    if (!mounted || !_waitingForVoiceConfirmation) return;

    _pulseController.stop();
    _pulseController.reset();

    if (_speechToText.isListening) {
      _explicitSpeechStop = true;
      await _speechToText.stop();
    }

    setState(() {
      _isRecording = false;
      _isProcessing = true;
      _statusMessage = 'Processing confirmation voice...';
    });

    try {
      if (isConfirm) {
        await _executeSubmitWorkOrder();
      } else if (isCancel) {
        setState(() {
          _waitingForVoiceConfirmation = false;
          _extractedData = null;
          _rawTranscript = null;
          _isProcessing = false;
          _statusMessage = 'Report rejected. Hold button to record again.';
        });
        await _ttsService.speak('Cancelled.');
        _startIdleVoiceTriggerListener();
      } else {
        setState(() {
          _isProcessing = false;
          _statusMessage = 'Did not recognize command. Try again...';
        });
        await _ttsService.speak('Sorry, I did not catch that. Please say confirm or cancel.');
      }
    } catch (e) {
      setState(() {
        _isProcessing = false;
        _statusMessage = 'Confirmation error: ${e.toString()}';
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Voice Confirmation failed: ${e.toString()}. Please tap buttons manually.')),
      );
    }
  }

  Future<void> _executeSubmitWorkOrder() async {
    final data = _extractedData;
    if (data == null) return;

    final parts = List<String>.from(data['parts_required'] ?? []);
    final audioStorageUrl = _currentAudioStorageUrl;

    setState(() {
      _isProcessing = true;
      _statusMessage = 'Submitting work order...';
    });

    try {
      await _apiService.createWorkOrder(
        equipmentId: AppConstants.getEquipmentUuid(data['equipment_id'] as String?),
        faultCode: data['fault_code'] ?? 'F-OTHER',
        severity: data['severity'] ?? 'MEDIUM',
        partsRequired: parts,
        rawTranscript: _rawTranscript!,
        confidenceScore: data['confidence_score'] ?? 0.75,
        exceptionFlag: data['exception_flag'] ?? false,
        audioStorageUrl: audioStorageUrl ?? '',
      );

      setState(() {
        _waitingForVoiceConfirmation = false;
        _extractedData = null;
        _rawTranscript = null;
        _isProcessing = false;
        _statusMessage = 'Work Order created successfully!';
      });

      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Work Order created successfully.')),
      );

      await _ttsService.speak('Work order confirmed and submitted.');
      _startIdleVoiceTriggerListener();
    } catch (e) {
      setState(() {
        _isProcessing = false;
        _statusMessage = 'Submission error: ${e.toString()}';
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Failed to submit work order: ${e.toString()}')),
      );
    }
  }

  Future<void> _manualSubmitWorkOrder(String audioStorageUrl) async {
    _cancelConfirmationRecording();
    await _ttsService.stop();
    _currentAudioStorageUrl = audioStorageUrl;
    await _executeSubmitWorkOrder();
  }

  // 2. Local Queueing (Offline Path)
  Future<void> _enqueueAudioOffline(String filePath) async {
    try {
      setState(() {
        _statusMessage = 'Saving report to offline database...';
      });

      // Strip out the hands-free trigger words from the transcript
      String cleanText = _localSpeechResult.trim();
      final lower = cleanText.toLowerCase();
      if (lower.endsWith('stop inspection')) {
        cleanText = cleanText.substring(0, cleanText.length - 'stop inspection'.length).trim();
      } else if (lower.endsWith('stop recording')) {
        cleanText = cleanText.substring(0, cleanText.length - 'stop recording'.length).trim();
      }

      // Save report in local SQLite queue
      await _dbService.enqueue(_activeMode, filePath, localTranscript: cleanText);
      await _refreshPendingCount();

      setState(() {
        _statusMessage = 'Saved offline. Will synchronize once network returns.';
      });

      await _ttsService.speak('Report saved offline. Rahul, I will upload it when connection is restored.');
      _startIdleVoiceTriggerListener();
    } catch (e) {
      setState(() {
        _statusMessage = 'Database queue failed: ${e.toString()}';
      });
      _startIdleVoiceTriggerListener();
    }
  }

  // 3. Queue Synchronizer Loop
  Future<void> _triggerQueueSync() async {
    if (_isSyncing || !_isOnline) return;

    final pending = await _dbService.getPending();
    if (pending.isEmpty) return;

    setState(() {
      _isSyncing = true;
    });

    int successCount = 0;
    for (var item in pending) {
      if (!_isOnline) break;

      try {
        await _dbService.updateStatus(item.id!, 'syncing');
        
        // Transcribe
        final stt = await _apiService.transcribeAudio(
          item.audioPath, 
          item.clientTxUuid,
          localTranscript: item.localTranscript,
        );
        final rawText = stt['text'] as String;
        final audioUrl = stt['file']['storage_path'] as String;

        if (item.actionType == 'inspection') {
          // Extract & create work order directly
          final extractedFields = await _apiService.extractStructuredData(rawText);
          final parts = List<String>.from(extractedFields['parts_required'] ?? []);
          
          // Satisfy DB constraints dynamically
          final eqTag = extractedFields['equipment_id'] as String?;
          final eqUuid = AppConstants.getEquipmentUuid(eqTag);

          await _apiService.createWorkOrder(
            equipmentId: eqUuid,
            faultCode: extractedFields['fault_code'] ?? 'F-OTHER',
            severity: extractedFields['severity'] ?? 'MEDIUM',
            partsRequired: parts,
            rawTranscript: rawText,
            confidenceScore: extractedFields['confidence_score'] ?? 0.70,
            exceptionFlag: extractedFields['exception_flag'] ?? false,
            audioStorageUrl: audioUrl,
          );
        } else {
          // Query and answer
          await _apiService.queryKnowledgeBase(rawText);
        }

        // Successfully synced: delete local cache copy
        await _dbService.deleteItem(item.id!);
        successCount++;
      } catch (e) {
        print('Queue Sync item ${item.id} failed: $e');
        await _dbService.incrementRetry(item.id!, e.toString());
      }
    }

    await _refreshPendingCount();
    setState(() {
      _isSyncing = false;
    });

    if (successCount > 0) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Synchronized $successCount reports to HQ dashboard.')),
      );
      await _ttsService.speak('Rahul, successfully synced $successCount pending reports.');
    }
  }

  Widget _buildSeverityBadge(String severity) {
    Color bgColor;
    Color textColor;
    IconData icon;

    switch (severity.toUpperCase()) {
      case 'CRITICAL':
        bgColor = Colors.red[50]!;
        textColor = Colors.red[800]!;
        icon = Icons.error;
        break;
      case 'HIGH':
        bgColor = Colors.orange[50]!;
        textColor = Colors.orange[800]!;
        icon = Icons.warning;
        break;
      case 'LOW':
        bgColor = Colors.green[50]!;
        textColor = Colors.green[800]!;
        icon = Icons.info;
        break;
      case 'MEDIUM':
      default:
        bgColor = Colors.blue[50]!;
        textColor = Colors.blue[800]!;
        icon = Icons.info_outline;
        break;
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: bgColor,
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: textColor.withOpacity(0.3)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: textColor),
          const SizedBox(width: 4),
          Text(
            severity.toUpperCase(),
            style: TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.bold,
              color: textColor,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildInspectionCard() {
    final data = _extractedData;
    if (data == null) return const SizedBox.shrink();
    final parts = List<String>.from(data['parts_required'] ?? []);

    return Card(
      margin: const EdgeInsets.all(16),
      elevation: 4,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      color: Colors.white,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text(
                  'INSPECTION REPORT PREVIEW',
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.bold,
                    color: Colors.blueGrey,
                    letterSpacing: 1.0,
                  ),
                ),
                // Severity Banner
                _buildSeverityBadge(data['severity'] ?? 'MEDIUM'),
              ],
            ),
            const Divider(height: 24),
            
            // Asset Tag
            Row(
              children: [
                const Icon(Icons.settings, size: 20, color: Colors.blueGrey),
                const SizedBox(width: 8),
                const Text(
                  'Equipment Tag: ',
                  style: TextStyle(fontSize: 13, color: Colors.blueGrey),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: Colors.blue[50],
                    border: Border.all(color: Colors.blue[300]!),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Text(
                    data['equipment_id'] ?? 'UNSPECIFIED',
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.bold,
                      color: Colors.blue[800],
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),

            // Fault Code
            Row(
              children: [
                const Icon(Icons.warning_amber_rounded, size: 20, color: Colors.orange),
                const SizedBox(width: 8),
                const Text(
                  'Fault: ',
                  style: TextStyle(fontSize: 13, color: Colors.blueGrey),
                ),
                Text(
                  data['fault_code'] ?? 'UNSPECIFIED',
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.bold,
                    color: Colors.black87,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),

            // Transcript
            if (_rawTranscript != null) ...[
              const Text(
                'Raw Transcript:',
                style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: Colors.blueGrey),
              ),
              const SizedBox(height: 4),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: Colors.blueGrey[50],
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: Colors.blueGrey[100]!),
                ),
                child: Text(
                  '"$_rawTranscript"',
                  style: TextStyle(
                    fontSize: 12,
                    fontStyle: FontStyle.italic,
                    color: Colors.blueGrey[800],
                  ),
                ),
              ),
              const SizedBox(height: 16),
            ],

            // Parts Required with checkbox ticks
            const Text(
              'Parts Required:',
              style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: Colors.blueGrey),
            ),
            const SizedBox(height: 6),
            if (parts.isEmpty)
              const Text(
                '• No replacement parts requested.',
                style: TextStyle(fontSize: 12, color: Colors.black54, fontStyle: FontStyle.italic),
              )
            else
              ...parts.map((part) => Padding(
                padding: const EdgeInsets.symmetric(vertical: 2),
                child: Row(
                  children: [
                    Icon(Icons.check_circle_outline, size: 16, color: Colors.green[700]),
                    const SizedBox(width: 8),
                    Text(
                      part,
                      style: const TextStyle(fontSize: 12, color: Colors.black87),
                    ),
                  ],
                ),
              )),

            const SizedBox(height: 20),

            // Glove-friendly direct action buttons
            Row(
              children: [
                Expanded(
                  child: ElevatedButton(
                    style: ElevatedButton.styleFrom(
                      backgroundColor: Colors.red[600],
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                    ),
                    onPressed: () {
                      setState(() {
                        _cancelConfirmationRecording();
                        _waitingForVoiceConfirmation = false;
                        _extractedData = null;
                        _rawTranscript = null;
                        _currentAudioStorageUrl = null;
                        _statusMessage = 'Report rejected. Hold button to record again.';
                      });
                      _ttsService.speak('Report cancelled.');
                      _startIdleVoiceTriggerListener();
                    },
                    child: const Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(Icons.cancel, size: 16),
                        SizedBox(width: 8),
                        Text('REJECT', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
                      ],
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: ElevatedButton(
                    style: ElevatedButton.styleFrom(
                      backgroundColor: Colors.green[700],
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                    ),
                    onPressed: () => _manualSubmitWorkOrder(_currentAudioStorageUrl!),
                    child: const Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(Icons.check_circle, size: 16),
                        SizedBox(width: 8),
                        Text('CONFIRM', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildQueryCard() {
    if (_ragResponse == null) return const SizedBox.shrink();

    return Card(
      margin: const EdgeInsets.all(16),
      elevation: 4,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      color: Colors.white,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Row(
              children: [
                Icon(Icons.menu_book, size: 18, color: Colors.blue),
                SizedBox(width: 8),
                Text(
                  'KNOWLEDGE BASE ANSWER',
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.bold,
                    color: Colors.blueGrey,
                    letterSpacing: 1.0,
                  ),
                ),
              ],
            ),
            const Divider(height: 24),
            if (_rawTranscript != null) ...[
              Text(
                'Your Question:',
                style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Colors.blueGrey[600]),
              ),
              const SizedBox(height: 4),
              Text(
                '"$_rawTranscript"',
                style: const TextStyle(fontSize: 13, fontStyle: FontStyle.italic, color: Colors.black87),
              ),
              const SizedBox(height: 16),
            ],
            Text(
              'Answer:',
              style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Colors.blue[800]),
            ),
            const SizedBox(height: 6),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Colors.blue[50]!.withOpacity(0.5),
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: Colors.blue[100]!),
              ),
              child: Text(
                _ragResponse!,
                style: const TextStyle(fontSize: 13, color: Colors.black87, height: 1.4),
              ),
            ),
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              child: OutlinedButton(
                style: OutlinedButton.styleFrom(
                  side: BorderSide(color: Colors.blue[600]!),
                  padding: const EdgeInsets.symmetric(vertical: 12),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                ),
                onPressed: () {
                  setState(() {
                    _ragResponse = null;
                    _rawTranscript = null;
                    _statusMessage = 'Ready. Hold button to speak again.';
                  });
                  _startIdleVoiceTriggerListener();
                },
                child: Text(
                  'DISMISS',
                  style: TextStyle(fontWeight: FontWeight.bold, color: Colors.blue[600]),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildMicArea({required bool compact}) {
    final bool canStart = !_isRecording && !_isProcessing && !_waitingForVoiceConfirmation && !_isStartingRecording;
    final bool canStop = _isRecording;

    return Container(
      margin: const EdgeInsets.all(16),
      width: double.infinity,
      height: compact ? 185 : null,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: _isRecording
            ? Colors.red[50]
            : (_isProcessing ? Colors.blue[50] : Colors.white),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: _isRecording
              ? Colors.red[300]!
              : (_isProcessing ? Colors.blue[300]! : Colors.blueGrey[200]!),
          width: 2.5,
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.05),
            blurRadius: 10,
            offset: const Offset(0, 4),
          )
        ],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          // Visual Indicator (Pulsing wave or progress loader or icons)
          if (_isRecording)
            SizedBox(
              height: compact ? 40 : 60,
              child: AnimatedBuilder(
                animation: _pulseController,
                builder: (context, child) {
                  return Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: List.generate(5, (index) {
                      // Create a custom sound-wave animation
                      double heightFactor = 0.2 + (0.8 * _pulseController.value);
                      if (index % 2 == 0) heightFactor = 1.0 - heightFactor;
                      return Container(
                        margin: const EdgeInsets.symmetric(horizontal: 3),
                        width: 4,
                        height: (compact ? 24 : 40) * heightFactor,
                        decoration: BoxDecoration(
                          color: Colors.red[600],
                          borderRadius: BorderRadius.circular(2),
                        ),
                      );
                    }),
                  );
                },
              ),
            )
          else if (_isProcessing)
            SizedBox(
              height: compact ? 40 : 60,
              width: compact ? 40 : 60,
              child: const CircularProgressIndicator(color: Colors.blue, strokeWidth: 3),
            )
          else if (_waitingForVoiceConfirmation)
            Icon(Icons.record_voice_over, size: compact ? 32 : 48, color: Colors.green[600])
          else
            Icon(Icons.mic_none, size: compact ? 32 : 48, color: Colors.blueGrey[600]),

          SizedBox(height: compact ? 10 : 16),

          // Status & Info Text
          Text(
            _isRecording
                ? 'INSPECTION IN PROGRESS'
                : (_isProcessing
                    ? 'PROCESSING SPEECH...'
                    : (_waitingForVoiceConfirmation
                        ? 'WAITING FOR CONFIRMATION'
                        : 'SYSTEM READY')),
            style: TextStyle(
              fontSize: compact ? 11 : 13,
              fontWeight: FontWeight.bold,
              color: _isRecording
                  ? Colors.red[700]
                  : (_isProcessing
                      ? Colors.blue[700]
                      : (_waitingForVoiceConfirmation ? Colors.green[700] : Colors.blueGrey[800])),
              letterSpacing: 1.0,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            _isRecording
                ? 'Speak inspection details. Say "Stop Inspection" or tap button.'
                : (_isProcessing
                    ? 'Transcribing and analyzing report...'
                    : (_waitingForVoiceConfirmation
                        ? 'Say "Confirm" or "Cancel", or tap buttons above.'
                        : 'Say "Start Inspection" or tap button below to begin.')),
            style: TextStyle(
              fontSize: compact ? 10 : 12,
              color: Colors.blueGrey[600],
            ),
            textAlign: TextAlign.center,
          ),

          SizedBox(height: compact ? 12 : 20),

          // Action Buttons: Start and Stop
          Row(
            children: [
              Expanded(
                child: ElevatedButton(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: Colors.green[600],
                    foregroundColor: Colors.white,
                    disabledBackgroundColor: Colors.green[100],
                    disabledForegroundColor: Colors.green[300],
                    padding: EdgeInsets.symmetric(vertical: compact ? 10 : 14),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                  ),
                  onPressed: canStart ? () => _startRecording() : null,
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.play_arrow, size: compact ? 16 : 20),
                      const SizedBox(width: 8),
                      Text(
                        'START',
                        style: TextStyle(
                          fontWeight: FontWeight.bold,
                          fontSize: compact ? 12 : 14,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: ElevatedButton(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: Colors.red[600],
                    foregroundColor: Colors.white,
                    disabledBackgroundColor: Colors.red[100],
                    disabledForegroundColor: Colors.red[300],
                    padding: EdgeInsets.symmetric(vertical: compact ? 10 : 14),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                  ),
                  onPressed: canStop ? () => _stopRecordingAndProcess() : null,
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.stop, size: compact ? 16 : 20),
                      const SizedBox(width: 8),
                      Text(
                        'STOP',
                        style: TextStyle(
                          fontWeight: FontWeight.bold,
                          fontSize: compact ? 12 : 14,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.blueGrey[50],
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 1,
        title: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(5),
              decoration: BoxDecoration(color: Colors.blue[600], borderRadius: BorderRadius.circular(4)),
              child: const Icon(Icons.bolt, size: 14, color: Colors.white),
            ),
            const SizedBox(width: 8),
            const Text(
              'FieldVoice Mobile',
              style: TextStyle(fontSize: 14, fontWeight: FontWeight.bold, color: Colors.black87),
            ),
          ],
        ),
        actions: [
          // Offline database queue sync indicator button
          Stack(
            alignment: Alignment.center,
            children: [
              IconButton(
                icon: const Icon(Icons.sync, color: Colors.blueGrey),
                onPressed: () {
                  Navigator.push(
                    context,
                    MaterialPageRoute(builder: (context) => const QueueScreen()),
                  ).then((_) => _refreshPendingCount());
                },
              ),
              if (_pendingCount > 0)
                Positioned(
                  right: 8,
                  top: 8,
                  child: Container(
                    padding: const EdgeInsets.all(2),
                    decoration: BoxDecoration(color: Colors.amber[600], borderRadius: BorderRadius.circular(10)),
                    constraints: const BoxConstraints(minWidth: 14, minHeight: 14),
                    child: Text(
                      '$_pendingCount',
                      style: const TextStyle(color: Colors.white, fontSize: 8, fontWeight: FontWeight.bold),
                      textAlign: TextAlign.center,
                    ),
                  ),
                ),
            ],
          ),
          
          // Speech recognition status pill
          Container(
            margin: const EdgeInsets.only(right: 8),
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
            decoration: BoxDecoration(
              color: _isSpeechListening ? Colors.purple[50] : Colors.grey[100],
              border: Border.all(color: _isSpeechListening ? Colors.purple[200]! : Colors.grey[300]!),
              borderRadius: BorderRadius.circular(4),
            ),
            child: Row(
              children: [
                Container(
                  width: 6,
                  height: 6,
                  decoration: BoxDecoration(
                    color: _isSpeechListening ? Colors.purple : Colors.grey,
                    shape: BoxShape.circle,
                  ),
                ),
                const SizedBox(width: 4),
                Text(
                  _isSpeechListening ? 'Mic Active' : 'Mic Off',
                  style: TextStyle(
                    fontSize: 9,
                    fontWeight: FontWeight.bold,
                    color: _isSpeechListening ? Colors.purple[800] : Colors.grey[600],
                  ),
                ),
              ],
            ),
          ),
          
          // Connection status pill
          Container(
            margin: const EdgeInsets.only(right: 12),
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
            decoration: BoxDecoration(
              color: _isOnline ? Colors.green[50] : Colors.amber[50],
              border: Border.all(color: _isOnline ? Colors.green[200]! : Colors.amber[200]!),
              borderRadius: BorderRadius.circular(4),
            ),
            child: Row(
              children: [
                Container(
                  width: 6,
                  height: 6,
                  decoration: BoxDecoration(
                    color: _isOnline ? Colors.green : Colors.amber,
                    shape: BoxShape.circle,
                  ),
                ),
                const SizedBox(width: 4),
                Text(
                  _isOnline ? 'Online' : 'Offline',
                  style: TextStyle(fontSize: 9, fontWeight: FontWeight.bold, color: _isOnline ? Colors.green[800] : Colors.amber[800]),
                ),
              ],
            ),
          ),
        ],
      ),
      body: Column(
        children: [
          // Large Segmented Mode Selector
          Container(
            color: Colors.white,
            padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 16),
            child: Container(
              padding: const EdgeInsets.all(4),
              decoration: BoxDecoration(
                color: Colors.blueGrey[100],
                borderRadius: BorderRadius.circular(12),
              ),
              child: Row(
                children: [
                  Expanded(
                    child: GestureDetector(
                      onTap: () {
                        setState(() {
                          _activeMode = 'inspection';
                        });
                      },
                      child: Container(
                        padding: const EdgeInsets.symmetric(vertical: 12),
                        decoration: BoxDecoration(
                          color: _activeMode == 'inspection' ? Colors.blue[600] : Colors.transparent,
                          borderRadius: BorderRadius.circular(8),
                          boxShadow: _activeMode == 'inspection' ? [
                            BoxShadow(
                              color: Colors.blue[600]!.withOpacity(0.3),
                              blurRadius: 4,
                              offset: const Offset(0, 2),
                            )
                          ] : null,
                        ),
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(
                              Icons.assignment_turned_in,
                              size: 16,
                              color: _activeMode == 'inspection' ? Colors.white : Colors.blueGrey[700],
                            ),
                            const SizedBox(width: 8),
                            Text(
                              'LOG INSPECTION',
                              style: TextStyle(
                                fontSize: 11,
                                fontWeight: FontWeight.bold,
                                color: _activeMode == 'inspection' ? Colors.white : Colors.blueGrey[700],
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 4),
                  Expanded(
                    child: GestureDetector(
                      onTap: () {
                        setState(() {
                          _activeMode = 'query';
                        });
                      },
                      child: Container(
                        padding: const EdgeInsets.symmetric(vertical: 12),
                        decoration: BoxDecoration(
                          color: _activeMode == 'query' ? Colors.blue[600] : Colors.transparent,
                          borderRadius: BorderRadius.circular(8),
                          boxShadow: _activeMode == 'query' ? [
                            BoxShadow(
                              color: Colors.blue[600]!.withOpacity(0.3),
                              blurRadius: 4,
                              offset: const Offset(0, 2),
                            )
                          ] : null,
                        ),
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(
                              Icons.menu_book,
                              size: 16,
                              color: _activeMode == 'query' ? Colors.white : Colors.blueGrey[700],
                            ),
                            const SizedBox(width: 8),
                            Text(
                              'ASK MANUALS RAG',
                              style: TextStyle(
                                fontSize: 11,
                                fontWeight: FontWeight.bold,
                                color: _activeMode == 'query' ? Colors.white : Colors.blueGrey[700],
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),

          // Offline Warn Banner
          if (!_isOnline)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              color: Colors.amber[800],
              child: Row(
                children: [
                  const Icon(Icons.wifi_off, color: Colors.white, size: 20),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      'OFFLINE MODE — $_pendingCount inspection${_pendingCount == 1 ? '' : 's'} queued in outbox.',
                      style: const TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.bold,
                        fontSize: 13,
                      ),
                    ),
                  ),
                  if (_pendingCount > 0)
                    ElevatedButton(
                      style: ElevatedButton.styleFrom(
                        backgroundColor: Colors.white,
                        foregroundColor: Colors.amber[900],
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                        minimumSize: Size.zero,
                        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                      ),
                      onPressed: () {
                        Navigator.push(
                          context,
                          MaterialPageRoute(builder: (context) => const QueueScreen()),
                        ).then((_) => _refreshPendingCount());
                      },
                      child: const Text('View Queue', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold)),
                    ),
                ],
              ),
            ),

          // Sync Status Banner
          if (_isSyncing)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              color: Colors.blue[600],
              child: const Row(
                children: [
                  SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(
                      color: Colors.white,
                      strokeWidth: 2,
                    ),
                  ),
                  SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      'Synchronizing offline reports with HQ...',
                      style: TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.bold,
                        fontSize: 13,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          
          // System Status message
          Container(
            width: double.infinity,
            color: Colors.blueGrey[100],
            padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 16),
            child: Text(
              _statusMessage,
              style: TextStyle(fontSize: 10, color: Colors.blueGrey[600], fontStyle: FontStyle.italic),
              textAlign: TextAlign.center,
            ),
          ),

          // Main body content (grows/shrinks based on whether we display results cards)
          if (_activeMode == 'inspection' && _extractedData != null) ...[
            Expanded(
              child: SingleChildScrollView(
                child: _buildInspectionCard(),
              ),
            ),
            _buildMicArea(compact: true),
          ] else if (_activeMode == 'query' && _ragResponse != null) ...[
            Expanded(
              child: SingleChildScrollView(
                child: _buildQueryCard(),
              ),
            ),
            _buildMicArea(compact: true),
          ] else ...[
            Expanded(
              child: _buildMicArea(compact: false),
            ),
          ],
        ],
      ),
    );
  }
}
