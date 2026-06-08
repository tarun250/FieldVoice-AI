const request = require('supertest');
const app = require('../index');
const queryService = require('../services/queryService');

// Mock queryService to isolate route testing
jest.mock('../services/queryService');

describe('RAG Query Routes Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/queries', () => {
    test('Should successfully resolve query and return conversational answer', async () => {
      const mockResult = {
        answer: 'The oil pressure limit for Generator T-402 is 150 PSI.',
        source_chunks: ['Turbine Generator T-402 Operating Specifications'],
        source: 'faiss'
      };

      queryService.resolveQuery.mockResolvedValue(mockResult);

      const response = await request(app)
        .post('/api/queries')
        .send({
          query_text: 'What is the pressure limit for T-402?',
          technician_id: 'tech-123'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.answer).toBe('The oil pressure limit for Generator T-402 is 150 PSI.');
      expect(response.body.source_chunks).toContain('Turbine Generator T-402 Operating Specifications');
      expect(response.body.search_source).toBe('faiss');
      expect(queryService.resolveQuery).toHaveBeenCalledTimes(1);
    });

    test('Should return 400 if query_text parameter is missing', async () => {
      const response = await request(app)
        .post('/api/queries')
        .send({ technician_id: 'tech-123' }); // Missing query_text

      expect(response.status).toBe(400);
      expect(response.body.error_code).toBe('MISSING_QUERY');
    });

    test('Should return 400 if query_text is empty string', async () => {
      const response = await request(app)
        .post('/api/queries')
        .send({ query_text: '   ' });

      expect(response.status).toBe(400);
      expect(response.body.error_code).toBe('MISSING_QUERY');
    });

    test('Should return 500 if RAG query service fails internally', async () => {
      queryService.resolveQuery.mockRejectedValue(new Error('Vector database connection refused'));

      const response = await request(app)
        .post('/api/queries')
        .send({ query_text: 'Boiler 3 procedures' });

      expect(response.status).toBe(500);
      expect(response.body.error_code).toBe('QUERY_FAILED');
      expect(response.body.details).toBe('Vector database connection refused');
    });
  });
});
