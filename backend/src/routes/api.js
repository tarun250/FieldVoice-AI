const express = require('express');
const audioRoutes = require('./audio');
const extractionRoutes = require('./extraction');
const queryRoutes = require('./query');
const workOrderRoutes = require('./workOrders');

const router = express.Router();

// Mount audio routes under /audio
router.use('/audio', audioRoutes);

// Mount extraction routes under /extraction
router.use('/extraction', extractionRoutes);

// Mount RAG query routes under /queries
router.use('/queries', queryRoutes);

// Mount work order routes under /work-orders
router.use('/work-orders', workOrderRoutes);

module.exports = router;
