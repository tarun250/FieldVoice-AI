const express = require('express');
const queryController = require('../controllers/queryController');

const router = express.Router();

// Route for RAG Q&A search: POST /api/queries
router.post('/', queryController.searchQueries);

module.exports = router;
