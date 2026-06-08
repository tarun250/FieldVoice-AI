const express = require('express');
const cors = require('cors');
const path = require('path');
const apiRoutes = require('./routes/api');

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS
app.use(cors());

// Body Parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve uploads directory securely for playbacks (prevent directory traversal)
const fs = require('fs');
const uploadsDir = path.join(__dirname, '..', 'uploads');
app.get('/uploads/:filename', (req, res) => {
  const { filename } = req.params;
  const decodedFilename = decodeURIComponent(filename);
  if (!decodedFilename || decodedFilename.includes('..') || path.isAbsolute(decodedFilename)) {
    return res.status(400).json({ error: 'Security warning: Invalid filename pattern.' });
  }
  const filePath = path.join(uploadsDir, decodedFilename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found.' });
  }
  res.sendFile(filePath);
});

// Health Check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'FieldVoice Server is running.' });
});

// Register API Routes
app.use('/api', apiRoutes);

// Export app for test runs, bind port if run directly
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`FieldVoice server listening on port ${PORT}`);
    console.log(`Secured uploads audio files route active at http://localhost:${PORT}/uploads/`);

    // Startup Python dependency smoke check
    const { exec } = require('child_process');
    exec('python --version', (err, stdout, stderr) => {
      if (err) {
        console.warn('\n⚠️  WARNING: Python is not available in system PATH.');
        console.warn('   RAG vector similarity search will default to in-memory keyword matching fallback.');
      } else {
        const versionStr = (stdout || stderr || '').trim();
        console.log(`\n✓ Python dependency verified: ${versionStr}`);
      }
    });
  });
}

module.exports = app;
