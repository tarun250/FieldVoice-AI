// constants.dart
class AppConstants {
  // Update this to your local machine's IP (e.g., http://192.168.1.100:3000) 
  // or your hosted backend/tunnel URL to let a physical Android phone connect.
  static const String backendUrl = 'http://192.168.13.120:3000';

  // Hardcoded technician credentials per assignment specification
  static const String workerUuid = 'd3b0c442-98fc-1111-b303-0242ac120003';
  static const String workerName = 'Rahul Chopra';
  static const String workerUsername = 'rchopra';

  static String getEquipmentUuid(String? tag) {
    if (tag == null) return '11111111-1111-1111-1111-111111111111'; // Fallback to T-402
    final normalized = tag.toUpperCase().trim().replaceAll(' ', '');
    if (normalized.contains('T-402') || normalized.contains('T402')) {
      return '11111111-1111-1111-1111-111111111111';
    }
    if (normalized.contains('P-101') || normalized.contains('P101')) {
      return '22222222-2222-2222-2222-222222222222';
    }
    if (normalized.contains('V-99') || normalized.contains('V99')) {
      return '33333333-3333-3333-3333-333333333333';
    }
    if (normalized.contains('GEN-501') || normalized.contains('GEN501') || normalized.contains('501')) {
      return '44444444-4444-4444-4444-444444444444';
    }
    if (normalized.contains('BOILER') || normalized.contains('BOILER-3') || normalized.contains('BOILER3')) {
      return '55555555-5555-5555-5555-555555555555';
    }
    return '11111111-1111-1111-1111-111111111111'; // Fallback
  }
}
