const Groq = require('groq-sdk');
require('dotenv').config();

const apiKey = process.env.GROQ_API_KEY;

if (!apiKey) {
  console.warn('WARNING: GROQ_API_KEY environment variable is not defined.');
}

const groq = new Groq({ apiKey });

module.exports = groq;
