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
      const partsText = parts.length === 0 ? "no replacement parts are required" : `the required parts are ${parts.join(', ')}`;
      const ttsMessage = `I've got the report details. The equipment is ${result.equipment_id || 'unspecified'} with a fault of ${result.fault_code || 'unspecified'}. The severity is ${result.severity || 'MEDIUM'}, and ${partsText}. Would you like to confirm this, reject it, or make any changes?`;

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

  /**
   * Update structured fields with a change request
   */
  async updateExtraction(req, res) {
    try {
      const { current_data, change_request } = req.body;

      if (!current_data || typeof current_data !== 'object') {
        return res.status(400).json({
          error_code: 'MISSING_DATA',
          message: 'Parameter "current_data" is required as a JSON object in the request body.'
        });
      }
      if (!change_request || typeof change_request !== 'string' || change_request.trim() === '') {
        return res.status(400).json({
          error_code: 'MISSING_REQUEST',
          message: 'Parameter "change_request" is required as a non-empty string in the request body.'
        });
      }

      const result = await extractionService.update(current_data, change_request);

      // Generate TTS voice confirmation text for updated details
      const parts = result.parts_required || [];
      const partsText = parts.length === 0 ? "no replacement parts are required" : `the required parts are ${parts.join(', ')}`;
      const ttsMessage = `Sure, I've updated the details. Now the equipment is ${result.equipment_id || 'unspecified'} with a fault of ${result.fault_code || 'unspecified'}. The severity is ${result.severity || 'MEDIUM'}, and ${partsText}. Would you like to confirm this, reject it, or make more changes?`;

      let ttsAudioUrl = null;
      try {
        const ttsService = require('../services/ttsService');
        ttsAudioUrl = await ttsService.synthesize(ttsMessage);
      } catch (err) {
        console.error('Failed to generate TTS audio in extraction update:', err.message);
      }

      return res.status(200).json({
        success: true,
        data: {
          ...result,
          tts_audio_url: ttsAudioUrl
        }
      });
    } catch (error) {
      console.error('ExtractionController Update Error:', error);
      return res.status(500).json({
        error_code: 'UPDATE_FAILED',
        message: 'Failed to update structured data.',
        details: error.message
      });
    }
  }
}

module.exports = new ExtractionController();
