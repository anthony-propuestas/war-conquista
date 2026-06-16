let ws = null;
let _onMessage = null;

export function joinRoom(roomId, playerId, onMessage) {
  if (ws) ws.close();
  _onMessage = onMessage;

  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const url = `${proto}://${location.host}/api/game-room?roomId=${encodeURIComponent(roomId)}&playerId=${encodeURIComponent(playerId)}`;

  ws = new WebSocket(url);

  ws.addEventListener('open', () => {
    console.log(`[WAR] Sala "${roomId}" conectada`);
  });

  ws.addEventListener('message', (e) => {
    try {
      const data = JSON.parse(e.data);
      if (_onMessage) _onMessage(data);
    } catch {}
  });

  ws.addEventListener('close', () => {
    console.log('[WAR] Conexión cerrada');
  });

  ws.addEventListener('error', (e) => {
    console.error('[WAR] WebSocket error', e);
  });
}

export function sendAction(type, payload = {}) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type, payload }));
}

export function sendGameState(state) {
  sendAction('game_state', state);
}

export function disconnect() {
  if (ws) { ws.close(); ws = null; }
}

export function isConnected() {
  return ws !== null && ws.readyState === WebSocket.OPEN;
}
