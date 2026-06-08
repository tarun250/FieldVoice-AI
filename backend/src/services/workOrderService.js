const db = require('../config/db');
const { randomUUID } = require('crypto');

const SEVERITY_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const STATUS_LEVELS = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUUID(id) {
  return typeof id === 'string' && UUID_REGEX.test(id);
}

class WorkOrderService {
  /**
   * Validate work order creation data
   */
  validateCreate(data) {
    if (!data.equipment_id) {
      throw new Error('equipment_id is required');
    }
    if (!isValidUUID(data.equipment_id)) {
      throw new Error('equipment_id must be a valid UUID');
    }
    if (!data.fault_code || typeof data.fault_code !== 'string' || data.fault_code.trim() === '') {
      throw new Error('fault_code is required');
    }
    if (!data.severity) {
      throw new Error('severity is required');
    }
    if (!SEVERITY_LEVELS.includes(data.severity.toUpperCase())) {
      throw new Error(`severity must be one of: ${SEVERITY_LEVELS.join(', ')}`);
    }
    if (!data.logged_by) {
      throw new Error('logged_by is required');
    }
    if (!isValidUUID(data.logged_by)) {
      throw new Error('logged_by must be a valid UUID');
    }
    if (data.id && !isValidUUID(data.id)) {
      throw new Error('id must be a valid UUID');
    }
    if (data.parts_required && !Array.isArray(data.parts_required)) {
      throw new Error('parts_required must be an array of strings');
    }
  }

  /**
   * Create a new work order
   */
  async createWorkOrder(data) {
    this.validateCreate(data);

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      const id = data.id || randomUUID();
      const severity = data.severity.toUpperCase();
      const parts = data.parts_required || [];
      const status = data.status ? data.status.toUpperCase() : 'OPEN';
      const offlineCreatedAt = data.offline_created_at || null;

      if (!STATUS_LEVELS.includes(status)) {
        throw new Error(`status must be one of: ${STATUS_LEVELS.join(', ')}`);
      }

      const queryText = `
        INSERT INTO work_orders (
          id, equipment_id, fault_code, severity, status, actions_taken, parts_required, logged_by, offline_created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *
      `;

      const params = [
        id,
        data.equipment_id,
        data.fault_code,
        severity,
        status,
        data.actions_taken || null,
        parts,
        data.logged_by,
        offlineCreatedAt
      ];

      const result = await client.query(queryText, params);
      const workOrder = result.rows[0];

      // Optionally insert transcript data if provided
      if (data.raw_transcript) {
        const vtId = randomUUID();
        const confidence = data.confidence_score !== undefined ? parseFloat(data.confidence_score) : 1.000;
        const exception = data.exception_flag === true || data.exception_flag === 'true' || confidence < 0.70;
        const audioUrl = data.audio_storage_url || '';

        await client.query(`
          INSERT INTO voice_transcripts (id, work_order_id, raw_transcript, confidence_score, exception_flag, audio_storage_url)
          VALUES ($1, $2, $3, $4, $5, $6)
        `, [vtId, id, data.raw_transcript, confidence, exception, audioUrl]);

        // Attach transcript details to response object
        workOrder.raw_transcript = data.raw_transcript;
        workOrder.confidence_score = confidence;
        workOrder.exception_flag = exception;
        workOrder.audio_storage_url = audioUrl;
      }

      await client.query('COMMIT');
      return workOrder;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Update an existing work order
   */
  async updateWorkOrder(id, data) {
    if (!isValidUUID(id)) {
      throw new Error('id must be a valid UUID');
    }

    const updates = [];
    const params = [];
    let paramIndex = 1;

    if (data.severity) {
      const severity = data.severity.toUpperCase();
      if (!SEVERITY_LEVELS.includes(severity)) {
        throw new Error(`severity must be one of: ${SEVERITY_LEVELS.join(', ')}`);
      }
      updates.push(`severity = $${paramIndex++}`);
      params.push(severity);
    }

    if (data.status) {
      const status = data.status.toUpperCase();
      if (!STATUS_LEVELS.includes(status)) {
        throw new Error(`status must be one of: ${STATUS_LEVELS.join(', ')}`);
      }
      updates.push(`status = $${paramIndex++}`);
      params.push(status);
    }

    if (data.actions_taken !== undefined) {
      updates.push(`actions_taken = $${paramIndex++}`);
      params.push(data.actions_taken);
    }

    if (data.parts_required) {
      if (!Array.isArray(data.parts_required)) {
        throw new Error('parts_required must be an array of strings');
      }
      updates.push(`parts_required = $${paramIndex++}`);
      params.push(data.parts_required);
    }

    if (updates.length === 0) {
      return this.getWorkOrderById(id);
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`);

    params.push(id);
    const queryText = `
      UPDATE work_orders
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    const result = await db.query(queryText, params);
    if (result.rows.length === 0) {
      return null;
    }
    return this.getWorkOrderById(id); // Return full joined info
  }

  /**
   * Close a work order
   */
  async closeWorkOrder(id, actionsTaken = null) {
    if (!isValidUUID(id)) {
      throw new Error('id must be a valid UUID');
    }

    const queryText = `
      UPDATE work_orders
      SET status = 'CLOSED', actions_taken = COALESCE($1, actions_taken), updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING *
    `;

    const result = await db.query(queryText, [actionsTaken, id]);
    if (result.rows.length === 0) {
      return null;
    }
    return this.getWorkOrderById(id); // Return full joined info
  }

  /**
   * Get a work order by ID
   */
  async getWorkOrderById(id) {
    if (!isValidUUID(id)) {
      throw new Error('id must be a valid UUID');
    }

    const queryText = `
      SELECT wo.*, eq.tag as equipment_tag, eq.name as equipment_name, w.username as logged_by_username,
             vt.raw_transcript, vt.confidence_score, vt.exception_flag, vt.audio_storage_url
      FROM work_orders wo
      LEFT JOIN equipment eq ON wo.equipment_id = eq.id
      LEFT JOIN workers w ON wo.logged_by = w.id
      LEFT JOIN voice_transcripts vt ON vt.work_order_id = wo.id
      WHERE wo.id = $1
    `;

    const result = await db.query(queryText, [id]);
    if (result.rows.length === 0) {
      return null;
    }
    return result.rows[0];
  }

  /**
   * List work orders with optional filtering
   */
  async listWorkOrders(filters = {}) {
    const clauses = [];
    const params = [];
    let paramIndex = 1;

    if (filters.status) {
      clauses.push(`status = $${paramIndex++}`);
      params.push(filters.status.toUpperCase());
    }

    if (filters.severity) {
      clauses.push(`severity = $${paramIndex++}`);
      params.push(filters.severity.toUpperCase());
    }

    if (filters.equipment_id) {
      if (!isValidUUID(filters.equipment_id)) {
        throw new Error('equipment_id filter must be a valid UUID');
      }
      clauses.push(`equipment_id = $${paramIndex++}`);
      params.push(filters.equipment_id);
    }

    const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

    const queryText = `
      SELECT wo.*, eq.tag as equipment_tag, eq.name as equipment_name, w.username as logged_by_username,
             vt.raw_transcript, vt.confidence_score, vt.exception_flag, vt.audio_storage_url
      FROM work_orders wo
      LEFT JOIN equipment eq ON wo.equipment_id = eq.id
      LEFT JOIN workers w ON wo.logged_by = w.id
      LEFT JOIN voice_transcripts vt ON vt.work_order_id = wo.id
      ${whereClause}
      ORDER BY wo.created_at DESC
    `;

    const result = await db.query(queryText, params);
    return result.rows;
  }
}

module.exports = new WorkOrderService();
