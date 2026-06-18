const extractionService = require('../services/extractionService');
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
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('Should extract fields correctly on successful Groq response', async () => {
    const mockOutput = {
      equipment_id: 'P-101',
      location: 'Basement Sump',
      fault_code: 'F-LEAK-OIL',
      severity: 'HIGH',
      action_taken: 'Isolated pump valves',
      parts_required: ['Seal Kit', 'O-Ring'],
      confidence_score: 0.92
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

    const result = await extractionService.extract('Pump P-101 in Basement Sump has a major oil leak. I closed the valves.');

    expect(result.equipment_id).toBe('P-101');
    expect(result.location).toBe('Basement Sump');
    expect(result.severity).toBe('HIGH');
    expect(result.exception_flag).toBe(false);
    expect(groqMock.chat.completions.create).toHaveBeenCalledTimes(1);
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

    groqMock.chat.completions.create.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify(mockOutput)
          }
        }
      ]
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

    groqMock.chat.completions.create.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify(mockOutput)
          }
        }
      ]
    });

    const result = await extractionService.extract('Something is hot on generator 501.');

    expect(result.exception_flag).toBe(true);
  });
});
