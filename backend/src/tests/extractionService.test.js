const extractionService = require('../services/extractionService');
const openrouterConfig = require('../config/openrouter');
const groqMock = require('../config/groq');

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

describe('Structured Extraction Service Unit Tests', () => {
  let originalFetch;

  beforeAll(() => {
    originalFetch = global.fetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    openrouterConfig.apiKey = 'mock-openrouter-key';
  });

  test('Should extract fields correctly on successful OpenRouter response', async () => {
    const mockOutput = {
      equipment_id: 'P-101',
      location: 'Basement Sump',
      fault_code: 'F-LEAK-OIL',
      severity: 'HIGH',
      action_taken: 'Isolated pump valves',
      parts_required: ['Seal Kit', 'O-Ring'],
      confidence_score: 0.92
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify(mockOutput)
            }
          }
        ]
      })
    });

    const result = await extractionService.extract('Pump P-101 in Basement Sump has a major oil leak. I closed the valves.');

    expect(result.equipment_id).toBe('P-101');
    expect(result.location).toBe('Basement Sump');
    expect(result.severity).toBe('HIGH');
    expect(result.exception_flag).toBe(false);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('Should handle invalid severity enums and default to MEDIUM', async () => {
    const mockOutput = {
      equipment_id: 'T-402',
      location: 'Turbine Room B',
      fault_code: 'F-MECH-VIB',
      severity: 'SUPER_URGENT', // Invalid severity
      action_taken: 'None',
      parts_required: [],
      confidence_score: 0.85
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify(mockOutput)
            }
          }
        ]
      })
    });

    const result = await extractionService.extract('Turbine T-402 has high vibration.');

    expect(result.severity).toBe('MEDIUM'); // Cleaned default
    expect(result.exception_flag).toBe(false);
  });

  test('Should raise exception_flag if confidence_score is low (< 0.70)', async () => {
    const mockOutput = {
      equipment_id: 'GEN-501',
      location: 'Roof Deck',
      fault_code: 'F-THERM-HOT',
      severity: 'CRITICAL',
      action_taken: 'None',
      parts_required: [],
      confidence_score: 0.55 // Low confidence
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(mockOutput) } }]
      })
    });

    const result = await extractionService.extract('Something is hot on generator 501.');

    expect(result.exception_flag).toBe(true);
  });

  test('Should fallback to Groq Llama 3 if OpenRouter API call fails', async () => {
    // Force OpenRouter fetch to fail
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500
    });

    // Mock successful Groq fallback response
    const mockOutput = {
      equipment_id: 'V-99',
      location: 'Valve Pit 4',
      fault_code: 'F-ELEC-SHORT',
      severity: 'CRITICAL',
      action_taken: 'Isolated power breaker',
      parts_required: ['Fuse'],
      confidence_score: 0.95
    };

    groqMock.chat.completions.create.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify(mockOutput)
          }
        }
      ]
    });

    const result = await extractionService.extract('Valve V-99 is short-circuited.');

    expect(result.equipment_id).toBe('V-99');
    expect(result.severity).toBe('CRITICAL');
    expect(result.exception_flag).toBe(false);
    expect(groqMock.chat.completions.create).toHaveBeenCalledTimes(1);
  });
});
