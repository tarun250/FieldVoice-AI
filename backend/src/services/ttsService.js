const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class TTSService {
  constructor() {
    this.useSecondaryKey = false;
  }

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

      const apiKeyPrimary = process.env.GROQ_API_KEY;
      const apiKeySecondary = process.env.GROQ_API_KEY_2;

      if (!apiKeyPrimary && !apiKeySecondary) {
        throw new Error('GROQ_API_KEY and GROQ_API_KEY_2 environment variables are both undefined.');
      }

      // Helper function to call the Groq TTS API
      const callSpeechApi = async (apiKey, keyLabel) => {
        console.log(`Attempting Groq TTS using ${keyLabel} API key...`);
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
          throw new Error(`Groq API responded with status ${response.status}: ${errorText}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        return Buffer.from(arrayBuffer);
      };

      let buffer;
      const firstKey = (this.useSecondaryKey && apiKeySecondary) ? apiKeySecondary : apiKeyPrimary;
      const firstKeyLabel = (this.useSecondaryKey && apiKeySecondary) ? 'Secondary' : 'Primary';

      try {
        buffer = await callSpeechApi(firstKey, firstKeyLabel);
      } catch (err) {
        console.warn(`TTS ${firstKeyLabel} API key failed: ${err.message}. Attempting failover rotation...`);
        
        // Toggle the active key flag
        this.useSecondaryKey = !this.useSecondaryKey;

        const secondKey = (this.useSecondaryKey && apiKeySecondary) ? apiKeySecondary : apiKeyPrimary;
        const secondKeyLabel = (this.useSecondaryKey && apiKeySecondary) ? 'Secondary' : 'Primary';

        if (secondKey && secondKey !== firstKey) {
          try {
            buffer = await callSpeechApi(secondKey, secondKeyLabel);
          } catch (secondErr) {
            console.error(`TTS ${secondKeyLabel} API key also failed: ${secondErr.message}`);
            // Revert flag since both failed, so we start fresh next time
            this.useSecondaryKey = !this.useSecondaryKey;
            throw secondErr;
          }
        } else {
          // No alternative key configured or it's the same key
          throw err;
        }
      }

      fs.writeFileSync(outputPath, buffer);

      return `/uploads/${filename}`;
    } catch (error) {
      console.error('TTSService Synthesize Error:', error);
      throw error;
    }
  }
}

module.exports = new TTSService();
