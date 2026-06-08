/**
 * Browser-side IndexedDB Queue Manager for FieldVoice offline transactions.
 * SSR-safe: will not execute on Node server during hydration.
 */
class IndexedDbQueue {
  constructor() {
    this.dbName = 'FieldVoiceQueueDB';
    this.storeName = 'offline_audio_queue';
    this.db = null;
    this.isBrowser = typeof window !== 'undefined';
  }

  /**
   * Open the database connection
   * @returns {Promise<IDBDatabase>}
   */
  open() {
    return new Promise((resolve, reject) => {
      if (!this.isBrowser) {
        return reject(new Error('IndexedDB is not available on server-side'));
      }

      if (this.db) {
        return resolve(this.db);
      }

      const request = window.indexedDB.open(this.dbName, 1);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, {
            keyPath: 'id',
            autoIncrement: true
          });
          store.createIndex('sync_status', 'sync_status', { unique: false });
          store.createIndex('timestamp', 'timestamp', { unique: false });
          store.createIndex('client_tx_uuid', 'client_tx_uuid', { unique: true });
        }
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve(this.db);
      };

      request.onerror = (event) => {
        reject(new Error(`Failed to open IndexedDB: ${event.target.error?.message}`));
      };
    });
  }

  /**
   * Add a new voice transaction to the queue
   * @param {string} actionType - 'inspection' | 'escalation'
   * @param {Blob} audioBlob - Compressed Opus audio blob
   * @param {object} metadata - Extra details (e.g. coordinates, technician_id)
   * @returns {Promise<object>} - The enqueued transaction record
   */
  async enqueue(actionType, audioBlob, metadata = {}) {
    await this.open();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);

      const record = {
        client_tx_uuid: this._generateUUID(),
        timestamp: new Date().toISOString(),
        audioBlob,
        actionType,
        metadata,
        sync_status: 'pending',
        retry_count: 0,
        error_log: null
      };

      const request = store.add(record);

      request.onsuccess = (event) => {
        record.id = event.target.result;
        resolve(record);
      };

      request.onerror = (event) => {
        reject(new Error(`Failed to enqueue item: ${event.target.error?.message}`));
      };
    });
  }

  /**
   * Retrieve all pending or failed items in chronological order
   * @returns {Promise<array>}
   */
  async getPending() {
    await this.open();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const index = store.index('timestamp');

      const items = [];

      index.openCursor().onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          const val = cursor.value;
          // Filter for pending or failed items
          if (val.sync_status === 'pending' || val.sync_status === 'failed') {
            items.push(val);
          }
          cursor.continue();
        } else {
          resolve(items);
        }
      };

      transaction.onerror = (event) => {
        reject(new Error(`Failed to read pending items: ${event.target.error?.message}`));
      };
    });
  }

  /**
   * Update the synchronization status of an item
   * @param {number} id - Record primary key
   * @param {'pending'|'syncing'|'failed'|'synced'} status - New status
   * @param {string} [errorMsg] - Error log details
   */
  async updateStatus(id, status, errorMsg = null) {
    await this.open();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);

      const getRequest = store.get(id);

      getRequest.onsuccess = () => {
        const record = getRequest.value;
        if (!record) {
          return reject(new Error(`Record with id ${id} not found`));
        }

        record.sync_status = status;
        if (errorMsg) {
          record.error_log = errorMsg;
        }

        const updateRequest = store.put(record);
        updateRequest.onsuccess = () => resolve(record);
        updateRequest.onerror = (event) => reject(new Error(event.target.error?.message));
      };

      getRequest.onerror = (event) => {
        reject(new Error(`Failed to get record for status update: ${event.target.error?.message}`));
      };
    });
  }

  /**
   * Increment retry count and mark as failed
   * @param {number} id - Record primary key
   * @param {string} errorMsg - Failure message
   */
  async incrementRetry(id, errorMsg) {
    await this.open();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);

      const getRequest = store.get(id);

      getRequest.onsuccess = () => {
        const record = getRequest.value;
        if (!record) {
          return reject(new Error(`Record with id ${id} not found`));
        }

        record.retry_count += 1;
        record.sync_status = 'failed';
        record.error_log = errorMsg;

        const updateRequest = store.put(record);
        updateRequest.onsuccess = () => resolve(record);
        updateRequest.onerror = (event) => reject(new Error(event.target.error?.message));
      };

      getRequest.onerror = (event) => {
        reject(new Error(`Failed to get record for retry increment: ${event.target.error?.message}`));
      };
    });
  }

  /**
   * Delete an item from the store (called after successful sync)
   * @param {number} id - Record primary key
   */
  async deleteItem(id) {
    await this.open();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);

      const request = store.delete(id);

      request.onsuccess = () => {
        resolve(true);
      };

      request.onerror = (event) => {
        reject(new Error(`Failed to delete item: ${event.target.error?.message}`));
      };
    });
  }

  /**
   * Private UUID Generator fallback helper
   */
  _generateUUID() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    // Math.random RFC4122 version 4 UUID generator fallback
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
}

// Export a single instance
module.exports = new IndexedDbQueue();
