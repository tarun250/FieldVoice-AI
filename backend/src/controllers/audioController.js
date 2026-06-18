const fs = require('fs');
const path = require('path');
const sttService = require('../services/sttService');

/**
 * Controller for handling audio uploads and operations
 */
class AudioController {
  /**
   * Transcribe uploaded audio file
   */
  async transcribeAudio(req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({
          error_code: 'MISSING_FILE',
          message: 'No audio file uploaded. Ensure key is "audio" in multipart form-data.'
        });
      }

      // Validate file format at controller level to avoid socket cuts
      const ext = path.extname(req.file.originalname).toLowerCase();
      const allowed = ['.mp3', '.mp4', '.mpeg', '.mpga', '.m4a', '.wav', '.webm', '.ogg'];
      if (!allowed.includes(ext)) {
        if (fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
        }
        return res.status(400).json({
          error_code: 'UNSUPPORTED_FORMAT',
          message: `Unsupported audio format: ${ext}. Allowed formats: ${allowed.join(', ')}`
        });
      }

      // Execute transcription using Groq Whisper service
      const result = await sttService.transcribe(req.file.path);
      const text = result.text;
      const language = result.language;

      // Return the transcription and the saved file details
      return res.status(200).json({
        success: true,
        text: text,
        language: language,
        file: {
          filename: req.file.filename,
          original_name: req.file.originalname,
          size_bytes: req.file.size,
          storage_path: `/uploads/${req.file.filename}`
        }
      });
    } catch (error) {
      console.error('AudioController Transcribe Error:', error);
      return res.status(500).json({
        error_code: 'AUDIO_PROCESSING_FAILED',
        message: 'The transcription process failed.',
        details: error.message
      });
    }
  }

  /**
   * Delete audio file (Supervisor capability)
   */
  async deleteAudio(req, res) {
    try {
      const { filename } = req.params;

      // Prevent directory traversal attacks (handling URL encoded values)
      const decodedFilename = decodeURIComponent(filename);
      if (!decodedFilename || decodedFilename.includes('..') || path.isAbsolute(decodedFilename)) {
        return res.status(400).json({
          error_code: 'INVALID_FILENAME',
          message: 'Security warning: Invalid filename pattern.'
        });
      }

      const uploadsDir = path.join(__dirname, '..', '..', 'uploads');
      const filePath = path.join(uploadsDir, filename);

      // Check if file exists
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({
          error_code: 'FILE_NOT_FOUND',
          message: 'Audio file not found on server.'
        });
      }

      // Delete file
      fs.unlinkSync(filePath);

      return res.status(200).json({
        success: true,
        message: `Audio file ${filename} successfully deleted by supervisor.`
      });
    } catch (error) {
      console.error('AudioController Delete Error:', error);
      return res.status(500).json({
        error_code: 'FILE_DELETION_FAILED',
        message: 'Failed to delete audio file.',
        details: error.message
      });
    }
  }
}

module.exports = new AudioController();
