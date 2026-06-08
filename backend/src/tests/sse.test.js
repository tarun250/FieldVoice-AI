const sseManager = require('../utils/sse');

describe('SSE Broadcast Manager Unit Tests', () => {
  let mockRes1;
  let mockRes2;

  beforeEach(() => {
    // Reset clients list before each test to maintain isolation
    sseManager.clients = [];

    mockRes1 = {
      write: jest.fn()
    };
    mockRes2 = {
      write: jest.fn()
    };
  });

  test('Should register a new client response stream', () => {
    sseManager.addClient(mockRes1);
    expect(sseManager.clients.length).toBe(1);
    expect(sseManager.clients[0]).toBe(mockRes1);
  });

  test('Should remove a registered client response stream', () => {
    sseManager.addClient(mockRes1);
    sseManager.addClient(mockRes2);
    expect(sseManager.clients.length).toBe(2);

    sseManager.removeClient(mockRes1);
    expect(sseManager.clients.length).toBe(1);
    expect(sseManager.clients[0]).toBe(mockRes2);
  });

  test('Should broadcast text data chunks to all registered client streams', () => {
    sseManager.addClient(mockRes1);
    sseManager.addClient(mockRes2);

    const eventType = 'test-event';
    const payload = { msg: 'hello' };

    sseManager.broadcast(eventType, payload);

    expect(mockRes1.write).toHaveBeenCalledTimes(1);
    expect(mockRes2.write).toHaveBeenCalledTimes(1);

    const expectedChunk = `data: ${JSON.stringify({ type: eventType, payload })}\n\n`;
    expect(mockRes1.write).toHaveBeenCalledWith(expectedChunk);
    expect(mockRes2.write).toHaveBeenCalledWith(expectedChunk);
  });
});
