const fs = require('fs');
const path = require('path');
const sttService = require('../services/sttService');
const groqMock = require('../config/groq');

// Mock the groq-sdk configuration
jest.mock('../config/groq', () => {
  return {
    audio: {
      transcriptions: {
        create: jest.fn(),
      },
    },
  };
});

describe('Speech-to-Text Service Unit Tests', () => {
  const dummyFileDir = path.join(__dirname, 'fixtures');
  const validFile = path.join(dummyFileDir, 'test.wav');
  const invalidFile = path.join(dummyFileDir, 'test.txt');

  beforeAll(() => {
    // Create fixtures folder and dummy test files
    if (!fs.existsSync(dummyFileDir)) {
      fs.mkdirSync(dummyFileDir, { recursive: true });
    }
    fs.writeFileSync(validFile, 'dummy wav content');
    fs.writeFileSync(invalidFile, 'dummy text content');
  });

  afterAll(() => {
    // Cleanup files
    if (fs.existsSync(validFile)) fs.unlinkSync(validFile);
    if (fs.existsSync(invalidFile)) fs.unlinkSync(invalidFile);
    if (fs.existsSync(dummyFileDir)) fs.rmdirSync(dummyFileDir);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(fs, 'createReadStream').mockImplementation(() => {
      const { Readable } = require('stream');
      return Readable.from(['dummy audio stream']);
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('Should throw error if file does not exist', async () => {
    const fakePath = path.join(__dirname, 'nonexistent.wav');
    await expect(sttService.transcribe(fakePath)).rejects.toThrow('Audio file not found');
  });

  test('Should throw error for unsupported extensions', async () => {
    await expect(sttService.transcribe(invalidFile)).rejects.toThrow('Unsupported audio format');
  });

  test('Should throw error if file exceeds size limit (25MB)', async () => {
    // Mock fs.statSync to return large file size
    const statMock = jest.spyOn(fs, 'statSync').mockReturnValue({ size: 30 * 1024 * 1024 });

    await expect(sttService.transcribe(validFile)).rejects.toThrow('exceeds limit of 25MB');

    statMock.mockRestore();
  });

  test('Should return text and language on successful transcription', async () => {
    // Mock Groq API response
    groqMock.audio.transcriptions.create.mockResolvedValue({
      text: 'Generator T-402 is showing high vibration.',
      language: 'en',
    });

    const result = await sttService.transcribe(validFile);

    expect(result.text).toBe('Generator T-402 is showing high vibration.');
    expect(result.language).toBe('en');
    expect(groqMock.audio.transcriptions.create).toHaveBeenCalledTimes(1);
    expect(groqMock.audio.transcriptions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'whisper-large-v3-turbo',
        temperature: 0.0,
      })
    );
  });
});
