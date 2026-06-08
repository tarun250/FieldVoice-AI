const fs = require('fs');
const path = require('path');
const groq = require('../config/groq');

// Supported audio formats by Groq Whisper API
const SUPPORTED_FORMATS = ['.mp3', '.mp4', '.mpeg', '.mpga', '.m4a', '.wav', '.webm', '.ogg'];
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB

/**
 * Speech-to-Text Service using Whisper on Groq
 */
class STTService {
  /**
   * Transcribe an audio file using Groq Whisper large v3 turbo
   * @param {string} filePath - Absolute path to the saved audio file
   * @returns {Promise<{text: string, language: string}>} - The transcription result
   */
  async transcribe(filePath) {
    // 1. Validate file existence
    if (!fs.existsSync(filePath)) {
      throw new Error(`Audio file not found at path: ${filePath}`);
    }

    // 2. Validate file format
    const ext = path.extname(filePath).toLowerCase();
    if (!SUPPORTED_FORMATS.includes(ext)) {
      throw new Error(`Unsupported audio format: ${ext}. Supported formats: ${SUPPORTED_FORMATS.join(', ')}`);
    }

    // 3. Validate file size
    const stats = fs.statSync(filePath);
    if (stats.size > MAX_FILE_SIZE_BYTES) {
      throw new Error(`File size (${(stats.size / (1024 * 1024)).toFixed(2)}MB) exceeds limit of 25MB`);
    }

    // 4. Build noise handling & domain-aware prompt
    // Whisper's prompt guides spelling and context. Seeding industrial vocabulary and noise filters.
    const noisePrompt = 
      "This is a recording from a noisy industrial plant. Technical codes: T-402, P-101, P-204, V-312, GEN-501, COMP-7A, V-99, T-102, HYD-88, BOILER-3. " +
      "Fault codes: F-LEAK-OIL, F-MECH-VIB, F-ELEC-SHORT, F-THERM-HOT, F-HYD-PRESS, F-STRUCT-CRACK, F-MECH-WEAR, F-ELEC-CALIBR. " +
      "Terms: cavitation, armature, backlash, impeller, pressure drop, insulation resistance, misalignment, packing leak. " +
      "Please ignore background machine noise, clanking, hissing, or static.";

    try {
      const response = await groq.audio.transcriptions.create({
        file: fs.createReadStream(filePath),
        model: 'whisper-large-v3-turbo',
        response_format: 'verbose_json',
        prompt: noisePrompt,
        temperature: 0.0, // Low temperature for high accuracy/factual spelling
      });

      return {
        text: response.text,
        language: response.language || 'en',
      };
    } catch (error) {
      console.error('Groq Whisper STT API Error:', error);
      throw new Error(`STT Transcription API failed: ${error.message}`);
    }
  }
}

module.exports = new STTService();
