export class GameRoom {
  constructor(state, env) {
    this.state = state;
    this.sessions = new Map(); // playerId → WebSocket
  }

  async fetch(request) {
    const upgradeHeader = request.headers.get('Upgrade');
    if (upgradeHeader !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }

    const [client, server] = Object.values(new WebSocketPair());
    const playerId = new URL(request.url).searchParams.get('playerId') || crypto.randomUUID();

    this.state.acceptWebSocket(server, [playerId]);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    const [playerId] = this.state.getTags(ws);
    let data;
    try { data = JSON.parse(message); } catch { return; }

    // Persist game state on each action
    if (data.type === 'game_state') {
      await this.state.storage.put('gameState', data.payload);
    }

    // Broadcast to all connected players except sender
    this.broadcast(playerId, JSON.stringify({ from: playerId, ...data }));
  }

  async webSocketClose(ws) {
    const [playerId] = this.state.getTags(ws);
    this.broadcast(playerId, JSON.stringify({ type: 'player_left', playerId }));
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

// Pages Function that routes /api/game-room/* to the Durable Object
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const roomId = url.searchParams.get('roomId') || 'default';
    const id = env.GAME_ROOM.idFromName(roomId);
    const room = env.GAME_ROOM.get(id);
    return room.fetch(request);
  }
};
