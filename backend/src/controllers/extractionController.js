const extractionService = require('../services/extractionService');

/**
 * Controller to handle transcript structured parsing requests
 */
class ExtractionController {
  /**
   * Extract fields from plain text transcript
   */
  async extractTranscript(req, res) {
    try {
      const { transcript } = req.body;

      if (!transcript || typeof transcript !== 'string' || transcript.trim() === '') {
        return res.status(400).json({
          error_code: 'MISSING_TRANSCRIPT',
          message: 'Parameter "transcript" is required as a non-empty string in the request body.'
        });
      }

      // Execute structured parsing
      const result = await extractionService.extract(transcript);

      return res.status(200).json({
        success: true,
        data: result
      });
    } catch (error) {
      console.error('ExtractionController Error:', error);
      return res.status(500).json({
        error_code: 'EXTRACTION_FAILED',
        message: 'Failed to extract structured data from transcript.',
        details: error.message
      });
    }
  }
}

module.exports = new ExtractionController();
