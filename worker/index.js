const PUBLIC_WINDOW_MS = 60000;
const MAX_PLAYERS = 6;

export class GameRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);

    // --- Emparejador (modo online): decide la sala publica actual ---
    if (url.searchParams.get('match') === '1') {
      return this.handleMatch();
    }

    const upgradeHeader = request.headers.get('Upgrade');
    if (upgradeHeader !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }
    if (await this.state.storage.get('started')) {
      return new Response('Room already started', { status: 409 });
    }
    if (this.state.getWebSockets().length >= MAX_PLAYERS) {
      return new Response('Room is full', { status: 403 });
    }

    const playerId = url.searchParams.get('playerId') || crypto.randomUUID();
    const playerName = url.searchParams.get('playerName') || 'Jugador';
    const isPublic = url.searchParams.get('public') === '1';

    const [client, server] = Object.values(new WebSocketPair());
    this.state.acceptWebSocket(server, [playerId]);
    server.serializeAttachment({ name: playerName, ready: true });

    // Sala publica: el primer jugador arranca el contador de 60s.
    if (isPublic && !(await this.state.storage.get('openUntil'))) {
      const openUntil = parseInt(url.searchParams.get('openUntil'), 10) || (Date.now() + PUBLIC_WINDOW_MS);
      await this.state.storage.put('openUntil', openUntil);
      await this.state.storage.setAlarm(openUntil);
    }

    await this.broadcastLobby();
    return new Response(null, { status: 101, webSocket: client });
  }

  // Emparejamiento atomico: una instancia fija "__matchmaker__" rota la sala publica.
  async handleMatch() {
    const now = Date.now();
    let mm = await this.state.storage.get('mm');
    if (!mm || (now - mm.openedAt) >= PUBLIC_WINDOW_MS || mm.count >= MAX_PLAYERS) {
      mm = { roomId: 'online-' + crypto.randomUUID().slice(0, 8), openedAt: now, count: 0 };
    }
    mm.count++;
    await this.state.storage.put('mm', mm);
    return Response.json({ roomId: mm.roomId, openUntil: mm.openedAt + PUBLIC_WINDOW_MS });
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
      const att = ws.deserializeAttachment() || {};
      att.ready = !!data.payload?.ready;
      ws.serializeAttachment(att);
      await this.broadcastLobby();
      return;
    }

    if (data.type === 'start_game') {
      await this.state.storage.put('started', true);
      await this.state.storage.deleteAlarm();
      this.broadcast(null, JSON.stringify({ from: playerId, ...data }));
      return;
    }

    this.broadcast(playerId, JSON.stringify({ from: playerId, ...data }));
  }

  async webSocketClose(ws) {
    const [playerId] = this.state.getTags(ws);
    this.broadcast(playerId, JSON.stringify({ type: 'player_left', playerId }));
    const remaining = this.state.getWebSockets().filter((s) => s !== ws);
    if (remaining.length === 0) {
      await this.resetRoom();
    } else {
      await this.broadcastLobby(ws);
    }
  }

  // Fin del contador publico: arranca si hay >=2 jugadores, si no cancela.
  async alarm() {
    if (await this.state.storage.get('started')) return;
    const players = this.roster();
    if (players.length >= 2) {
      this.sendTo(players[0].id, JSON.stringify({ type: 'you_start', players }));
    } else {
      this.broadcast(null, JSON.stringify({ type: 'match_failed' }));
      await this.resetRoom();
    }
  }

  async resetRoom() {
    await this.state.storage.deleteAll();
    await this.state.storage.deleteAlarm();
  }

  // Roster derivado de los sockets vivos (sobrevive a la hibernacion del DO).
  roster(exclude) {
    return this.state.getWebSockets()
      .filter((ws) => ws !== exclude)
      .map((ws) => {
        const [id] = this.state.getTags(ws);
        const att = ws.deserializeAttachment() || {};
        return { id, name: att.name || 'Jugador', ready: att.ready !== false };
      });
  }

  async broadcastLobby(exclude) {
    const players = this.roster(exclude);
    const openUntil = (await this.state.storage.get('openUntil')) || null;
    this.broadcast(null, JSON.stringify({ type: 'lobby_update', players, openUntil }));
  }

  sendTo(playerId, message) {
    for (const ws of this.state.getWebSockets()) {
      const [id] = this.state.getTags(ws);
      if (id === playerId) {
        try { ws.send(message); } catch {}
        return;
      }
    }
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
