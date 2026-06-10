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
  // ignore: unused_field
  String? _recordedFilePath;
  bool _isProcessing = false;
  String _statusMessage = 'System ready. Select mode and hold button to speak.';
  
  // Console log outputs
  String? _rawTranscript;
  Map<String, dynamic>? _extractedData;
  String? _ragResponse;

  // Animation controller for mic record pulse waves
  late AnimationController _pulseController;

  @override
  void initState() {
    super.initState();
    _initConnectivity();
    _initDatabase();
    
    _pulseController = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 1),
    );
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
    super.dispose();
  }

  // Handle Recording Trigger
  Future<void> _startRecording() async {
    await _ttsService.stop(); // Stop any reading voice
    final path = await _audioService.startRecording();
    if (path != null) {
      setState(() {
        _isRecording = true;
        _recordedFilePath = path;
        _statusMessage = 'Recording audio... Speak clearly.';
        _rawTranscript = null;
        _extractedData = null;
        _ragResponse = null;
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
          _isProcessing = false;
          _statusMessage = 'Ready. Verify details in bottom panel.';
        });

        // Trigger TTS read back confirmation to Rahul
        final parts = List<String>.from(extractResult['parts_required'] ?? []);
        await _ttsService.speakInspectionConfirmation(
          equipmentId: extractResult['equipment_id'] ?? 'Unspecified machine',
          faultCode: extractResult['fault_code'] ?? 'Unspecified fault',
          severity: extractResult['severity'] ?? 'MEDIUM',
          parts: parts,
        );

        // Show review bottom sheet
        _showReviewBottomSheet(sttResult['file']['storage_path']);
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

  // Review & Submit Bottom Sheet Modal
  void _showReviewBottomSheet(String audioStorageUrl) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (context) {
        final data = _extractedData;
        if (data == null) return const SizedBox.shrink();
        
        final parts = List<String>.from(data['parts_required'] ?? []);

        return Padding(
          padding: EdgeInsets.only(
            left: 20, 
            right: 20, 
            top: 20, 
            bottom: MediaQuery.of(context).viewInsets.bottom + 30
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text(
                    'VERIFY INSPECTION REPORT',
                    style: TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: Colors.blueAccent),
                  ),
                  IconButton(
                    icon: const Icon(Icons.close, size: 20),
                    onPressed: () => Navigator.pop(context),
                  )
                ],
              ),
              const SizedBox(height: 10),
              
              // Raw Transcript Box
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: Colors.blueGrey[50],
                  border: Border.all(color: Colors.blueGrey[200]!),
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Text(
                  '"$_rawTranscript"',
                  style: TextStyle(fontSize: 12, fontStyle: FontStyle.italic, color: Colors.blueGrey[600]),
                ),
              ),
              const SizedBox(height: 16),

              // Parsed Parameters
              _buildReviewRow('Asset ID Tag', data['equipment_id'] ?? 'UNSPECIFIED'),
              _buildReviewRow('Detected Fault', data['fault_code'] ?? 'UNSPECIFIED'),
              _buildReviewRow('Severity Level', data['severity'] ?? 'MEDIUM'),
              _buildReviewRow('Parts Required', parts.isEmpty ? 'None' : parts.join(', ')),
              _buildReviewRow('Confidence', '${((data['confidence_score'] ?? 0.7) * 100).round()}%'),

              const SizedBox(height: 20),

              // Confirm and Submit button
              ElevatedButton(
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.blue[600],
                  foregroundColor: Colors.white,
                  minimumSize: const Size.fromHeight(48),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(6)),
                ),
                onPressed: () async {
                  Navigator.pop(context);
                  setState(() {
                    _isProcessing = true;
                    _statusMessage = 'Submitting work order to database...';
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
                      audioStorageUrl: audioStorageUrl,
                    );
                    setState(() {
                      _isProcessing = false;
                      _statusMessage = 'Work Order created successfully!';
                    });
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(content: Text('Work Order created successfully.')),
                    );
                  } catch (e) {
                    setState(() {
                      _isProcessing = false;
                      _statusMessage = 'Submission error: ${e.toString()}';
                    });
                  }
                },
                child: const Text('Confirm & Create Work Order', style: TextStyle(fontWeight: FontWeight.bold)),
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildReviewRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: Colors.blueGrey[600])),
          Text(value, style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Colors.blueGrey[800])),
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
          // App Mode Selector Bar
          Container(
            color: Colors.white,
            padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 16),
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
                      padding: const EdgeInsets.symmetric(vertical: 8),
                      decoration: BoxDecoration(
                        color: _activeMode == 'inspection' ? Colors.blue[50] : Colors.transparent,
                        borderRadius: BorderRadius.circular(4),
                        border: Border.all(color: _activeMode == 'inspection' ? Colors.blue[200]! : Colors.transparent),
                      ),
                      child: Center(
                        child: Text(
                          'LOG INSPECTION',
                          style: TextStyle(
                            fontSize: 10, 
                            fontWeight: FontWeight.bold, 
                            color: _activeMode == 'inspection' ? Colors.blue[700] : Colors.blueGrey
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: GestureDetector(
                    onTap: () {
                      setState(() {
                        _activeMode = 'query';
                      });
                    },
                    child: Container(
                      padding: const EdgeInsets.symmetric(vertical: 8),
                      decoration: BoxDecoration(
                        color: _activeMode == 'query' ? Colors.blue[50] : Colors.transparent,
                        borderRadius: BorderRadius.circular(4),
                        border: Border.all(color: _activeMode == 'query' ? Colors.blue[200]! : Colors.transparent),
                      ),
                      child: Center(
                        child: Text(
                          'ASK MANUALS RAG',
                          style: TextStyle(
                            fontSize: 10, 
                            fontWeight: FontWeight.bold, 
                            color: _activeMode == 'query' ? Colors.blue[700] : Colors.blueGrey
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
          
          // Status banner
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

          // Central recording visualizer & PTT trigger
          Expanded(
            child: Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  // Pulsing wave circles
                  AnimatedBuilder(
                    animation: _pulseController,
                    builder: (context, child) {
                      return Stack(
                        alignment: Alignment.center,
                        children: [
                          Container(
                            width: 140 + (_pulseController.value * 30),
                            height: 140 + (_pulseController.value * 30),
                            decoration: BoxDecoration(
                              color: Colors.blue.withOpacity(0.08 * (1.0 - _pulseController.value)),
                              shape: BoxShape.circle,
                            ),
                          ),
                          Container(
                            width: 100 + (_pulseController.value * 20),
                            height: 100 + (_pulseController.value * 20),
                            decoration: BoxDecoration(
                              color: Colors.blue.withOpacity(0.12 * (1.0 - _pulseController.value)),
                              shape: BoxShape.circle,
                            ),
                          ),
                          GestureDetector(
                            onLongPressStart: (_) => _startRecording(),
                            onLongPressEnd: (_) => _stopRecordingAndProcess(),
                            child: CircleAvatar(
                              radius: 36,
                              backgroundColor: _isRecording ? Colors.red[600] : Colors.blue[600],
                              child: _isProcessing 
                                ? const CircularProgressIndicator(color: Colors.white)
                                : Icon(_isRecording ? Icons.mic : Icons.mic_none, size: 28, color: Colors.white),
                            ),
                          ),
                        ],
                      );
                    },
                  ),
                  const SizedBox(height: 20),
                  Text(
                    _isRecording ? 'RELEASE BUTTON TO PROCESS' : 'HOLD MIC BUTTON TO SPEAK',
                    style: TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: Colors.blueGrey[600], letterSpacing: 0.5),
                  ),
                  const SizedBox(height: 5),
                  Text(
                    'Active User: ${AppConstants.workerName}',
                    style: TextStyle(fontSize: 9, fontWeight: FontWeight.w600, color: Colors.blueGrey[400]),
                  ),
                ],
              ),
            ),
          ),

          // Technical logging terminal console output
          if (_rawTranscript != null || _extractedData != null || _ragResponse != null)
            Container(
              margin: const EdgeInsets.all(16),
              width: double.infinity,
              decoration: BoxDecoration(
                color: Colors.blueGrey[900],
                borderRadius: BorderRadius.circular(6),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Console header
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                    decoration: const BoxDecoration(
                      color: Color(0xFF1E293B),
                      borderRadius: BorderRadius.vertical(top: Radius.circular(6)),
                    ),
                    child: const Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Row(
                          children: [
                            Icon(Icons.terminal, size: 12, color: Colors.greenAccent),
                            SizedBox(width: 6),
                            Text('Voice Telemetry Output', style: TextStyle(color: Colors.blueGrey, fontSize: 10, fontFamily: 'monospace')),
                          ],
                        ),
                        Text('OK', style: TextStyle(color: Colors.greenAccent, fontSize: 8, fontWeight: FontWeight.bold)),
                      ],
                    ),
                  ),

                  // Console Body
                  Padding(
                    padding: const EdgeInsets.all(12),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        if (_rawTranscript != null) ...[
                          const Text('>> RAW TRANSCRIPT:', style: TextStyle(color: Colors.blueAccent, fontSize: 9, fontFamily: 'monospace')),
                          Text('"$_rawTranscript"', style: const TextStyle(color: Colors.white70, fontSize: 11, fontFamily: 'monospace')),
                          const SizedBox(height: 10),
                        ],
                        if (_extractedData != null) ...[
                          const Text('>> STRUCT DATA EXTRACTED:', style: TextStyle(color: Colors.blueAccent, fontSize: 9, fontFamily: 'monospace')),
                          Text(
                            'Asset: ${_extractedData!['equipment_id']}\n'
                            'Fault: ${_extractedData!['fault_code']}\n'
                            'Severity: ${_extractedData!['severity']}\n'
                            'Confidence: ${((_extractedData!['confidence_score'] ?? 0.7) * 100).round()}%',
                            style: const TextStyle(color: Colors.greenAccent, fontSize: 11, fontFamily: 'monospace'),
                          ),
                        ],
                        if (_ragResponse != null) ...[
                          const Text('>> RAG MANUAL RESPONSE:', style: TextStyle(color: Colors.blueAccent, fontSize: 9, fontFamily: 'monospace')),
                          Text('$_ragResponse', style: const TextStyle(color: Colors.greenAccent, fontSize: 11, fontFamily: 'monospace')),
                        ],
                      ],
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}
