let ws = null;
let _onMessage = null;

export function joinRoom(roomId, playerId, onMessage, playerName = 'Jugador', onJoinFailed, onClose) {
  if (ws) ws.close();
  _onMessage = onMessage;
  let opened = false;

  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const url = `${proto}://${location.host}/api/game-room?roomId=${encodeURIComponent(roomId)}&playerId=${encodeURIComponent(playerId)}&playerName=${encodeURIComponent(playerName)}`;

  ws = new WebSocket(url);

  ws.addEventListener('open', () => {
    opened = true;
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
    if (!opened) onJoinFailed?.();
    else onClose?.();
  });

  ws.addEventListener('error', (e) => {
    console.error('[WAR] WebSocket error', e);
  });
}

export function setMessageHandler(onMessage) {
  _onMessage = onMessage;
}

export function sendAction(type, payload = {}) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type, payload }));
}

export function sendGameState(state) {
  sendAction('game_state', state);
}

export function setReady(ready) {
  sendAction('set_ready', { ready });
}

export function startGame(payload) {
  sendAction('start_game', payload);
}

export function disconnect() {
  if (ws) { ws.close(); ws = null; }
}

export function isConnected() {
  return ws !== null && ws.readyState === WebSocket.OPEN;
}
