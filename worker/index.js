export class GameRoom {
  constructor(state, env) {
    this.state = state;
    this.sessions = new Map();
    this.players = new Map(); // playerId -> { name, ready }
    this.started = false;
  }

  async fetch(request) {
    const upgradeHeader = request.headers.get('Upgrade');
    if (upgradeHeader !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }
    if (this.started) {
      return new Response('Room already started', { status: 409 });
    }

    const url = new URL(request.url);
    const playerId = url.searchParams.get('playerId') || crypto.randomUUID();
    const playerName = url.searchParams.get('playerName') || 'Jugador';

    const [client, server] = Object.values(new WebSocketPair());
    this.state.acceptWebSocket(server, [playerId]);

    this.players.set(playerId, { name: playerName, ready: false });
    this.broadcastLobby();

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    const [playerId] = this.state.getTags(ws);
    let data;
    try { data = JSON.parse(message); } catch { return; }

    if (data.type === 'game_state') {
      await this.state.storage.put('gameState', data.payload);
      this.broadcast(playerId, JSON.stringify({ from: playerId, ...data }));
      if (data.payload?.phase === 'gameover') {
        await this.resetRoom();
      }
      return;
    }

    if (data.type === 'set_ready') {
      const player = this.players.get(playerId);
      if (player) {
        player.ready = !!data.payload?.ready;
        this.broadcastLobby();
      }
      return;
    }

    if (data.type === 'start_game') {
      this.started = true;
      this.broadcast(null, JSON.stringify({ from: playerId, ...data }));
      return;
    }

    this.broadcast(playerId, JSON.stringify({ from: playerId, ...data }));
  }

  async webSocketClose(ws) {
    const [playerId] = this.state.getTags(ws);
    this.players.delete(playerId);
    this.broadcast(playerId, JSON.stringify({ type: 'player_left', playerId }));
    this.broadcastLobby();
    if (this.players.size === 0) {
      await this.resetRoom();
    }
  }

  async resetRoom() {
    await this.state.storage.deleteAll();
    this.players.clear();
    this.started = false;
  }

  broadcastLobby() {
    const players = [...this.players.entries()].map(([id, p]) => ({ id, name: p.name, ready: p.ready }));
    this.broadcast(null, JSON.stringify({ type: 'lobby_update', players }));
  }

  broadcast(excludeId, message) {
    for (const ws of this.state.getWebSockets()) {
      const [id] = this.state.getTags(ws);
      if (id !== excludeId) {
        try { ws.send(message); } catch {}
      }
    }
  }
}

export default {
  async fetch() {
    return new Response('Not found', { status: 404 });
  }
};
