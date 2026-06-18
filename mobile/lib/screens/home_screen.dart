// home_screen.dart
import 'dart:async';
import 'package:flutter/material.dart';
import 'package:connectivity_plus/connectivity_plus.dart';
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
    
    _pulseController = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 1),
    );

    _ttsService.onCompletion = () {
      _onTtsCompleted();
    };
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
    _cancelConfirmationRecording();
    await _ttsService.stop(); // Stop any reading voice
    final path = await _audioService.startRecording();
    if (path != null) {
      setState(() {
        _waitingForVoiceConfirmation = false;
        _isRecording = true;
        _recordedFilePath = path;
        _statusMessage = 'Recording audio... Speak clearly.';
        _rawTranscript = null;
        _extractedData = null;
        _ragResponse = null;
        _currentAudioStorageUrl = null;
      });
      _pulseController.repeat(reverse: true);
    }
  }

  Future<void> _stopRecordingAndProcess() async {
    if (!_isRecording) return;
    
    _pulseController.stop();
    _pulseController.reset();
    
    final path = await _audioService.stopRecording();
    setState(() {
      _isRecording = false;
    });

    if (path != null) {
      _recordedFilePath = path;
      if (_isOnline) {
        _processAudioLive(path);
      } else {
        _enqueueAudioOffline(path);
      }
    }
  }

  // 1. Live Processing Loop (Online Path)
  Future<void> _processAudioLive(String filePath) async {
    setState(() {
      _isProcessing = true;
      _statusMessage = 'Processing audio... Transcribing...';
    });

    try {
      // Step A: Transcribe audio
      final sttResult = await _apiService.transcribeAudio(filePath, 'live-tx-${DateTime.now().millisecondsSinceEpoch}');
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
      }
    } catch (e) {
      setState(() {
        _isProcessing = false;
        _statusMessage = 'Error: ${e.toString()}';
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Processing Failed: ${e.toString()}')),
      );
    }
  }

  // Hands-free voice confirmation completion handler
  void _onTtsCompleted() {
    if (_waitingForVoiceConfirmation) {
      _startVoiceConfirmationListener();
    }
  }

  void _cancelConfirmationRecording() {
    _confirmationTimer?.cancel();
    _confirmationTimer = null;
  }

  Future<void> _startVoiceConfirmationListener() async {
    if (!mounted || !_waitingForVoiceConfirmation) return;
    
    // Stop any active recording first
    if (_isRecording) {
      await _audioService.stopRecording();
    }
    
    setState(() {
      _statusMessage = 'Listening for confirmation...';
      _isRecording = true;
    });

    final path = await _audioService.startRecording();
    if (path == null) {
      setState(() {
        _isRecording = false;
        _statusMessage = 'Microphone error during confirmation.';
      });
      return;
    }

    _recordedFilePath = path;
    _pulseController.repeat(reverse: true);

    // Stop recording after 3 seconds automatically
    _confirmationTimer = Timer(const Duration(seconds: 3), () async {
      await _stopRecordingAndProcessConfirmation(path);
    });
  }

  Future<void> _stopRecordingAndProcessConfirmation(String path) async {
    if (!mounted || !_waitingForVoiceConfirmation) return;

    _pulseController.stop();
    _pulseController.reset();

    final stopPath = await _audioService.stopRecording();
    setState(() {
      _isRecording = false;
      _isProcessing = true;
      _statusMessage = 'Processing confirmation voice...';
    });

    try {
      final finalPath = stopPath ?? path;
      final sttResult = await _apiService.transcribeAudio(
        finalPath,
        'confirm-tx-${DateTime.now().millisecondsSinceEpoch}',
      );
      final transcriptText = (sttResult['text'] as String).toLowerCase().trim();
      
      print('Confirmation Transcript: "$transcriptText"');

      // Check keywords
      final bool isConfirm = transcriptText.contains('confirm') ||
                            transcriptText.contains('yes') ||
                            transcriptText.contains('yeah') ||
                            transcriptText.contains('ok') ||
                            transcriptText.contains('submit') ||
                            transcriptText.contains('approved');

      final bool isCancel = transcriptText.contains('cancel') ||
                           transcriptText.contains('reject') ||
                           transcriptText.contains('no') ||
                           transcriptText.contains('record') ||
                           transcriptText.contains('try again') ||
                           transcriptText.contains('reset');

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
      } else {
        // Did not understand
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

      // Save report in local SQLite queue
      await _dbService.enqueue(_activeMode, filePath);
      await _refreshPendingCount();

      setState(() {
        _statusMessage = 'Saved offline. Will synchronize once network returns.';
      });

      await _ttsService.speak('Report saved offline. Rahul, I will upload it when connection is restored.');
    } catch (e) {
      setState(() {
        _statusMessage = 'Database queue failed: ${e.toString()}';
      });
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
        final stt = await _apiService.transcribeAudio(item.audioPath, item.clientTxUuid);
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
    return GestureDetector(
      onLongPressStart: (_) => _startRecording(),
      onLongPressEnd: (_) => _stopRecordingAndProcess(),
      child: Container(
        margin: const EdgeInsets.all(16),
        width: double.infinity,
        height: compact ? 185 : null, // Fix height if compact, else let it fill the space
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
        child: Stack(
          alignment: Alignment.center,
          children: [
            if (_isRecording)
              AnimatedBuilder(
                animation: _pulseController,
                builder: (context, child) {
                  return Stack(
                    alignment: Alignment.center,
                    children: [
                      Container(
                        width: (compact ? 120 : 180) + (_pulseController.value * (compact ? 30 : 50)),
                        height: (compact ? 120 : 180) + (_pulseController.value * (compact ? 30 : 50)),
                        decoration: BoxDecoration(
                          color: Colors.red.withOpacity(0.08 * (1.0 - _pulseController.value)),
                          shape: BoxShape.circle,
                        ),
                      ),
                      Container(
                        width: (compact ? 90 : 130) + (_pulseController.value * (compact ? 20 : 35)),
                        height: (compact ? 90 : 130) + (_pulseController.value * (compact ? 20 : 35)),
                        decoration: BoxDecoration(
                          color: Colors.red.withOpacity(0.12 * (1.0 - _pulseController.value)),
                          shape: BoxShape.circle,
                        ),
                      ),
                    ],
                  );
                },
              ),
            Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Container(
                  width: compact ? 64 : 90,
                  height: compact ? 64 : 90,
                  decoration: BoxDecoration(
                    color: _isRecording
                        ? Colors.red[600]
                        : (_isProcessing ? Colors.blue[600] : Colors.blueGrey[800]),
                    shape: BoxShape.circle,
                    boxShadow: [
                      BoxShadow(
                        color: (_isRecording
                                ? Colors.red[600]
                                : (_isProcessing ? Colors.blue[600] : Colors.blueGrey[800]))!
                            .withOpacity(0.3),
                        blurRadius: 8,
                        offset: const Offset(0, 3),
                      )
                    ],
                  ),
                  child: _isProcessing
                      ? Padding(
                          padding: EdgeInsets.all(compact ? 18.0 : 24.0),
                          child: const CircularProgressIndicator(color: Colors.white, strokeWidth: 3),
                        )
                      : Icon(
                          _isRecording ? Icons.mic : Icons.mic_none,
                          size: compact ? 32 : 44,
                          color: Colors.white,
                        ),
                ),
                SizedBox(height: compact ? 12 : 20),
                Text(
                  _isRecording
                      ? 'RELEASE TO SEND'
                      : (_isProcessing ? 'PROCESSING SPEECH...' : 'HOLD ANYWHERE HERE TO SPEAK'),
                  style: TextStyle(
                    fontSize: compact ? 12 : 16,
                    fontWeight: FontWeight.bold,
                    color: _isRecording
                        ? Colors.red[700]
                        : (_isProcessing ? Colors.blue[700] : Colors.blueGrey[800]),
                    letterSpacing: 0.5,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  _isRecording
                      ? 'Listening...'
                      : (_waitingForVoiceConfirmation
                          ? 'Say "Confirm" or "Cancel"'
                          : 'Tap & Hold down to record voice input'),
                  style: TextStyle(
                    fontSize: compact ? 10 : 12,
                    color: _isRecording ? Colors.red[400] : Colors.blueGrey[500],
                  ),
                ),
                if (_waitingForVoiceConfirmation && !_isRecording && !_isProcessing) ...[
                  const SizedBox(height: 12),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
                    decoration: BoxDecoration(
                      color: Colors.green[50],
                      border: Border.all(color: Colors.green[200]!),
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(Icons.record_voice_over, size: 14, color: Colors.green),
                        const SizedBox(width: 8),
                        Text(
                          'SPEAK "CONFIRM" OR "CANCEL"',
                          style: TextStyle(
                            fontSize: 10,
                            fontWeight: FontWeight.bold,
                            color: Colors.green[700],
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ],
            ),
          ],
        ),
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
