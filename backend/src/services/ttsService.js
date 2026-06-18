const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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
      const voice = 'hannah';
      const normalizedText = text.trim().toLowerCase().replace(/[.,!?]/g, '');

      // List of static template messages that should be cached
      const CACHEABLE_MESSAGES = [
        'inspection started',
        'query started',
        'inspection stopped',
        'query stopped',
        'work order created successfully',
        'report rejected'
      ];

      const shouldCache = CACHEABLE_MESSAGES.includes(normalizedText);
      const uploadsDir = path.join(__dirname, '..', '..', 'uploads');
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }

      let filename;
      let outputPath;

      if (shouldCache) {
        const hash = crypto.createHash('md5').update(`${normalizedText}_${voice}`).digest('hex');
        filename = `cached-speech-${hash}.wav`;
        outputPath = path.join(uploadsDir, filename);

        // Check if cache file exists
        if (fs.existsSync(outputPath)) {
          console.log(`TTS Cache HIT for static prompt: "${text}"`);
          return `/uploads/${filename}`;
        }
        console.log(`TTS Cache MISS for static prompt: "${text}" — calling Groq API`);
      } else {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        filename = `speech-${uniqueSuffix}.wav`;
        outputPath = path.join(uploadsDir, filename);
        console.log(`TTS Request (Dynamic): "${text}" — calling Groq API`);
      }

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
          voice: voice,
          response_format: 'wav',
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Groq Speech Synthesis API responded with status ${response.status}: ${errorText}`);
      }

      // Read response as ArrayBuffer and convert to Buffer
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      fs.writeFileSync(outputPath, buffer);

      return `/uploads/${filename}`;
    } catch (error) {
      console.error('TTSService Synthesize Error:', error);
      throw error;
    }
  }
}

module.exports = new TTSService();
