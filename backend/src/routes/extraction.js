const express = require('express');
const extractionController = require('../controllers/extractionController');

const router = express.Router();

// Route for text parsing: POST /api/extraction/extract
router.post('/extract', extractionController.extractTranscript);

module.exports = router;
