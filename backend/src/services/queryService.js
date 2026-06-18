const childProcess = require('child_process');
const path = require('path');
const fs = require('fs');
const openrouterConfig = require('../config/openrouter');
const groq = require('../config/groq');

/**
 * Service to manage vector-enhanced RAG Q&A procedures
 */
class QueryService {
  /**
   * Resolve a technician voice question using RAG
   * @param {string} queryText - Spoken query text
   * @param {string} technicianId - Submitting technician UUID
   * @returns {Promise<{answer: string, source_chunks: string[], source: 'faiss' | 'keyword'}>}
   */
  async resolveQuery(queryText, technicianId) {
    if (!queryText || typeof queryText !== 'string' || queryText.trim() === '') {
      throw new Error('Query text must be a non-empty string');
    }

    let chunks = [];
    let source = 'faiss';

    // 1. Attempt local Python FAISS Vector Search
    try {
      chunks = await this._queryFAISS(queryText);
    } catch (err) {
      console.warn('Local Python FAISS search failed, executing Node keyword fallback...', err.message);
      chunks = this._queryKeywordFallback(queryText);
      source = 'keyword';
    }

    if (chunks.length === 0) {
      return {
        answer: "I do not have the specifications or history for that asset in my database.",
        source_chunks: [],
        source
      };
    }

    // 2. Synthesize conversational voice answer from context
    const contextText = chunks.map(c => `[${c.title}]: ${c.content}`).join('\n\n');
    const systemPrompt = 
      "You are a voice-first AI assistant for field technicians working on noisy floors.\n" +
      "Your task is to answer the technician's question using ONLY the provided technical context.\n" +
      "You must be concise and direct. Limit the answer to 2 or 3 short sentences maximum.\n" +
      "Design the answer specifically for vocal readout (TTS). Do not use bullet points, tables, lists, or markdown symbols like bold asterisks. Use plain spoken English.\n" +
      "If the context does not contain the answer, say: \"I do not have that information in my database.\"";

    const userPrompt = `Context:\n${contextText}\n\nQuestion: ${queryText}`;

    const answer = await this._fallbackToGroq(systemPrompt, userPrompt);

    return {
      answer: answer.trim(),
      source_chunks: chunks.map(c => c.title),
      source
    };
  }

  /**
   * Run the python FAISS helper script via child process
   */
  _queryFAISS(queryText) {
    return new Promise((resolve, reject) => {
      const scriptPath = path.join(__dirname, 'rag_engine.py');
      // Spawn python without passing user strings in CLI arguments (mitigates argument injection)
      const pythonProcess = childProcess.spawn('python', [scriptPath]);

      let stdoutData = '';
      let stderrData = '';

      // Safety timeout (5 seconds) to prevent process leaks
      const timeout = setTimeout(() => {
        console.error('Python FAISS process timed out, killing process...');
        try {
          pythonProcess.kill('SIGKILL');
        } catch (e) {
          console.error('Failed to kill Python process:', e.message);
        }
        reject(new Error('Python FAISS process timed out (5s limit)'));
      }, 5000);

      // Write parameters as JSON to stdin
      try {
        if (pythonProcess.stdin) {
          const payload = JSON.stringify({ query: queryText, k: 2 });
          pythonProcess.stdin.write(payload);
          pythonProcess.stdin.end();
        }
      } catch (err) {
        clearTimeout(timeout);
        return reject(new Error(`Failed to write to Python stdin: ${err.message}`));
      }

      pythonProcess.stdout.on('data', (data) => {
        stdoutData += data.toString();
      });

      pythonProcess.stderr.on('data', (data) => {
        stderrData += data.toString();
      });

      pythonProcess.on('close', (code) => {
        clearTimeout(timeout);
        if (code !== 0) {
          return reject(new Error(`Python process exited with code ${code}. Stderr: ${stderrData.trim()}`));
        }

        try {
          const parsed = JSON.parse(stdoutData);
          if (parsed.error) {
            return reject(new Error(parsed.error));
          }
          resolve(parsed);
        } catch (err) {
          reject(new Error(`Failed to parse Python stdout: ${stdoutData}`));
        }
      });

      pythonProcess.on('error', (err) => {
        clearTimeout(timeout);
        reject(new Error(`Failed to spawn Python process: ${err.message}`));
      });
    });
  }

  /**
   * In-memory keyword overlap backup matching algorithm
   */
  _queryKeywordFallback(queryText) {
    const manualsPath = path.join(__dirname, '..', 'db', 'seeds', 'manuals.json');
    if (!fs.existsSync(manualsPath)) {
      return [];
    }

    const manuals = JSON.parse(fs.readFileSync(manualsPath, 'utf8'));
    
    // Tokenize query words (strip punctuation, keep length > 2)
    const queryWords = queryText.toLowerCase()
      .split(/\W+/)
      .filter(w => w.length > 2);

    if (queryWords.length === 0) return [];

    const scored = manuals.map(doc => {
      let score = 0;
      
      // Match keywords
      const docKeywords = doc.keywords.map(k => k.toLowerCase());
      for (const word of queryWords) {
        if (docKeywords.includes(word)) score += 3; // High weight for keyword match
        if (doc.content.toLowerCase().includes(word)) score += 1; // Lower weight for raw text match
        if (doc.equipment_id.toLowerCase() === word) score += 5; // Heavy weight for matching exact asset tag
      }

      return { doc, score };
    });

    // Sort descending and return top 2 matching with score > 0
    return scored
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 2)
      .map(item => item.doc);
  }

  /**
   * Groq LLM Query Fallback
   */
  async _fallbackToGroq(systemPrompt, userPrompt) {
    try {
      const response = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile', // Corrected single hyphen
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.0
      });
      return response.choices[0]?.message?.content || '';
    } catch (err) {
      throw new Error(`Query synthesis fallback failed: ${err.message}`);
    }
  }
}

module.exports = new QueryService();
