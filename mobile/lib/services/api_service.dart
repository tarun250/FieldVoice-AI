// api_service.dart
import 'package:dio/dio.dart';
import '../config/constants.dart';

class ApiService {
  final Dio _dio;

  ApiService()
      : _dio = Dio(
          BaseOptions(
            baseUrl: AppConstants.backendUrl,
            connectTimeout: const Duration(seconds: 15),
            receiveTimeout: const Duration(seconds: 15),
          ),
        ) {
    // Add debugging log intercepts
    _dio.interceptors.add(LogInterceptor(
      requestBody: true,
      responseBody: true,
      logPrint: (obj) => print('API_CLIENT: $obj'),
    ));
  }

  // 1. Upload audio file and receive Whisper text transcription
  Future<Map<String, dynamic>> transcribeAudio(String localFilePath, String clientTxUuid) async {
    try {
      final fileName = localFilePath.split('/').last;
      
      final formData = FormData.fromMap({
        'audio': await MultipartFile.fromFile(
          localFilePath, 
          filename: fileName
        ),
        'client_tx_uuid': clientTxUuid,
        'timestamp': DateTime.now().toUtc().toIso8601String(),
      });

      final response = await _dio.post(
        '/api/audio/transcribe',
        data: formData,
      );

      if (response.statusCode == 200 || response.statusCode == 201) {
        return response.data as Map<String, dynamic>;
      } else {
        throw Exception('Transcription status error: ${response.statusCode}');
      }
    } on DioException catch (e) {
      throw Exception('Network upload failed: ${e.message}');
    }
  }

  // 2. Query LLM to extract structured fields from raw transcript text
  Future<Map<String, dynamic>> extractStructuredData(String transcriptText) async {
    try {
      final response = await _dio.post(
        '/api/extraction/extract',
        data: {
          'transcript': transcriptText,
        },
      );

      if (response.statusCode == 200) {
        final body = response.data as Map<String, dynamic>;
        if (body.containsKey('data') && body['data'] is Map<String, dynamic>) {
          return body['data'] as Map<String, dynamic>;
        }
        return body;
      } else {
        throw Exception('Extraction status error: ${response.statusCode}');
      }
    } on DioException catch (e) {
      throw Exception('LLM extraction request failed: ${e.message}');
    }
  }

  // 3. Insert the final Work Order details and linked Voice Transcript audit log
  Future<Map<String, dynamic>> createWorkOrder({
    required String? equipmentId,
    required String faultCode,
    required String severity,
    required List<String> partsRequired,
    required String rawTranscript,
    required double confidenceScore,
    required bool exceptionFlag,
    required String audioStorageUrl,
  }) async {
    try {
      final payload = {
        'equipment_id': equipmentId, // If null, the server will resolve or handle exceptions
        'fault_code': faultCode,
        'severity': severity.toUpperCase(),
        'status': 'OPEN',
        'parts_required': partsRequired,
        'logged_by': AppConstants.workerUuid, // Rahul Chopra UUID
        'actions_taken': null,
        'raw_transcript': rawTranscript,
        'confidence_score': confidenceScore,
        'exception_flag': exceptionFlag,
        'audio_storage_url': audioStorageUrl,
      };

      final response = await _dio.post(
        '/api/work-orders',
        data: payload,
      );

      if (response.statusCode == 200 || response.statusCode == 201) {
        return response.data as Map<String, dynamic>;
      } else {
        throw Exception('Work order insertion status error: ${response.statusCode}');
      }
    } on DioException catch (e) {
      // Map server constraint validations or general network failures
      final errorMsg = e.response?.data?['error'] ?? e.message;
      throw Exception('Work Order database write failed: $errorMsg');
    }
  }

  // 4. Query RAG vector manuals for technical questions
  Future<String> queryKnowledgeBase(String queryText) async {
    try {
      final response = await _dio.post(
        '/api/queries',
        data: {
          'query_text': queryText,
        },
      );

      if (response.statusCode == 200) {
        return response.data['resolved_answer'] as String;
      } else {
        throw Exception('RAG status error: ${response.statusCode}');
      }
    } on DioException catch (e) {
      final errorMsg = e.response?.data?['error'] ?? e.message;
      throw Exception('Knowledge query failed: $errorMsg');
    }
  }
}
