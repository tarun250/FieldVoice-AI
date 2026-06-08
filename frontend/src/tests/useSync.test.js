import { renderHook, act } from '@testing-library/react';
import useSync from '../hooks/useSync';
const indexedDbQueue = require('../utils/indexedDb');

// Mock IndexedDbQueue to isolate hook state testing
jest.mock('../utils/indexedDb', () => {
  return {
    getPending: jest.fn(),
    updateStatus: jest.fn(),
    incrementRetry: jest.fn(),
    deleteItem: jest.fn(),
    enqueue: jest.fn()
  };
});

describe('useSync Hook Unit Tests', () => {
  let originalFetch;
  let originalOnLine;

  beforeAll(() => {
    originalFetch = global.fetch;
    originalOnLine = Object.getOwnPropertyDescriptor(navigator, 'onLine');
  });

  afterAll(() => {
    global.fetch = originalFetch;
    if (originalOnLine) {
      Object.defineProperty(navigator, 'onLine', originalOnLine);
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Default online state
    Object.defineProperty(navigator, 'onLine', {
      value: true,
      writable: true,
      configurable: true
    });
    // Default fetch mock to prevent crashes on mount
    global.fetch = jest.fn().mockResolvedValue({
      status: 200,
      text: async () => 'OK'
    });
    // Default getPending implementation to prevent returning undefined
    indexedDbQueue.getPending.mockResolvedValue([]);
  });

  test('Should initialize with correct connection status and pending count', async () => {
    indexedDbQueue.getPending.mockResolvedValue([
      { id: 1, client_tx_uuid: 'uuid-1', sync_status: 'pending', retry_count: 0 }
    ]);

    // Reject fetch to simulate temporary sync failure, preserving pendingCount at 1
    global.fetch = jest.fn().mockRejectedValue(new Error('Connection error'));

    let hookResult;
    await act(async () => {
      const { result } = renderHook(() => useSync('/api/audio/transcribe'));
      hookResult = result;
    });

    expect(hookResult.current.isOnline).toBe(true);
    expect(hookResult.current.pendingCount).toBe(1);
    expect(indexedDbQueue.getPending).toHaveBeenCalled();
  });

  test('Should sync pending items successfully and delete them locally on HTTP 200', async () => {
    const pendingItem = {
      id: 42,
      client_tx_uuid: 'uuid-42',
      timestamp: '2026-06-08T12:00:00Z',
      audioBlob: new Blob(['audio'], { type: 'audio/ogg' }),
      actionType: 'inspection',
      metadata: {},
      retry_count: 0
    };

    let queue = [pendingItem];
    indexedDbQueue.getPending.mockImplementation(async () => queue);
    indexedDbQueue.deleteItem.mockImplementation(async (id) => {
      queue = queue.filter(item => item.id !== id);
    });

    global.fetch = jest.fn().mockResolvedValue({
      status: 200,
      text: async () => 'Success'
    });

    await act(async () => {
      renderHook(() => useSync('/api/audio/transcribe'));
    });

    expect(indexedDbQueue.updateStatus).toHaveBeenCalledWith(42, 'syncing');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(indexedDbQueue.deleteItem).toHaveBeenCalledWith(42);
  });

  test('Should resolve conflict by deleting local item on HTTP 409 Duplicate', async () => {
    const pendingItem = {
      id: 43,
      client_tx_uuid: 'uuid-43',
      timestamp: '2026-06-08T12:00:00Z',
      audioBlob: new Blob(['audio'], { type: 'audio/ogg' }),
      actionType: 'escalation',
      metadata: {},
      retry_count: 0
    };

    let queue = [pendingItem];
    indexedDbQueue.getPending.mockImplementation(async () => queue);
    indexedDbQueue.deleteItem.mockImplementation(async (id) => {
      queue = queue.filter(item => item.id !== id);
    });

    global.fetch = jest.fn().mockResolvedValue({
      status: 409, // Conflict / Duplicate UUID
      text: async () => 'Conflict: Duplicate UUID'
    });

    await act(async () => {
      renderHook(() => useSync('/api/audio/transcribe'));
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(indexedDbQueue.deleteItem).toHaveBeenCalledWith(43); // Verified: safely deleted locally to clear lock
  });

  test('Should halt sync loop and increment retry count on network timeout', async () => {
    const pendingItem = {
      id: 44,
      client_tx_uuid: 'uuid-44',
      timestamp: '2026-06-08T12:00:00Z',
      audioBlob: new Blob(['audio']),
      actionType: 'inspection',
      metadata: {},
      retry_count: 0
    };

    indexedDbQueue.getPending.mockResolvedValue([pendingItem]);

    // Force fetch to reject (simulate offline or DNS timeout)
    global.fetch = jest.fn().mockRejectedValue(new Error('TypeError: Failed to fetch'));

    let hookResult;
    await act(async () => {
      const { result } = renderHook(() => useSync('/api/audio/transcribe'));
      hookResult = result;
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(indexedDbQueue.incrementRetry).toHaveBeenCalledWith(44, 'TypeError: Failed to fetch');
    expect(indexedDbQueue.deleteItem).not.toHaveBeenCalled();
    expect(hookResult.current.isSyncing).toBe(false);
  });

  test('Should transition status to failed_permanently and skip execution when max retries (>= 5) is exceeded', async () => {
    const failedItem = {
      id: 45,
      client_tx_uuid: 'uuid-45',
      timestamp: '2026-06-08T12:00:00Z',
      audioBlob: new Blob(['audio']),
      actionType: 'inspection',
      metadata: {},
      retry_count: 5
    };

    let queue = [failedItem];
    indexedDbQueue.getPending.mockImplementation(async () => queue);
    indexedDbQueue.updateStatus.mockImplementation(async (id, status, errorMsg) => {
      if (status === 'failed_permanently') {
        queue = queue.filter(item => item.id !== id);
      }
      return { id, sync_status: status, error_log: errorMsg };
    });

    await act(async () => {
      renderHook(() => useSync('/api/audio/transcribe'));
    });

    expect(indexedDbQueue.updateStatus).toHaveBeenCalledWith(45, 'failed_permanently', expect.stringContaining('Max retries exceeded'));
    expect(global.fetch).not.toHaveBeenCalled();
    expect(indexedDbQueue.deleteItem).not.toHaveBeenCalled();
  });
});
