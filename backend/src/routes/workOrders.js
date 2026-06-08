const express = require('express');
const workOrderController = require('../controllers/workOrderController');
const sseManager = require('../utils/sse');

const router = express.Router();

router.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  sseManager.addClient(res);

  // Send a heartbeat ping every 15 seconds to prevent client timeout cuts
  const keepAliveInterval = setInterval(() => {
    try {
      res.write(': keep-alive\n\n');
    } catch (err) {
      console.error('Failed to write heartbeat to SSE client:', err.message);
      clearInterval(keepAliveInterval);
      try {
        sseManager.removeClient(res);
      } catch (e) {}
    }
  }, 15000);

  req.on('close', () => {
    clearInterval(keepAliveInterval);
    sseManager.removeClient(res);
    try {
      res.end();
    } catch (e) {}
  });
});

router.post('/', workOrderController.create);
router.get('/', workOrderController.list);
router.get('/:id', workOrderController.retrieve);
router.put('/:id', workOrderController.update);
router.patch('/:id/close', workOrderController.close);

module.exports = router;
