// queue_item.dart
class QueueItem {
  final int? id;
  final String clientTxUuid;
  final String timestamp;
  final String audioPath;
  final String actionType; // 'inspection' or 'query'
  final String status;     // 'pending', 'syncing', 'failed', 'failed_permanently'
  final int retryCount;
  final String? errorMessage;
  final String? localTranscript;

  QueueItem({
    this.id,
    required this.clientTxUuid,
    required this.timestamp,
    required this.audioPath,
    required this.actionType,
    this.status = 'pending',
    this.retryCount = 0,
    this.errorMessage,
    this.localTranscript,
  });

  // Map representation for SQLite insert/update
  Map<String, dynamic> toMap() {
    return {
      if (id != null) 'id': id,
      'client_tx_uuid': clientTxUuid,
      'timestamp': timestamp,
      'audio_path': audioPath,
      'action_type': actionType,
      'status': status,
      'retry_count': retryCount,
      'error_message': errorMessage,
      'local_transcript': localTranscript,
    };
  }

  // Create QueueItem from SQLite row
  factory QueueItem.fromMap(Map<String, dynamic> map) {
    return QueueItem(
      id: map['id'] as int?,
      clientTxUuid: map['client_tx_uuid'] as String,
      timestamp: map['timestamp'] as String,
      audioPath: map['audio_path'] as String,
      actionType: map['action_type'] as String,
      status: map['status'] as String,
      retryCount: map['retry_count'] as int,
      errorMessage: map['error_message'] as String?,
      localTranscript: map['local_transcript'] as String?,
    );
  }

  QueueItem copyWith({
    int? id,
    String? clientTxUuid,
    String? timestamp,
    String? audioPath,
    String? actionType,
    String? status,
    int? retryCount,
    String? errorMessage,
    String? localTranscript,
  }) {
    return QueueItem(
      id: id ?? this.id,
      clientTxUuid: clientTxUuid ?? this.clientTxUuid,
      timestamp: timestamp ?? this.timestamp,
      audioPath: audioPath ?? this.audioPath,
      actionType: actionType ?? this.actionType,
      status: status ?? this.status,
      retryCount: retryCount ?? this.retryCount,
      errorMessage: errorMessage ?? this.errorMessage,
      localTranscript: localTranscript ?? this.localTranscript,
    );
  }
}
