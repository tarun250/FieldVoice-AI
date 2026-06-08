import { useState, useEffect, useCallback, useRef } from 'react';
const indexedDbQueue = require('../utils/indexedDb');

/**
 * Custom React Hook to manage offline queue state and network synchronization
 * @param {string} uploadUrl - API endpoint to POST sync data
 * @returns {object} - { isOnline, isSyncing, pendingCount, enqueueItem, triggerSync }
 */
export default function useSync(uploadUrl = '/api/audio/transcribe') {
  const [isOnline, setIsOnline] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const isSyncingRef = useRef(false);

  // Helper to refresh the count of pending items
  const refreshPendingCount = useCallback(async () => {
    try {
      if (typeof window !== 'undefined') {
        const pending = await indexedDbQueue.getPending();
        setPendingCount(pending.length);
      }
    } catch (err) {
      console.error('Failed to count pending queue items:', err);
    }
  }, []);

  // Main background synchronization loop
  const triggerSync = useCallback(async () => {
    if (typeof window === 'undefined' || isSyncingRef.current || !navigator.onLine) {
      return;
    }

    isSyncingRef.current = true;
    setIsSyncing(true);

    try {
      while (navigator.onLine) {
        const pending = await indexedDbQueue.getPending();
        if (pending.length === 0) {
          break; // Queue is empty, exit sync loop
        }

        const item = pending[0]; // First-In-First-Out (FIFO)

        // Conflict Resolution: Skip item if max retries exceeded to prevent blocking queue
        if (item.retry_count >= 5) {
          console.warn(`Skipping item ${item.client_tx_uuid} due to max retries exceeded.`);
          await indexedDbQueue.updateStatus(item.id, 'failed_permanently', 'Max retries exceeded (5/5). Supervisor review required.');
          await refreshPendingCount();
          continue; 
        }

        // Set status to syncing
        await indexedDbQueue.updateStatus(item.id, 'syncing');

        // Build Multipart Form Payload
        const formData = new FormData();
        const isBlob = typeof Blob !== 'undefined' && item.audioBlob instanceof Blob;
        if (isBlob) {
          formData.append('audio', item.audioBlob, `audio-${item.client_tx_uuid}.ogg`);
        } else {
          formData.append('audio', item.audioBlob || '');
        }
        formData.append('client_tx_uuid', item.client_tx_uuid);
        formData.append('timestamp', item.timestamp);
        formData.append('action_type', item.actionType);
        formData.append('metadata', JSON.stringify(item.metadata));

        try {
          const response = await fetch(uploadUrl, {
            method: 'POST',
            body: formData
          });

          // Handle Conflict/Duplicate: Code 409 means server already processed it
          if (response.status === 200 || response.status === 201 || response.status === 409) {
            if (response.status === 409) {
              console.info(`Duplicate transaction ${item.client_tx_uuid} skipped on server. Deleting locally.`);
            }
            // Sync success: delete local cache copy
            await indexedDbQueue.deleteItem(item.id);
          } else {
            // Server error (e.g. 500, 503)
            const errorText = await response.text();
            throw new Error(`Server returned status ${response.status}: ${errorText}`);
          }
        } catch (err) {
          console.error(`Sync upload failed for transaction ${item.client_tx_uuid}:`, err.message);
          
          // Increment retry counter
          await indexedDbQueue.incrementRetry(item.id, err.message);
          
          // Exponential backoff wait (capped at 30 seconds, bypass during tests)
          const isTest = typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'test';
          const waitTime = isTest ? 0 : Math.min(30000, Math.pow(2, item.retry_count + 1) * 1000);
          console.info(`Backing off sync loop for ${waitTime}ms...`);
          if (waitTime > 0) {
            await new Promise(resolve => setTimeout(resolve, waitTime));
          }
          
          break; // Stop loop and retry on next connection trigger or manual sync
        }

        await refreshPendingCount();
      }
    } catch (err) {
      console.error('Unexpected error in sync loop:', err);
    } finally {
      isSyncingRef.current = false;
      setIsSyncing(false);
      await refreshPendingCount();
    }
  }, [uploadUrl, refreshPendingCount]);

  // Enqueue item helper
  const enqueueItem = useCallback(async (actionType, audioBlob, metadata = {}) => {
    try {
      const record = await indexedDbQueue.enqueue(actionType, audioBlob, metadata);
      await refreshPendingCount();
      // Trigger sync if currently online
      if (navigator.onLine) {
        triggerSync();
      }
      return record;
    } catch (err) {
      console.error('Failed to enqueue item:', err);
      throw err;
    }
  }, [triggerSync, refreshPendingCount]);

  // Monitor connection states
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleOnline = () => {
      setIsOnline(true);
      triggerSync();
    };

    const handleOffline = () => {
      setIsOnline(false);
    };

    // Set initial state
    setIsOnline(navigator.onLine);
    refreshPendingCount();

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Initial sync check if we are online on mount
    if (navigator.onLine) {
      triggerSync();
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [triggerSync, refreshPendingCount]);

  return {
    isOnline,
    isSyncing,
    pendingCount,
    enqueueItem,
    triggerSync
  };
}
