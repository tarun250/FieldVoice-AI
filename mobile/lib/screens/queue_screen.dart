// queue_screen.dart
import 'package:flutter/material.dart';
import '../models/queue_item.dart';
import '../services/database_service.dart';
import '../services/audio_service.dart';

class QueueScreen extends StatefulWidget {
  const QueueScreen({super.key});

  @override
  State<QueueScreen> createState() => _QueueScreenState();
}

class _QueueScreenState extends State<QueueScreen> {
  final DatabaseService _dbService = DatabaseService.instance;
  final AudioService _audioService = AudioService();
  List<QueueItem> _queueItems = [];
  bool _isLoading = true;
  int? _playingItemId;

  @override
  void initState() {
    super.initState();
    _loadQueue();
  }

  Future<void> _loadQueue() async {
    setState(() {
      _isLoading = true;
    });
    try {
      final items = await _dbService.getAllQueueItems();
      setState(() {
        _queueItems = items;
        _isLoading = false;
      });
    } catch (e) {
      setState(() {
        _isLoading = false;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Failed to load queue: $e')),
      );
    }
  }

  Future<void> _deleteItem(int id) async {
    try {
      await _dbService.deleteItem(id);
      _loadQueue();
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Item deleted successfully')),
      );
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Failed to delete item: $e')),
      );
    }
  }

  Future<void> _clearQueue() async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Clear Queue'),
        content: const Text('Are you sure you want to clear all items in the offline queue? This action cannot be undone.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: Colors.red[600], foregroundColor: Colors.white),
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Clear All'),
          ),
        ],
      ),
    );

    if (confirm == true) {
      try {
        await _dbService.clearQueue();
        _loadQueue();
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Queue cleared successfully')),
        );
      } catch (e) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to clear queue: $e')),
        );
      }
    }
  }

  Future<void> _toggleAudioPlay(QueueItem item) async {
    if (_playingItemId == item.id) {
      await _audioService.stopAudio();
      setState(() {
        _playingItemId = null;
      });
    } else {
      setState(() {
        _playingItemId = item.id;
      });
      try {
        await _audioService.playAudio(item.audioPath);
      } catch (e) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Playback error: $e')),
        );
      } finally {
        setState(() {
          _playingItemId = null;
        });
      }
    }
  }

  Color _getStatusColor(String status) {
    switch (status) {
      case 'pending':
        return Colors.amber[600]!;
      case 'syncing':
        return Colors.blue[600]!;
      case 'failed':
        return Colors.orange[600]!;
      case 'failed_permanently':
        return Colors.red[600]!;
      default:
        return Colors.blueGrey[600]!;
    }
  }

  IconData _getStatusIcon(String status) {
    switch (status) {
      case 'pending':
        return Icons.hourglass_empty;
      case 'syncing':
        return Icons.sync;
      case 'failed':
        return Icons.warning_amber_rounded;
      case 'failed_permanently':
        return Icons.error_outline_rounded;
      default:
        return Icons.help_outline;
    }
  }

  @override
  void dispose() {
    _audioService.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.blueGrey[50],
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 1,
        title: const Text(
          'Offline Outbox Queue',
          style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: Colors.black87),
        ),
        actions: [
          if (_queueItems.isNotEmpty)
            IconButton(
              icon: const Icon(Icons.delete_sweep, color: Colors.redAccent),
              tooltip: 'Clear Queue',
              onPressed: _clearQueue,
            ),
          IconButton(
            icon: const Icon(Icons.refresh, color: Colors.blueGrey),
            tooltip: 'Refresh Queue',
            onPressed: _loadQueue,
          ),
        ],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : _queueItems.isEmpty
              ? Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.mark_email_read_outlined, size: 64, color: Colors.blueGrey[300]),
                      const SizedBox(height: 16),
                      Text(
                        'Outbox is empty',
                        style: TextStyle(fontSize: 14, fontWeight: FontWeight.bold, color: Colors.blueGrey[700]),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        'All recorded voice notes successfully synchronized.',
                        style: TextStyle(fontSize: 12, color: Colors.blueGrey[500]),
                        textAlign: TextAlign.center,
                      ),
                    ],
                  ),
                )
              : ListView.builder(
                  padding: const EdgeInsets.all(16),
                  itemCount: _queueItems.length,
                  itemBuilder: (context, index) {
                    final item = _queueItems[index];
                    final isPlaying = _playingItemId == item.id;
                    final statusColor = _getStatusColor(item.status);
                    final formattedTime = DateTime.parse(item.timestamp).toLocal().toString().substring(0, 19);

                    return Card(
                      color: Colors.white,
                      elevation: 0,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(8),
                        side: BorderSide(color: Colors.blueGrey[200]!, width: 1),
                      ),
                      margin: const EdgeInsets.only(bottom: 12),
                      child: Padding(
                        padding: const EdgeInsets.all(12),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                // Action Mode tag
                                Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                  decoration: BoxDecoration(
                                    color: Colors.blueGrey[100],
                                    borderRadius: BorderRadius.circular(4),
                                  ),
                                  child: Text(
                                    item.actionType.toUpperCase(),
                                    style: TextStyle(
                                      fontSize: 9,
                                      fontWeight: FontWeight.bold,
                                      color: Colors.blueGrey[700],
                                    ),
                                  ),
                                ),
                                // Status Pill
                                Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                  decoration: BoxDecoration(
                                    color: statusColor.withOpacity(0.1),
                                    borderRadius: BorderRadius.circular(4),
                                    border: Border.all(color: statusColor.withOpacity(0.3)),
                                  ),
                                  child: Row(
                                    children: [
                                      Icon(_getStatusIcon(item.status), size: 10, color: statusColor),
                                      const SizedBox(width: 4),
                                      Text(
                                        item.status.toUpperCase(),
                                        style: TextStyle(
                                          fontSize: 9,
                                          fontWeight: FontWeight.bold,
                                          color: statusColor,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 10),
                            // ID and Time details
                            Text(
                              'Tx ID: ${item.clientTxUuid}',
                              style: TextStyle(fontSize: 10, fontFamily: 'monospace', color: Colors.blueGrey[600]),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              'Created: $formattedTime',
                              style: TextStyle(fontSize: 10, color: Colors.blueGrey[500]),
                            ),
                            if (item.retryCount > 0) ...[
                              const SizedBox(height: 4),
                              Text(
                                'Retry Count: ${item.retryCount} / 5',
                                style: TextStyle(fontSize: 10, color: Colors.orange[800], fontWeight: FontWeight.bold),
                              ),
                            ],
                            if (item.errorMessage != null) ...[
                              const SizedBox(height: 8),
                              Container(
                                width: double.infinity,
                                padding: const EdgeInsets.all(8),
                                decoration: BoxDecoration(
                                  color: Colors.red[50],
                                  borderRadius: BorderRadius.circular(4),
                                  border: Border.all(color: Colors.red[100]!),
                                ),
                                child: Text(
                                  item.errorMessage!,
                                  style: TextStyle(fontSize: 9, color: Colors.red[850], fontFamily: 'monospace'),
                                ),
                              ),
                            ],
                            const Divider(height: 20, thickness: 0.5),
                            // Action controls
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                // Play Audio Button
                                TextButton.icon(
                                  style: TextButton.styleFrom(
                                    foregroundColor: Colors.blue[700],
                                    padding: EdgeInsets.zero,
                                    minimumSize: const Size(50, 30),
                                    tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                                  ),
                                  icon: Icon(isPlaying ? Icons.stop_circle : Icons.play_circle, size: 16),
                                  label: Text(
                                    isPlaying ? 'Stop Voice Note' : 'Listen Voice Note',
                                    style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold),
                                  ),
                                  onPressed: () => _toggleAudioPlay(item),
                                ),
                                // Delete Action Button
                                if (item.id != null)
                                  IconButton(
                                    icon: const Icon(Icons.delete_outline, color: Colors.redAccent, size: 18),
                                    padding: EdgeInsets.zero,
                                    constraints: const BoxConstraints(),
                                    tooltip: 'Delete Item',
                                    onPressed: () => _deleteItem(item.id!),
                                  ),
                              ],
                            ),
                          ],
                        ),
                      ),
                    );
                  },
                ),
    );
  }
}
