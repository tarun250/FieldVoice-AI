const request = require('supertest');
const app = require('../index');
const db = require('../config/db');

const mockClient = {
  query: jest.fn(),
  release: jest.fn()
};

jest.mock('../config/db', () => {
  return {
    query: jest.fn(),
    pool: {
      connect: jest.fn(() => mockClient),
      end: jest.fn()
    }
  };
});

describe('Work Order Routes Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/work-orders', () => {
    test('Should create work order successfully and return 201', async () => {
      const mockRecord = {
        id: '99999999-9999-9999-9999-999999999999',
        equipment_id: '11111111-1111-1111-1111-111111111111',
        fault_code: 'F-LEAK',
        severity: 'HIGH',
        status: 'OPEN',
        parts_required: ['O-Ring'],
        logged_by: 'e3b0c442-98fc-1111-b303-0242ac120002'
      };

      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [mockRecord] }) // INSERT
        .mockResolvedValueOnce({}); // COMMIT

      const res = await request(app)
        .post('/api/work-orders')
        .send({
          equipment_id: '11111111-1111-1111-1111-111111111111',
          fault_code: 'F-LEAK',
          severity: 'HIGH',
          parts_required: ['O-Ring'],
          logged_by: 'e3b0c442-98fc-1111-b303-0242ac120002'
        });

      expect(res.status).toBe(201);
      expect(res.body).toEqual(mockRecord);
      expect(mockClient.query).toHaveBeenCalledTimes(3);
    });

    test('Should return 400 if validation fails in service layer', async () => {
      const res = await request(app)
        .post('/api/work-orders')
        .send({
          equipment_id: 'invalid-id',
          fault_code: 'F-LEAK'
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('equipment_id must be a valid UUID');
    });

    test('Should map foreign key constraint violation (code 23503) to HTTP 400', async () => {
      const dbError = new Error('insert or update on table violates foreign key constraint');
      dbError.code = '23503';
      dbError.detail = 'Key (equipment_id)=(11111111-1111-1111-1111-111111111111) is not present in table "equipment".';

      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockRejectedValueOnce(dbError) // INSERT fails
        .mockResolvedValueOnce({}); // ROLLBACK

      const res = await request(app)
        .post('/api/work-orders')
        .send({
          equipment_id: '11111111-1111-1111-1111-111111111111',
          fault_code: 'F-LEAK',
          severity: 'HIGH',
          logged_by: 'e3b0c442-98fc-1111-b303-0242ac120002'
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Equipment with the specified ID does not exist');
    });
  });

  describe('GET /api/work-orders', () => {
    test('Should list work orders successfully and return 200', async () => {
      const mockList = [
        { id: '99999999-9999-9999-9999-999999999999', severity: 'HIGH' }
      ];

      db.query.mockResolvedValue({ rows: mockList });

      const res = await request(app)
        .get('/api/work-orders')
        .query({ status: 'OPEN' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockList);
      expect(db.query.mock.calls[0][0]).toContain('WHERE status = $1');
      expect(db.query.mock.calls[0][1]).toEqual(['OPEN']);
    });
  });

  describe('GET /api/work-orders/:id', () => {
    test('Should return work order and 200 if found', async () => {
      const mockRecord = { id: '99999999-9999-9999-9999-999999999999', status: 'OPEN' };
      db.query.mockResolvedValue({ rows: [mockRecord] });

      const res = await request(app).get('/api/work-orders/99999999-9999-9999-9999-999999999999');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockRecord);
    });

    test('Should return 404 if not found', async () => {
      db.query.mockResolvedValue({ rows: [] });

      const res = await request(app).get('/api/work-orders/99999999-9999-9999-9999-999999999999');

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('not found');
    });
  });

  describe('PUT /api/work-orders/:id', () => {
    test('Should update fields and return 200', async () => {
      const mockRecord = { id: '99999999-9999-9999-9999-999999999999', status: 'IN_PROGRESS' };
      db.query.mockResolvedValue({ rows: [mockRecord] });

      const res = await request(app)
        .put('/api/work-orders/99999999-9999-9999-9999-999999999999')
        .send({ status: 'IN_PROGRESS' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockRecord);
    });
  });

  describe('PATCH /api/work-orders/:id/close', () => {
    test('Should set status to CLOSED and return 200', async () => {
      const mockRecord = { id: '99999999-9999-9999-9999-999999999999', status: 'CLOSED', actions_taken: 'Tightened bolts' };
      db.query.mockResolvedValue({ rows: [mockRecord] });

      const res = await request(app)
        .patch('/api/work-orders/99999999-9999-9999-9999-999999999999/close')
        .send({ actions_taken: 'Tightened bolts' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockRecord);
      expect(db.query.mock.calls[0][1]).toEqual(['Tightened bolts', '99999999-9999-9999-9999-999999999999']);
    });
  });
});
