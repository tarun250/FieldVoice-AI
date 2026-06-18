const request = require('supertest');
const app = require('../index');
const extractionService = require('../services/extractionService');

// Mock extractionService to isolate route testing
jest.mock('../services/extractionService');

describe('Structured Extraction Routes Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/extraction/extract', () => {
    test('Should successfully parse transcript and return structured JSON', async () => {
      const mockResult = {
        equipment_id: 'GEN-501',
        location: 'North Yard',
        fault_code: 'F-LEAK-OIL',
        severity: 'HIGH',
        action_taken: 'None',
        parts_required: [],
        confidence_score: 0.95,
        exception_flag: false
      };

      extractionService.extract.mockResolvedValue(mockResult);

      const response = await request(app)
        .post('/api/extraction/extract')
        .send({ transcript: 'Emergency Generator GEN-501 in North Yard has oil leak.' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.equipment_id).toBe('GEN-501');
      expect(response.body.data.severity).toBe('HIGH');
      expect(response.body.data.exception_flag).toBe(false);
      expect(extractionService.extract).toHaveBeenCalledTimes(1);
    });

    test('Should return 400 if transcript is missing in payload', async () => {
      const response = await request(app)
        .post('/api/extraction/extract')
        .send({}); // Send empty object

      expect(response.status).toBe(400);
      expect(response.body.error_code).toBe('MISSING_TRANSCRIPT');
    });

    test('Should return 400 if transcript is empty string', async () => {
      const response = await request(app)
        .post('/api/extraction/extract')
        .send({ transcript: '   ' });

      expect(response.status).toBe(400);
      expect(response.body.error_code).toBe('MISSING_TRANSCRIPT');
    });

    test('Should return 500 if extraction service fails internally', async () => {
      extractionService.extract.mockRejectedValue(new Error('LLM rate limit reached'));

      const response = await request(app)
        .post('/api/extraction/extract')
        .send({ transcript: 'Generator inspection details' });

      expect(response.status).toBe(500);
      expect(response.body.error_code).toBe('EXTRACTION_FAILED');
      expect(response.body.details).toBe('LLM rate limit reached');
      
    });
    
  });
  
});
