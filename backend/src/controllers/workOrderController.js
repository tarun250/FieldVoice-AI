const workOrderService = require('../services/workOrderService');
const sseManager = require('../utils/sse');

// Helper to map DB error code to friendly error response
function handleDbError(err, res) {
  console.error('Database error in work order operations:', err);

  // 23503 is PostgreSQL foreign_key_violation
  if (err.code === '23503') {
    const detail = err.detail || '';
    if (detail.includes('equipment_id')) {
      return res.status(400).json({ error: 'Referential integrity check failed: Equipment with the specified ID does not exist.' });
    }
    if (detail.includes('logged_by')) {
      return res.status(400).json({ error: 'Referential integrity check failed: Worker with the specified ID does not exist.' });
    }
    return res.status(400).json({ error: 'Referential integrity check failed: Referenced entity not found.' });
  }

  // 22P02 is PostgreSQL invalid_text_representation (typically invalid UUID syntax)
  if (err.code === '22P02') {
    return res.status(400).json({ error: 'Invalid data format: One or more UUIDs are malformed.' });
  }

  // 23514 is PostgreSQL check_violation
  if (err.code === '23514') {
    return res.status(400).json({ error: `Value constraint violated: ${err.message}` });
  }

  // 23505 is PostgreSQL unique_violation
  if (err.code === '23505') {
    return res.status(400).json({ error: 'Duplicate resource error: A record with this ID already exists.' });
  }

  return res.status(500).json({ error: 'Internal server database error during request execution.' });
}

class WorkOrderController {
  async create(req, res) {
    try {
      const workOrder = await workOrderService.createWorkOrder(req.body);
      sseManager.broadcast('work-order-created', workOrder);
      return res.status(201).json(workOrder);
    } catch (err) {
      if (err instanceof Error && !err.code) {
        // Validation error thrown from service
        return res.status(400).json({ error: err.message });
      }
      return handleDbError(err, res);
    }
  }

  async update(req, res) {
    try {
      const { id } = req.params;
      const workOrder = await workOrderService.updateWorkOrder(id, req.body);
      if (!workOrder) {
        return res.status(404).json({ error: `Work order with ID ${id} not found.` });
      }
      sseManager.broadcast('work-order-updated', workOrder);
      return res.status(200).json(workOrder);
    } catch (err) {
      if (err instanceof Error && !err.code) {
        return res.status(400).json({ error: err.message });
      }
      return handleDbError(err, res);
    }
  }

  async close(req, res) {
    try {
      const { id } = req.params;
      const { actions_taken } = req.body;
      const workOrder = await workOrderService.closeWorkOrder(id, actions_taken);
      if (!workOrder) {
        return res.status(404).json({ error: `Work order with ID ${id} not found.` });
      }
      sseManager.broadcast('work-order-closed', workOrder);
      return res.status(200).json(workOrder);
    } catch (err) {
      if (err instanceof Error && !err.code) {
        return res.status(400).json({ error: err.message });
      }
      return handleDbError(err, res);
    }
  }

  async retrieve(req, res) {
    try {
      const { id } = req.params;
      const workOrder = await workOrderService.getWorkOrderById(id);
      if (!workOrder) {
        return res.status(404).json({ error: `Work order with ID ${id} not found.` });
      }
      return res.status(200).json(workOrder);
    } catch (err) {
      if (err instanceof Error && !err.code) {
        return res.status(400).json({ error: err.message });
      }
      return handleDbError(err, res);
    }
  }

  async list(req, res) {
    try {
      const { status, severity, equipment_id } = req.query;
      const workOrders = await workOrderService.listWorkOrders({ status, severity, equipment_id });
      return res.status(200).json(workOrders);
    } catch (err) {
      if (err instanceof Error && !err.code) {
        return res.status(400).json({ error: err.message });
      }
      return handleDbError(err, res);
    }
  }
}

module.exports = new WorkOrderController();
