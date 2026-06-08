const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const audioController = require('../controllers/audioController');

const router = express.Router();

// Define permanent uploads directory
const uploadsDir = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure Multer Storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    // Generate unique name keeping original extension
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname) || '.wav';
    cb(null, 'audio-' + uniqueSuffix + ext);
  }
});

// Configure Multer Upload limits
const upload = multer({
  storage,
  limits: {
    fileSize: 25 * 1024 * 1024 // 25 MB
  }
});

// Route for transcription: POST /api/audio/transcribe
router.post('/transcribe', (req, res, next) => {
  upload.single('audio')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({
        error_code: 'UPLOAD_LIMIT_EXCEEDED',
        message: err.message
      });
    } else if (err) {
      return res.status(400).json({
        error_code: 'UPLOAD_ERROR',
        message: err.message
      });
    }
    next();
  });
}, audioController.transcribeAudio);

// Route for supervisor deletion: DELETE /api/audio/:filename
router.delete('/:filename', audioController.deleteAudio);

module.exports = router;
