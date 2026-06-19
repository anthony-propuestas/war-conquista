const PUBLIC_WINDOW_MS = 60000;
const MAX_PLAYERS = 6;
const RECONNECT_GRACE_MS = 45000; // ventana para reconectar antes de liberar una partida en curso

export class GameRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    // Auto-responder pings sin despertar al DO: mantiene viva la conexión durante
    // periodos de inactividad (evita cierres por timeout de proxies/Cloudflare).
    try {
      if (typeof WebSocketRequestResponsePair !== 'undefined' && state.setWebSocketAutoResponse) {
        state.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
      }
    } catch {}
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

    const playerId = url.searchParams.get('playerId') || crypto.randomUUID();
    const playerName = url.searchParams.get('playerName') || 'Jugador';
    const isPublic = url.searchParams.get('public') === '1';

    // Sala ya iniciada: solo se permite REINGRESO de un jugador que ya pertenecía
    // a la partida (reconexión tras una caída). Cualquier otro recibe 409.
    if (await this.state.storage.get('started')) {
      const ids = (await this.state.storage.get('playerIds')) || [];
      if (!ids.includes(playerId)) {
        return new Response('Room already started', { status: 409 });
      }
      const [client, server] = Object.values(new WebSocketPair());
      this.state.acceptWebSocket(server, [playerId]);
      server.serializeAttachment({ name: playerName, ready: true });
      await this.state.storage.deleteAlarm(); // el jugador volvió: cancela la limpieza por gracia
      const gameState = await this.state.storage.get('gameState');
      if (gameState) {
        try { server.send(JSON.stringify({ type: 'state_sync', payload: gameState })); } catch {}
      }
      this.broadcast(playerId, JSON.stringify({ type: 'player_rejoined', playerId }));
      return new Response(null, { status: 101, webSocket: client });
    }

    if (this.state.getWebSockets().length >= MAX_PLAYERS) {
      return new Response('Room is full', { status: 403 });
    }

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
    try {
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
        // Guarda los ids de los jugadores para autorizar reconexiones a media partida.
        const ids = (data.payload?.players || []).map((p) => p.id).filter(Boolean);
        if (ids.length) await this.state.storage.put('playerIds', ids);
        await this.state.storage.deleteAlarm();
        this.broadcast(null, JSON.stringify({ from: playerId, ...data }));
        return;
      }

      this.broadcast(playerId, JSON.stringify({ from: playerId, ...data }));
    } catch (err) {
      // Nunca dejes que un mensaje mal formado tumbe el DO y desconecte a todos.
      console.error('[GameRoom] webSocketMessage error', err);
    }
  }

  async webSocketClose(ws) {
    try {
      const [playerId] = this.state.getTags(ws);
      this.broadcast(playerId, JSON.stringify({ type: 'player_left', playerId }));
      const remaining = this.state.getWebSockets().filter((s) => s !== ws);
      if (remaining.length === 0) {
        if (await this.state.storage.get('started')) {
          // Partida en curso: conserva el estado y espera una posible reconexión.
          await this.state.storage.setAlarm(Date.now() + RECONNECT_GRACE_MS);
        } else {
          await this.resetRoom();
        }
      } else {
        await this.broadcastLobby(ws);
      }
    } catch (err) {
      console.error('[GameRoom] webSocketClose error', err);
    }
  }

  // Errores de socket: registrar sin propagar (no debe tumbar el DO).
  async webSocketError(ws, error) {
    console.error('[GameRoom] webSocketError', error);
  }

  // Fin del contador publico, o limpieza por gracia de una partida en curso.
  async alarm() {
    try {
      if (await this.state.storage.get('started')) {
        // Gracia agotada: si la sala sigue vacía, libera el estado de la partida.
        if (this.state.getWebSockets().length === 0) {
          await this.resetRoom();
        }
        return;
      }
      const players = this.roster();
      if (players.length >= 2) {
        this.sendTo(players[0].id, JSON.stringify({ type: 'you_start', players }));
      } else {
        this.broadcast(null, JSON.stringify({ type: 'match_failed' }));
        await this.resetRoom();
      }
    } catch (err) {
      console.error('[GameRoom] alarm error', err);
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
