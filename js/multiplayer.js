let ws = null;
let _onMessage = null;

let _conn = null;          // parametros de la conexion activa (para reconectar)
let _manualClose = false;  // true cuando el cierre lo pedimos nosotros (disconnect)
let _hbTimer = null;       // intervalo de heartbeat
let _reconnectTimer = null;
let _retries = 0;
let _lastPong = 0;

const HEARTBEAT_MS = 25000;
const PONG_TIMEOUT_MS = 60000;
const BACKOFFS = [1000, 2000, 4000, 8000, 15000, 15000]; // reintentos de reconexion (ms)

// Pide al emparejador la sala publica actual del modo online.
export async function requestMatch() {
  const res = await fetch('/api/game-room?match=1', { method: 'POST' });
  if (!res.ok) throw new Error('No se pudo emparejar');
  return res.json(); // { roomId, openUntil }
}

// opts: { public, openUntil, reconnect, onReconnecting(intento), onReconnect() }
export function joinRoom(roomId, playerId, onMessage, playerName = 'Jugador', onJoinFailed, onClose, opts = {}) {
  if (ws) { _manualClose = true; ws.close(); }
  _onMessage = onMessage;
  _conn = { roomId, playerId, playerName, onJoinFailed, onClose, opts };
  _retries = 0;
  _connect(false);
}

function _buildUrl({ roomId, playerId, playerName, opts }) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  let url = `${proto}://${location.host}/api/game-room?roomId=${encodeURIComponent(roomId)}&playerId=${encodeURIComponent(playerId)}&playerName=${encodeURIComponent(playerName)}`;
  if (opts.public) url += `&public=1&openUntil=${encodeURIComponent(opts.openUntil)}`;
  return url;
}

function _connect(isReconnect) {
  const conn = _conn;
  if (!conn) return;
  _manualClose = false;
  let opened = false;

  const socket = new WebSocket(_buildUrl(conn));
  ws = socket;

  socket.addEventListener('open', () => {
    opened = true;
    _retries = 0;
    _lastPong = Date.now();
    _startHeartbeat();
    console.log(`[WAR] Sala "${conn.roomId}" conectada`);
    if (isReconnect) conn.opts.onReconnect?.();
  });

  socket.addEventListener('message', (e) => {
    if (ws !== socket) return; // socket viejo: ignora
    if (e.data === 'pong') { _lastPong = Date.now(); return; }
    try {
      const data = JSON.parse(e.data);
      if (_onMessage) _onMessage(data);
    } catch {}
  });

  socket.addEventListener('close', () => {
    if (ws !== socket) return; // ya hay otra conexion activa: ignora este cierre viejo
    _stopHeartbeat();
    if (_manualClose) return;
    if (!opened) {
      // nunca abrio: primer intento fallido, o un reintento de reconexion que no logro abrir
      if (isReconnect) { _scheduleReconnect(conn); return; }
      conn.onJoinFailed?.();
      return;
    }
    // se cayo tras estar conectado: reconecta si esta habilitado
    if (conn.opts.reconnect) _scheduleReconnect(conn);
    else conn.onClose?.();
  });

  socket.addEventListener('error', (e) => {
    console.error('[WAR] WebSocket error', e);
  });
}

function _scheduleReconnect(conn) {
  if (_retries >= BACKOFFS.length) {
    console.warn('[WAR] Reconexion agotada');
    conn.onClose?.();
    return;
  }
  const delay = BACKOFFS[_retries++];
  conn.opts.onReconnecting?.(_retries);
  console.log(`[WAR] Reconectando en ${delay}ms (intento ${_retries})`);
  clearTimeout(_reconnectTimer);
  _reconnectTimer = setTimeout(() => _connect(true), delay);
}

function _startHeartbeat() {
  _stopHeartbeat();
  _hbTimer = setInterval(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (Date.now() - _lastPong > PONG_TIMEOUT_MS) {
      console.warn('[WAR] Sin pong: conexion muerta, forzando reconexion');
      try { ws.close(); } catch {}
      return;
    }
    try { ws.send('ping'); } catch {}
  }, HEARTBEAT_MS);
}

function _stopHeartbeat() {
  if (_hbTimer) clearInterval(_hbTimer);
  _hbTimer = null;
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
  _manualClose = true;
  _conn = null;
  _retries = 0;
  _stopHeartbeat();
  clearTimeout(_reconnectTimer);
  _reconnectTimer = null;
  if (ws) { ws.close(); ws = null; }
}

export function isConnected() {
  return ws !== null && ws.readyState === WebSocket.OPEN;
}
