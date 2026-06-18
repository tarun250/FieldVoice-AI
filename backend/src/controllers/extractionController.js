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

      // Generate TTS voice confirmation text and synthesize it
      const parts = result.parts_required || [];
      const partsText = parts.length === 0 ? "no replacement parts" : `required parts: ${parts.join(', ')}`;
      const ttsMessage = `Verify report details. Equipment ID is ${result.equipment_id || 'Unspecified machine'}. Detected fault code is ${result.fault_code || 'Unspecified fault'}. Severity is ${result.severity || 'MEDIUM'}. And ${partsText}. Please say confirm to submit, or cancel to try again.`;

      let ttsAudioUrl = null;
      try {
        const ttsService = require('../services/ttsService');
        ttsAudioUrl = await ttsService.synthesize(ttsMessage);
      } catch (err) {
        console.error('Failed to generate TTS audio in extraction:', err.message);
      }

      return res.status(200).json({
        success: true,
        data: {
          ...result,
          tts_audio_url: ttsAudioUrl
        }
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
