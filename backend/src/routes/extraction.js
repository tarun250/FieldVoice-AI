const express = require('express');
const extractionController = require('../controllers/extractionController');

const router = express.Router();

// Route for text parsing: POST /api/extraction/extract
router.post('/extract', extractionController.extractTranscript);

// Route for text updating: POST /api/extraction/update
router.post('/update', extractionController.updateExtraction);

module.exports = router;
