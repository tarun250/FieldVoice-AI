const queryService = require('../services/queryService');
const groqMock = require('../config/groq');
const childProcess = require('child_process');
const { Readable } = require('stream');

// Mock Groq configuration
jest.mock('../config/groq', () => {
  return {
    chat: {
      completions: {
        create: jest.fn()
      }
    }
  };
});

describe('RAG Query Service Unit Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  test('Should resolve query using simulated Python FAISS vector search and Groq', async () => {
    const mockFAISSOutput = [
      {
        equipment_id: 'T-402',
        title: 'Turbine T-402 Operating Specifications',
        content: 'Turbine T-402 has a maximum operating pressure limit of 150 PSI.',
        score: 0.89
      }
    ];

    // Mock spawn to simulate successful python FAISS execution
    const mockSpawn = {
      stdin: {
        write: jest.fn(),
        end: jest.fn()
      },
      stdout: new Readable({
        read() {
          this.push(JSON.stringify(mockFAISSOutput));
          this.push(null);
        }
      }),
      stderr: new Readable({
        read() {
          this.push(null);
        }
      }),
      on: jest.fn().mockImplementation((event, cb) => {
        if (event === 'close') {
          // Immediately invoke exit code callback
          setTimeout(() => cb(0), 10);
        }
      })
    };

    jest.spyOn(childProcess, 'spawn').mockReturnValue(mockSpawn);

    // Mock Groq LLM response
    groqMock.chat.completions.create.mockResolvedValue({
      choices: [
        {
          message: {
            content: 'The operating pressure limit for Turbine T-402 is 150 PSI.'
          }
        }
      ]
    });

    const result = await queryService.resolveQuery('What is the pressure limit for T-402?', 'tech-1');

    expect(result.answer).toBe('The operating pressure limit for Turbine T-402 is 150 PSI.');
    expect(result.source_chunks).toContain('Turbine T-402 Operating Specifications');
    expect(result.source).toBe('faiss');
    expect(childProcess.spawn).toHaveBeenCalledTimes(1);
    expect(groqMock.chat.completions.create).toHaveBeenCalledTimes(1);
  });

  test('Should execute Node keyword search fallback when Python spawn throws error', async () => {
    // Force spawn to throw an error (simulating python not installed)
    jest.spyOn(childProcess, 'spawn').mockImplementation(() => {
      const emitter = new (require('events').EventEmitter)();
      setTimeout(() => emitter.emit('error', new Error('spawn ENOENT')), 5);
      return {
        stdout: new Readable({ read() {} }),
        stderr: new Readable({ read() {} }),
        on: (event, cb) => emitter.on(event, cb)
      };
    });

    // Mock Groq LLM response
    groqMock.chat.completions.create.mockResolvedValue({
      choices: [
        {
          message: {
            content: 'The casing pressure rating for Water Pump P-101 is 250 PSI.'
          }
        }
      ]
    });

    // Ask about P-101 (should hit our keyword matching over manuals.json)
    const result = await queryService.resolveQuery('What is the casing pressure for P-101?', 'tech-1');

    expect(result.answer).toBe('The casing pressure rating for Water Pump P-101 is 250 PSI.');
    expect(result.source_chunks).toContain('Water Pump P-101 Casing & Flow Specifications');
    expect(result.source).toBe('keyword'); // Verified fallback triggered
  });

  test('Should trigger safety timeout and kill child process if Python process hangs', async () => {
    jest.useFakeTimers();
    const mockKill = jest.fn();
    const mockSpawn = {
      stdin: {
        write: jest.fn(),
        end: jest.fn()
      },
      stdout: new Readable({ read() {} }),
      stderr: new Readable({ read() {} }),
      on: jest.fn(),
      kill: mockKill
    };

    jest.spyOn(childProcess, 'spawn').mockReturnValue(mockSpawn);

    // Mock Groq LLM response
    groqMock.chat.completions.create.mockResolvedValue({
      choices: [
        {
          message: {
            content: 'The operating pressure limit for Turbine T-402 is 150 PSI.'
          }
        }
      ]
    });

    const queryPromise = queryService.resolveQuery('What is the pressure limit for T-402?', 'tech-1');
    
    // Fast-forward time to trigger timeout
    jest.advanceTimersByTime(5000);
    
    const result = await queryPromise;

    expect(mockKill).toHaveBeenCalledWith('SIGKILL');
    expect(result.source).toBe('keyword'); // Switched to keyword fallback
    expect(result.answer).toBe('The operating pressure limit for Turbine T-402 is 150 PSI.');

    jest.useRealTimers();
  });
});
