class SseManager {
  constructor() {
    this.clients = [];
  }

  /**
   * Add a new SSE client stream
   * @param {object} res - Express response stream
   */
  addClient(res) {
    this.clients.push(res);
    console.log(`SSE client connected. Total clients: ${this.clients.length}`);
  }

  /**
   * Remove an SSE client stream
   * @param {object} res - Express response stream
   */
  removeClient(res) {
    this.clients = this.clients.filter(client => client !== res);
    console.log(`SSE client disconnected. Total clients: ${this.clients.length}`);
  }

  /**
   * Broadcast events to all registered SSE clients
   * @param {string} type - Event identifier
   * @param {object} payload - Event data
   */
  broadcast(type, payload) {
    const data = JSON.stringify({ type, payload });
    const activeClients = [];
    
    this.clients.forEach(client => {
      try {
        client.write(`data: ${data}\n\n`);
        activeClients.push(client);
      } catch (err) {
        console.error('Failed to write to SSE client, removing client from active pool:', err.message);
        try {
          client.end();
        } catch (e) {
          // Ignore secondary failures on closed stream
        }
      }
    });
    
    this.clients = activeClients;
    console.log(`SSE broadcast: ${type} to ${this.clients.length} clients`);
  }
}

module.exports = new SseManager();
