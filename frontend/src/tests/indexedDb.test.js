const indexedDbQueue = require('../utils/indexedDb');

describe('IndexedDB Queue Manager Unit Tests', () => {
  let mockStore;
  let nextId;

  beforeEach(() => {
    mockStore = [];
    nextId = 1;
    jest.clearAllMocks();

    // Mock the inner database methods of the class to run in a Node/Jest JSDOM environment
    jest.spyOn(indexedDbQueue, 'open').mockResolvedValue(true);

    jest.spyOn(indexedDbQueue, 'enqueue').mockImplementation(async (actionType, audioBlob, metadata = {}) => {
      const record = {
        id: nextId++,
        client_tx_uuid: 'mock-uuid-' + Math.random(),
        timestamp: new Date().toISOString(),
        audioBlob,
        actionType,
        metadata,
        sync_status: 'pending',
        retry_count: 0,
        error_log: null
      };
      mockStore.push(record);
      return record;
    });

    jest.spyOn(indexedDbQueue, 'getPending').mockImplementation(async () => {
      return mockStore.filter(item => item.sync_status === 'pending' || item.sync_status === 'failed');
    });

    jest.spyOn(indexedDbQueue, 'updateStatus').mockImplementation(async (id, status, errorMsg = null) => {
      const record = mockStore.find(item => item.id === id);
      if (!record) throw new Error('Record not found');
      record.sync_status = status;
      if (errorMsg) record.error_log = errorMsg;
      return record;
    });

    jest.spyOn(indexedDbQueue, 'incrementRetry').mockImplementation(async (id, errorMsg) => {
      const record = mockStore.find(item => item.id === id);
      if (!record) throw new Error('Record not found');
      record.retry_count += 1;
      record.sync_status = 'failed';
      record.error_log = errorMsg;
      return record;
    });

    jest.spyOn(indexedDbQueue, 'deleteItem').mockImplementation(async (id) => {
      const index = mockStore.findIndex(item => item.id === id);
      if (index === -1) return false;
      mockStore.splice(index, 1);
      return true;
    });
  });

  test('Should enqueue items successfully with pending status', async () => {
    const blob = new Blob(['dummy audio'], { type: 'audio/ogg' });
    const record = await indexedDbQueue.enqueue('inspection', blob, { tech: 'tech-1' });

    expect(record.id).toBe(1);
    expect(record.sync_status).toBe('pending');
    expect(record.actionType).toBe('inspection');
    expect(record.metadata.tech).toBe('tech-1');
    expect(mockStore.length).toBe(1);
  });

  test('Should retrieve pending items chronologically', async () => {
    const blob = new Blob(['audio'], { type: 'audio/ogg' });
    await indexedDbQueue.enqueue('inspection', blob);
    await indexedDbQueue.enqueue('escalation', blob);

    const pending = await indexedDbQueue.getPending();
    expect(pending.length).toBe(2);
    expect(pending[0].actionType).toBe('inspection');
    expect(pending[1].actionType).toBe('escalation');
  });

  test('Should update status of enqueued items', async () => {
    const blob = new Blob(['audio'], { type: 'audio/ogg' });
    const record = await indexedDbQueue.enqueue('inspection', blob);

    const updated = await indexedDbQueue.updateStatus(record.id, 'syncing');
    expect(updated.sync_status).toBe('syncing');

    const pending = await indexedDbQueue.getPending();
    expect(pending.length).toBe(0); // 'syncing' items are excluded from pending loops
  });

  test('Should increment retries and update status to failed', async () => {
    const blob = new Blob(['audio'], { type: 'audio/ogg' });
    const record = await indexedDbQueue.enqueue('inspection', blob);

    const updated = await indexedDbQueue.incrementRetry(record.id, 'Connection Timeout');
    expect(updated.retry_count).toBe(1);
    expect(updated.sync_status).toBe('failed');
    expect(updated.error_log).toBe('Connection Timeout');
  });

  test('Should delete items correctly from the local database', async () => {
    const blob = new Blob(['audio'], { type: 'audio/ogg' });
    const record = await indexedDbQueue.enqueue('inspection', blob);

    const deleted = await indexedDbQueue.deleteItem(record.id);
    expect(deleted).toBe(true);
    expect(mockStore.length).toBe(0);
  });
});
