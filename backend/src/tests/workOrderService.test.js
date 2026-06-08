const workOrderService = require('../services/workOrderService');
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

describe('Work Order Service Unit Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createWorkOrder', () => {
    test('Should throw error if equipment_id is missing or invalid UUID', async () => {
      await expect(workOrderService.createWorkOrder({
        fault_code: 'F-LEAK',
        severity: 'HIGH',
        logged_by: 'e3b0c442-98fc-1111-b303-0242ac120002'
      })).rejects.toThrow('equipment_id is required');

      await expect(workOrderService.createWorkOrder({
        equipment_id: 'invalid-uuid',
        fault_code: 'F-LEAK',
        severity: 'HIGH',
        logged_by: 'e3b0c442-98fc-1111-b303-0242ac120002'
      })).rejects.toThrow('equipment_id must be a valid UUID');
    });

    test('Should throw error if fault_code is missing or empty', async () => {
      await expect(workOrderService.createWorkOrder({
        equipment_id: '11111111-1111-1111-1111-111111111111',
        severity: 'HIGH',
        logged_by: 'e3b0c442-98fc-1111-b303-0242ac120002'
      })).rejects.toThrow('fault_code is required');
    });

    test('Should throw error if severity is missing or invalid enum value', async () => {
      await expect(workOrderService.createWorkOrder({
        equipment_id: '11111111-1111-1111-1111-111111111111',
        fault_code: 'F-LEAK',
        logged_by: 'e3b0c442-98fc-1111-b303-0242ac120002'
      })).rejects.toThrow('severity is required');

      await expect(workOrderService.createWorkOrder({
        equipment_id: '11111111-1111-1111-1111-111111111111',
        fault_code: 'F-LEAK',
        severity: 'URGENT',
        logged_by: 'e3b0c442-98fc-1111-b303-0242ac120002'
      })).rejects.toThrow('severity must be one of: LOW, MEDIUM, HIGH, CRITICAL');
    });

    test('Should throw error if logged_by is missing or invalid UUID', async () => {
      await expect(workOrderService.createWorkOrder({
        equipment_id: '11111111-1111-1111-1111-111111111111',
        fault_code: 'F-LEAK',
        severity: 'HIGH'
      })).rejects.toThrow('logged_by is required');

      await expect(workOrderService.createWorkOrder({
        equipment_id: '11111111-1111-1111-1111-111111111111',
        fault_code: 'F-LEAK',
        severity: 'HIGH',
        logged_by: 'invalid-uuid'
      })).rejects.toThrow('logged_by must be a valid UUID');
    });

    test('Should insert work order successfully and return the created record', async () => {
      const mockResult = {
        rows: [{
          id: '99999999-9999-9999-9999-999999999999',
          equipment_id: '11111111-1111-1111-1111-111111111111',
          fault_code: 'F-LEAK',
          severity: 'HIGH',
          status: 'OPEN',
          parts_required: ['Gasket'],
          logged_by: 'e3b0c442-98fc-1111-b303-0242ac120002'
        }]
      };

      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce(mockResult) // INSERT
        .mockResolvedValueOnce({}); // COMMIT

      const payload = {
        equipment_id: '11111111-1111-1111-1111-111111111111',
        fault_code: 'F-LEAK',
        severity: 'HIGH',
        parts_required: ['Gasket'],
        logged_by: 'e3b0c442-98fc-1111-b303-0242ac120002'
      };

      const result = await workOrderService.createWorkOrder(payload);

      expect(mockClient.query).toHaveBeenCalledTimes(3);
      expect(mockClient.release).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockResult.rows[0]);
    });

    test('Should execute ROLLBACK and release connection if query throws an error', async () => {
      const dbError = new Error('Database connection lost');

      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockRejectedValueOnce(dbError) // INSERT fails
        .mockResolvedValueOnce({}); // ROLLBACK

      const payload = {
        equipment_id: '11111111-1111-1111-1111-111111111111',
        fault_code: 'F-LEAK',
        severity: 'HIGH',
        parts_required: ['Gasket'],
        logged_by: 'e3b0c442-98fc-1111-b303-0242ac120002'
      };

      await expect(workOrderService.createWorkOrder(payload)).rejects.toThrow('Database connection lost');

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalledTimes(1);
    });
  });

  describe('updateWorkOrder', () => {
    test('Should throw error if id is invalid UUID', async () => {
      await expect(workOrderService.updateWorkOrder('invalid-id', { status: 'CLOSED' }))
        .rejects.toThrow('id must be a valid UUID');
    });

    test('Should update fields dynamically and return updated record', async () => {
      const mockResult = {
        rows: [{
          id: '99999999-9999-9999-9999-999999999999',
          status: 'IN_PROGRESS',
          severity: 'CRITICAL'
        }]
      };

      db.query.mockResolvedValue(mockResult);

      const result = await workOrderService.updateWorkOrder('99999999-9999-9999-9999-999999999999', {
        status: 'IN_PROGRESS',
        severity: 'CRITICAL'
      });

      expect(db.query).toHaveBeenCalledTimes(2);
      expect(result).toEqual(mockResult.rows[0]);
      
      const call = db.query.mock.calls[0];
      expect(call[0]).toContain('severity = $1');
      expect(call[0]).toContain('status = $2');
    });
  });

  describe('closeWorkOrder', () => {
    test('Should query database to set status CLOSED and save actions taken', async () => {
      const mockResult = {
        rows: [{
          id: '99999999-9999-9999-9999-999999999999',
          status: 'CLOSED',
          actions_taken: 'Replaced Gasket'
        }]
      };

      db.query.mockResolvedValue(mockResult);

      const result = await workOrderService.closeWorkOrder('99999999-9999-9999-9999-999999999999', 'Replaced Gasket');

      expect(db.query).toHaveBeenCalledTimes(2);
      expect(result).toEqual(mockResult.rows[0]);
      expect(db.query.mock.calls[0][0]).toContain("status = 'CLOSED'");
      expect(db.query.mock.calls[0][1]).toEqual(['Replaced Gasket', '99999999-9999-9999-9999-999999999999']);
    });
  });

  describe('getWorkOrderById', () => {
    test('Should return work order record if exists', async () => {
      const mockResult = {
        rows: [{
          id: '99999999-9999-9999-9999-999999999999',
          equipment_tag: 'T-402'
        }]
      };

      db.query.mockResolvedValue(mockResult);

      const result = await workOrderService.getWorkOrderById('99999999-9999-9999-9999-999999999999');

      expect(db.query).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockResult.rows[0]);
    });

    test('Should return null if record not found', async () => {
      db.query.mockResolvedValue({ rows: [] });

      const result = await workOrderService.getWorkOrderById('99999999-9999-9999-9999-999999999999');

      expect(result).toBeNull();
    });
  });
});
