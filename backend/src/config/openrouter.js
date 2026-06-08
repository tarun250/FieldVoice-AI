require('dotenv').config();

const apiKey = process.env.OPENROUTER_API_KEY;

if (!apiKey) {
  console.warn('WARNING: OPENROUTER_API_KEY environment variable is not defined.');
}

module.exports = {
  apiKey,
  baseUrl: 'https://openrouter.ai/api/v1',
  model: process.env.OPENROUTER_MODEL || 'nvidia/nemotron-3-super-120b-a12b:free',
  referer: 'http://localhost:3000',
  title: 'FieldVoice AI'
};
