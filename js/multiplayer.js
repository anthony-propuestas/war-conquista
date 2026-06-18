let ws = null;
let _onMessage = null;

// Pide al emparejador la sala publica actual del modo online.
export async function requestMatch() {
  const res = await fetch('/api/game-room?match=1', { method: 'POST' });
  if (!res.ok) throw new Error('No se pudo emparejar');
  return res.json(); // { roomId, openUntil }
}

export function joinRoom(roomId, playerId, onMessage, playerName = 'Jugador', onJoinFailed, onClose, opts = {}) {
  if (ws) ws.close();
  _onMessage = onMessage;
  let opened = false;

  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  let url = `${proto}://${location.host}/api/game-room?roomId=${encodeURIComponent(roomId)}&playerId=${encodeURIComponent(playerId)}&playerName=${encodeURIComponent(playerName)}`;
  if (opts.public) url += `&public=1&openUntil=${encodeURIComponent(opts.openUntil)}`;

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
