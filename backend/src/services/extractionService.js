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

    const jsonString = await this._fallbackToGroq(systemPrompt, transcript);

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

  /**
   * Update current structured data based on a change request transcript
   * @param {object} currentData - The current structured JSON fields
   * @param {string} changeRequest - The plain text change request (e.g. "change severity to critical")
   * @returns {Promise<object>} - The updated structured JSON object
   */
  async update(currentData, changeRequest) {
    if (!currentData || typeof currentData !== 'object') {
      throw new Error('Current data must be an object');
    }
    if (!changeRequest || typeof changeRequest !== 'string' || changeRequest.trim() === '') {
      throw new Error('Change request must be a non-empty string');
    }

    const systemPrompt = 
      "You are an expert industrial system parser. You are given:\n" +
      "1. A JSON object representing the current extracted fields of a work order.\n" +
      "2. A user correction/change request instruction (e.g., \"change equipment to P-101\", \"add seal kit to parts\", \"severity is low\").\n" +
      "Your task is to apply the requested changes to the JSON object and return the updated JSON object.\n" +
      "You must output ONLY a valid JSON object. Do not include markdown code block syntax (like ```json), commentary, or extra text.\n" +
      "The JSON object must contain the following keys exactly:\n" +
      "1. \"equipment_id\": String (or null)\n" +
      "2. \"location\": String (or null)\n" +
      "3. \"fault_code\": String (or null)\n" +
      "4. \"severity\": String (Must be exactly one of: \"LOW\", \"MEDIUM\", \"HIGH\", \"CRITICAL\")\n" +
      "5. \"action_taken\": String (or null)\n" +
      "6. \"parts_required\": Array of strings\n" +
      "7. \"confidence_score\": Float (confidence score between 0.00 and 1.00)";

    const userPrompt = 
      `Current Data: ${JSON.stringify(currentData)}\n` +
      `Change Request: "${changeRequest}"`;

    const jsonString = await this._fallbackToGroq(systemPrompt, userPrompt);

    return this._parseAndValidate(jsonString, changeRequest);
  }
}

module.exports = new ExtractionService();
