const openrouterConfig = require('../config/openrouter');
const groq = require('../config/groq');

// Allowed severity values
const ALLOWED_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

/**
 * Service to extract structured work order records from plain text transcripts
 */
class ExtractionService {
  /**
   * Extract fields from raw transcript
   * @param {string} transcript - Plain text transcription
   * @returns {Promise<object>} - Validated structured JSON schema
   */
  async extract(transcript) {
    if (!transcript || typeof transcript !== 'string' || transcript.trim() === '') {
      throw new Error('Transcript input must be a non-empty string');
    }

    const systemPrompt = 
      "You are an expert industrial system parser. Analyze the given field technician voice transcript and extract structured details into a raw JSON object.\n" +
      "You must output ONLY a valid JSON object. Do not include markdown code block syntax (like ```json), commentary, or extra text.\n" +
      "The JSON object must contain the following keys exactly:\n" +
      "1. \"equipment_id\": String. The unique code of the machine (e.g., T-402, P-101, GEN-501). If not found, return null.\n" +
      "2. \"location\": String. The physical location where the machine is situated (e.g., Basement Sump, North Yard, Turbine Room B). If not found, return null.\n" +
      "3. \"fault_code\": String. The specific fault identifier (e.g., F-LEAK-OIL, F-STRUCT-CRACK, F-THERM-HOT). If not found, return null.\n" +
      "4. \"severity\": String. Must be exactly one of: \"LOW\", \"MEDIUM\", \"HIGH\", \"CRITICAL\". Default to \"MEDIUM\" if not explicitly specified.\n" +
      "5. \"action_taken\": String. The immediate repair action taken by the technician. If not found, return null.\n" +
      "6. \"parts_required\": Array of strings. List of replacement parts required (e.g., [\"Flange Gasket\", \"Seal Kit\"]). If none required, return an empty array [].\n" +
      "7. \"confidence_score\": Float. Rate your confidence in this extraction between 0.00 and 1.00 based on the clarity and completeness of the input.";

    let jsonString = '';

    // Check if OpenRouter API Key is available
    if (openrouterConfig.apiKey) {
      try {
        const response = await fetch(`${openrouterConfig.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${openrouterConfig.apiKey}`,
            'HTTP-Referer': openrouterConfig.referer,
            'X-Title': openrouterConfig.title
          },
          body: JSON.stringify({
            model: openrouterConfig.model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: transcript }
            ],
            temperature: 0.0 // Low temperature for high factual accuracy
          })
        });

        if (!response.ok) {
          throw new Error(`OpenRouter API responded with status ${response.status}`);
        }

        const data = await response.json();
        jsonString = data.choices[0]?.message?.content || '';
      } catch (err) {
        console.warn('OpenRouter API request failed, trying Groq fallback...', err.message);
        jsonString = await this._fallbackToGroq(systemPrompt, transcript);
      }
    } else {
      // Direct fallback to Groq Llama 3 if OpenRouter Key is missing
      jsonString = await this._fallbackToGroq(systemPrompt, transcript);
    }

    return this._parseAndValidate(jsonString, transcript);
  }

  /**
   * Fallback using Groq LLM Chat completion
   */
  async _fallbackToGroq(systemPrompt, transcript) {
    try {
      const response = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: transcript }
        ],
        temperature: 0.0
      });
      return response.choices[0]?.message?.content || '';
    } catch (err) {
      throw new Error(`Extraction fallback API failed: ${err.message}`);
    }
  }

  /**
   * Parse the raw string response and validate types and enums
   */
  _parseAndValidate(jsonString, rawTranscript) {
    // 1. Clean markdown JSON blocks if returned
    let cleanStr = jsonString.trim();
    if (cleanStr.startsWith('```')) {
      cleanStr = cleanStr.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
    }

    let parsed = {};
    try {
      parsed = JSON.parse(cleanStr);
    } catch (err) {
      console.error('Failed to parse JSON returned from LLM. Raw output was:', jsonString);
      // Fallback object if LLM output was completely un-parseable JSON
      return {
        equipment_id: null,
        location: null,
        fault_code: null,
        severity: 'MEDIUM',
        action_taken: null,
        parts_required: [],
        confidence_score: 0.00,
        exception_flag: true,
        raw_output: jsonString
      };
    }

    // 2. Validate Severity Enum
    let severity = 'MEDIUM';
    if (parsed.severity && typeof parsed.severity === 'string') {
      const upperSev = parsed.severity.toUpperCase().trim();
      if (ALLOWED_SEVERITIES.includes(upperSev)) {
        severity = upperSev;
      }
    }

    // 3. Validate Parts Required Array
    let partsRequired = [];
    if (parsed.parts_required && Array.isArray(parsed.parts_required)) {
      partsRequired = parsed.parts_required.filter(p => typeof p === 'string').map(p => p.trim());
    }

    // 4. Validate Confidence Score
    let confidenceScore = 0.50;
    if (typeof parsed.confidence_score === 'number') {
      confidenceScore = Math.max(0.0, Math.min(1.0, parsed.confidence_score));
    }

    // 5. Calculate exception flag:
    // Tag exception if:
    // - confidence_score is low (< 0.70)
    // - equipment_id is missing or null
    // - fault_code is missing or null
    const equipmentId = parsed.equipment_id && typeof parsed.equipment_id === 'string' ? parsed.equipment_id.trim() : null;
    const location = parsed.location && typeof parsed.location === 'string' ? parsed.location.trim() : null;
    const faultCode = parsed.fault_code && typeof parsed.fault_code === 'string' ? parsed.fault_code.trim() : null;
    const actionTaken = parsed.action_taken && typeof parsed.action_taken === 'string' ? parsed.action_taken.trim() : null;

    const exceptionFlag = (confidenceScore < 0.70) || (equipmentId === null) || (faultCode === null);

    return {
      equipment_id: equipmentId,
      location,
      fault_code: faultCode,
      severity,
      action_taken: actionTaken,
      parts_required: partsRequired,
      confidence_score: parseFloat(confidenceScore.toFixed(2)),
      exception_flag: exceptionFlag
    };
  }
}

module.exports = new ExtractionService();
