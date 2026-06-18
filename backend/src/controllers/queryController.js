const queryService = require('../services/queryService');

/**
 * Controller to handle vector-enhanced search/query requests
 */
class QueryController {
  /**
   * Search database and answer voice question
   */
  async searchQueries(req, res) {
    try {
      const { query_text, technician_id } = req.body;

      if (!query_text || typeof query_text !== 'string' || query_text.trim() === '') {
        return res.status(400).json({
          error_code: 'MISSING_QUERY',
          message: 'Parameter "query_text" is required as a non-empty string in request body.'
        });
      }

      const techId = technician_id || 'anonymous-tech';

      // Execute RAG pipeline
      const result = await queryService.resolveQuery(query_text, techId);

      // Synthesize answer text into speech
      const ttsMessage = `Response from knowledge manual: ${result.answer}`;
      let ttsAudioUrl = null;
      try {
        const ttsService = require('../services/ttsService');
        ttsAudioUrl = await ttsService.synthesize(ttsMessage);
      } catch (err) {
        console.error('Failed to generate TTS audio in query:', err.message);
      }

      return res.status(200).json({
        success: true,
        answer: result.answer,
        resolved_answer: result.answer, // support both keys for mobile compatibility
        source_chunks: result.source_chunks,
        search_source: result.source,
        tts_audio_url: ttsAudioUrl
      });
    } catch (error) {
      console.error('QueryController Error:', error);
      return res.status(500).json({
        error_code: 'QUERY_FAILED',
        message: 'Failed to resolve RAG query.',
        details: error.message
      });
    }
  }
}

module.exports = new QueryController();
