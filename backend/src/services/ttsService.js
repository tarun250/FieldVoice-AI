const fs = require('fs');
const path = require('path');

class TTSService {
  /**
   * Synthesize text into an audio file using Groq's Orpheus model
   * @param {string} text - Text to synthesize
   * @returns {Promise<string>} - Relative storage path of the saved MP3 file
   */
  async synthesize(text) {
    if (!text || typeof text !== 'string' || text.trim() === '') {
      throw new Error('TTS Service: Input text must be a non-empty string');
    }

    try {
      const apiKey = process.env.GROQ_API_KEY;
      if (!apiKey) {
        throw new Error('GROQ_API_KEY environment variable is not defined.');
      }

      // Call the OpenAI-compatible speech endpoint on Groq via native fetch
      const response = await fetch('https://api.groq.com/openai/v1/audio/speech', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'canopylabs/orpheus-v1-english',
          input: text,
          voice: 'autumn',
          response_format: 'mp3',
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Groq Speech Synthesis API responded with status ${response.status}: ${errorText}`);
      }

      // Read response as ArrayBuffer and convert to Buffer
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // Save file inside standard uploads directory
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
      const filename = `speech-${uniqueSuffix}.mp3`;
      const uploadsDir = path.join(__dirname, '..', '..', 'uploads');
      
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }

      const outputPath = path.join(uploadsDir, filename);
      fs.writeFileSync(outputPath, buffer);

      return `/uploads/${filename}`;
    } catch (error) {
      console.error('TTSService Synthesize Error:', error);
      throw error;
    }
  }
}

module.exports = new TTSService();
