// database_service.dart
import 'package:path/path.dart';
import 'package:sqflite/sqflite.dart';
import 'package:uuid/uuid.dart';
import '../models/queue_item.dart';

class DatabaseService {
  static final DatabaseService instance = DatabaseService._init();
  static Database? _database;

  DatabaseService._init();

  Future<Database> get database async {
    if (_database != null) return _database!;
    _database = await _initDB('local_queue.db');
    return _database!;
  }

  Future<Database> _initDB(String filePath) async {
    final dbPath = await getDatabasesPath();
    final path = join(dbPath, filePath);

    return await openDatabase(
      path,
      version: 2,
      onCreate: _createDB,
      onUpgrade: (db, oldVersion, newVersion) async {
        if (oldVersion < 2) {
          await db.execute('ALTER TABLE pending_queue ADD COLUMN local_transcript TEXT');
        }
      },
    );
  }

  Future<void> _createDB(Database db, int version) async {
    await db.execute('''
      CREATE TABLE pending_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_tx_uuid TEXT UNIQUE NOT NULL,
        timestamp TEXT NOT NULL,
        audio_path TEXT NOT NULL,
        action_type TEXT NOT NULL,
        status TEXT NOT NULL,
        retry_count INTEGER NOT NULL DEFAULT 0,
        error_message TEXT,
        local_transcript TEXT
      )
    ''');
  }

  // Enqueue a new action
  Future<QueueItem> enqueue(String actionType, String audioPath, {String? localTranscript}) async {
    final db = await database;
    final uuid = const Uuid().v4();
    final item = QueueItem(
      clientTxUuid: uuid,
      timestamp: DateTime.now().toUtc().toIso8601String(),
      audioPath: audioPath,
      actionType: actionType,
      localTranscript: localTranscript,
    );

    final id = await db.insert('pending_queue', item.toMap());
    return item.copyWith(id: id);
  }

  // Get all pending/failed items chronologically
  Future<List<QueueItem>> getPending() async {
    final db = await database;
    final result = await db.query(
      'pending_queue',
      where: 'status = ? OR status = ?',
      whereArgs: ['pending', 'failed'],
      orderBy: 'timestamp ASC',
    );

    return result.map((json) => QueueItem.fromMap(json)).toList();
  }

  // Get all items (for sync dashboard feed auditing)
  Future<List<QueueItem>> getAllQueueItems() async {
    final db = await database;
    final result = await db.query('pending_queue', orderBy: 'timestamp DESC');
    return result.map((json) => QueueItem.fromMap(json)).toList();
  }

  // Update item status
  Future<int> updateStatus(int id, String status, {String? errorMessage}) async {
    final db = await database;
    return await db.update(
      'pending_queue',
      {
        'status': status,
        'error_message': errorMessage,
      },
      where: 'id = ?',
      whereArgs: [id],
    );
  }

  // Increment retry count
  Future<int> incrementRetry(int id, String errorMessage) async {
    final db = await database;
    final maps = await db.query('pending_queue', columns: ['retry_count'], where: 'id = ?', whereArgs: [id]);
    if (maps.isEmpty) return 0;
    
    int currentRetries = maps.first['retry_count'] as int;
    int nextRetries = currentRetries + 1;
    String status = nextRetries >= 5 ? 'failed_permanently' : 'failed';

    return await db.update(
      'pending_queue',
      {
        'retry_count': nextRetries,
        'status': status,
        'error_message': errorMessage,
      },
      where: 'id = ?',
      whereArgs: [id],
    );
  }

  // Delete item from queue (called upon successful upload sync)
  Future<int> deleteItem(int id) async {
    final db = await database;
    return await db.delete(
      'pending_queue',
      where: 'id = ?',
      whereArgs: [id],
    );
  }

  // Clear completed/successful items if any persist
  Future<int> clearQueue() async {
    final db = await database;
    return await db.delete('pending_queue');
  }

  Future<void> close() async {
    final db = await database;
    db.close();
  }
}
