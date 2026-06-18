const request = require('supertest');
const path = require('path');
const fs = require('fs');
const app = require('../index');
const sttService = require('../services/sttService');

// Mock sttService to isolate route testing
jest.mock('../services/sttService');
jest.mock('../services/ttsService');

describe('Audio Routes Integration Tests', () => {
  const dummyFileDir = path.join(__dirname, 'fixtures');
  const testWav = path.join(dummyFileDir, 'route-test.wav');
  const testTxt = path.join(dummyFileDir, 'route-test.txt');
  const uploadsDir = path.join(__dirname, '..', '..', 'uploads');

  beforeAll(() => {
    // Ensure test directories exist
    if (!fs.existsSync(dummyFileDir)) {
      fs.mkdirSync(dummyFileDir, { recursive: true });
    }
    fs.writeFileSync(testWav, 'dummy wav content');
    fs.writeFileSync(testTxt, 'dummy txt content');
  });

  afterAll(() => {
    // Cleanup fixtures
    if (fs.existsSync(testWav)) fs.unlinkSync(testWav);
    if (fs.existsSync(testTxt)) fs.unlinkSync(testTxt);
    if (fs.existsSync(dummyFileDir)) fs.rmdirSync(dummyFileDir);

    // Clean any files generated in uploads during test run
    if (fs.existsSync(uploadsDir)) {
      const files = fs.readdirSync(uploadsDir);
      for (const file of files) {
        if (file.startsWith('audio-')) {
          fs.unlinkSync(path.join(uploadsDir, file));
        }
      }
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/audio/transcribe', () => {
    test('Should successfully transcribe file and retain it permanently', async () => {
      sttService.transcribe.mockResolvedValue({
        text: 'Oil leakage noticed near Valve V-99.',
        language: 'en',
      });

      const response = await request(app)
        .post('/api/audio/transcribe')
        .attach('audio', testWav);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.text).toBe('Oil leakage noticed near Valve V-99.');
      expect(response.body.file).toHaveProperty('filename');
      expect(response.body.file.storage_path).toContain('/uploads/');

      // Verify permanent storage: file should exist in the backend/uploads directory
      const savedPath = path.join(uploadsDir, response.body.file.filename);
      expect(fs.existsSync(savedPath)).toBe(true);
    });

    test('Should return 400 if no file key "audio" is attached', async () => {
      const response = await request(app)
        .post('/api/audio/transcribe')
        .send({}); // Send empty JSON

      expect(response.status).toBe(400);
      expect(response.body.error_code).toBe('MISSING_FILE');
    });

    test('Should return 400 if file has unsupported extension', async () => {
      const response = await request(app)
        .post('/api/audio/transcribe')
        .attach('audio', testTxt);

      expect(response.status).toBe(400);
      expect(response.body.error_code).toBe('UNSUPPORTED_FORMAT');
    });

    test('Should ignore local_transcript and call sttService when provided', async () => {
      sttService.transcribe.mockResolvedValue({
        text: 'Oil leakage noticed near Valve V-99.',
        language: 'en',
      });

      const response = await request(app)
        .post('/api/audio/transcribe')
        .attach('audio', testWav)
        .field('local_transcript', 'Manual local transcription from mobile client');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.text).toBe('Oil leakage noticed near Valve V-99.');
      expect(response.body.file).toHaveProperty('filename');
      expect(sttService.transcribe).toHaveBeenCalled();
    });
  });

  describe('DELETE /api/audio/:filename', () => {
    test('Should delete a file and return 200 for supervisor request', async () => {
      // Create a dummy file in uploads to delete
      const dummyFilename = 'audio-temp-delete-test.wav';
      const dummyPath = path.join(uploadsDir, dummyFilename);
      fs.writeFileSync(dummyPath, 'temp audio');

      const response = await request(app)
        .delete(`/api/audio/${dummyFilename}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('successfully deleted');
      expect(fs.existsSync(dummyPath)).toBe(false);
    });

    test('Should return 404 if file does not exist', async () => {
      const response = await request(app)
        .delete('/api/audio/audio-nonexistent-9999.wav');

      expect(response.status).toBe(404);
      expect(response.body.error_code).toBe('FILE_NOT_FOUND');
    });

    test('Should block directory traversal attacks with 400', async () => {
      const response = await request(app)
        .delete('/api/audio/%2e%2e%2fsrc%2findex.js');

      expect(response.status).toBe(400);
      expect(response.body.error_code).toBe('INVALID_FILENAME');
    });
  });

  describe('POST /api/audio/tts', () => {
    test('Should successfully synthesize text to speech', async () => {
      const ttsService = require('../services/ttsService');
      ttsService.synthesize.mockResolvedValue('/uploads/speech-mock.mp3');

      const response = await request(app)
        .post('/api/audio/tts')
        .send({ text: 'Inspection started' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.tts_audio_url).toBe('/uploads/speech-mock.mp3');
      expect(ttsService.synthesize).toHaveBeenCalledWith('Inspection started');
    });

    test('Should return 400 if text is missing', async () => {
      const response = await request(app)
        .post('/api/audio/tts')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error_code).toBe('MISSING_TEXT');
    });

    test('Should return 400 if text is empty', async () => {
      const response = await request(app)
        .post('/api/audio/tts')
        .send({ text: ' ' });

      expect(response.status).toBe(400);
      expect(response.body.error_code).toBe('MISSING_TEXT');
    });
  });
});
