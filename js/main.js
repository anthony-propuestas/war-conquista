import { PLAYER_COLORS } from "./map-data.js";
import { Game } from "./game.js";
import { UI } from "./ui.js";
import { connectWallet, getAddress } from "./wallet.js";
import { joinRoom, requestMatch, sendGameState, sendAction, setMessageHandler, setReady, startGame as sendStartGame, disconnect, isConnected } from "./multiplayer.js";

const $ = (s) => document.querySelector(s);
let ui = null;
let walletAddress = null;
let roomId = null;
let rankedOnline = false; // solo el emparejamiento online suma victorias a la BD

// ---------- lobby (sala de espera) ----------
let lobby = null; // { roomId, playerId, playerName }
let lobbyPlayers = [];
let myIndex = null; // indice del jugador local en la partida online actual
let inLobby = false;

// ---------- perfil (nombre real desde la BD) ----------
let myUsername = null;
let mySub = null;
async function loadProfile() {
  try {
    const res = await fetch('/api/profile');
    if (!res.ok) return;
    const data = await res.json();
    myUsername = data.username || null;
    mySub = data.sub || null;
  } catch (_) {}
}

// ---------- items de mejora (cartas del jugador) ----------
let playerCards = []; // [{ id, name, description, effect_type, effect_value, used_at }]
async function loadCards() {
  try {
    const res = await fetch('/api/cards/inventory');
    if (res.ok) playerCards = await res.json();
  } catch (_) {}
}

// ---------- modo online (emparejamiento automatico) ----------
let onlineActive = false;
let countdownHandle = null;
let onlinePlayers = [];
let onlineOpenUntil = 0;

// ---------- wallet ----------
async function handleConnectWallet() {
  try {
    walletAddress = await connectWallet();
    renderWalletUI();
    // persist for game screen
    sessionStorage.setItem('walletAddress', walletAddress);
  } catch (err) {
    alert(err.message || 'No se pudo conectar la wallet');
  }
}

function renderWalletUI() {
  const btn = $("#btn-wallet");
  const badge = $("#wallet-badge");
  if (!btn || !badge) return;
  if (walletAddress) {
    const short = walletAddress.slice(0, 6) + '…' + walletAddress.slice(-4);
    btn.textContent = short;
    btn.classList.add('connected');
    badge.textContent = short;
    badge.classList.remove('hidden');
  } else {
    btn.textContent = 'Conectar Wallet';
    btn.classList.remove('connected');
    badge.classList.add('hidden');
  }
}

// ---------- pantalla de inicio: campos de jugador ----------
function renderPlayerFields() {
  const n = parseInt($("#player-count").value, 10);
  const wrap = $("#player-fields");
  wrap.innerHTML = "";
  for (let i = 0; i < n; i++) {
    const row = document.createElement("div");
    row.className = "player-row";
    const sw = document.createElement("span");
    sw.className = "swatch";
    sw.style.background = PLAYER_COLORS[i];
    const input = document.createElement("input");
    input.type = "text";
    input.maxLength = 16;
    input.value = `Jugador ${i + 1}`;
    input.dataset.idx = i;
    row.append(sw, input);
    wrap.appendChild(row);
  }
}

function showScreen(id) {
  hideConnBanner();
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  $(id).classList.add("active");
}

// ---------- modo local vs online ----------
function setMode(mode) {
  document.querySelectorAll(".mode-tab").forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
  document.querySelectorAll(".mode-panel").forEach((p) => p.classList.toggle("hidden", p.id !== `mode-${mode}`));
}

function defaultPlayerName() {
  const addr = walletAddress || sessionStorage.getItem('walletAddress');
  if (addr) return addr.slice(0, 6) + '…' + addr.slice(-4);
  return 'Jugador';
}

// ---------- iniciar partida local (hotseat, sin sala) ----------
function startLocalGame() {
  const inputs = [...document.querySelectorAll("#player-fields input")];
  const configs = inputs.map((inp, i) => ({
    name: inp.value.trim() || `Jugador ${i + 1}`,
    color: PLAYER_COLORS[i],
  }));

  roomId = null;
  myIndex = null;
  rankedOnline = false;
  const game = new Game(configs);
  ui = new UI(game, onGameOver, { playerCards: [...playerCards] });
  showScreen("#screen-game");
  showWalletBadgeInGame();
}

// ---------- crear / unirse a sala (entra al lobby) ----------
function enterLobby(code, playerName) {
  inLobby = true;
  rankedOnline = false;
  roomId = code;
  const playerId = walletAddress || ('anon-' + Math.random().toString(36).slice(2, 8));
  lobby = { roomId, playerId, playerName: playerName || defaultPlayerName() };
  lobbyPlayers = [];

  $("#lobby-room-code").textContent = roomId;
  $("#lobby-players-list").innerHTML = "";
  $("#btn-lobby-start").classList.add("hidden");

  joinRoom(roomId, playerId, onLobbyMessage, lobby.playerName, () => {
    inLobby = false;
    lobby = null;
    alert("No se pudo unir a la sala. Puede que ya haya iniciado o no exista.");
    showScreen("#screen-start");
  }, () => {
    hideConnBanner();
    if (!inLobby) return;
    inLobby = false;
    lobby = null;
    lobbyPlayers = [];
    alert("Se perdió la conexión con la sala.");
    showScreen("#screen-start");
  }, { reconnect: true, onReconnecting: (n) => showConnBanner(`Reconectando… (intento ${n})`), onReconnect: hideConnBanner });
  showScreen("#screen-lobby");
}

function onLobbyMessage(msg) {
  if (msg.type === 'lobby_update') {
    lobbyPlayers = msg.players;
    renderLobby();
  } else if (msg.type === 'start_game') {
    beginOnlineGame(msg.payload.players, msg.payload.board, msg.payload.setupRemaining, msg.payload.attackUnlocked, msg.payload.firstRoundTurnsLeft);
  }
}

function renderLobby() {
  const list = $("#lobby-players-list");
  list.innerHTML = "";
  lobbyPlayers.forEach((p) => {
    const li = document.createElement("li");
    li.textContent = `${p.name}${p.id === lobby.playerId ? ' (tú)' : ''} — ${p.ready ? 'Listo' : 'Esperando...'}`;
    if (p.ready) li.classList.add("ready");
    list.appendChild(li);
  });

  const isHost = lobbyPlayers.length > 0 && lobbyPlayers[0].id === lobby.playerId;
  const allReady = lobbyPlayers.length >= 2 && lobbyPlayers.every((p) => p.ready);
  $("#btn-lobby-start").classList.toggle("hidden", !(isHost && allReady));
}

// ---------- modo online: emparejamiento automatico ----------
const ONLINE_WINDOW_MS = 60000;

async function enterOnline() {
  const btn = $("#btn-online-play");
  if (btn) btn.disabled = true;
  rankedOnline = true;
  try {
    const name = myUsername || defaultPlayerName();
    const playerId = mySub || walletAddress || ('anon-' + Math.random().toString(36).slice(2, 8));
    const { roomId: rid, openUntil } = await requestMatch();
    roomId = rid;
    myIndex = null;
    onlineActive = true;
    onlinePlayers = [];
    lobby = { roomId: rid, playerId, playerName: name };
    joinRoom(rid, playerId, onOnlineMessage, name, onOnlineFailed, onOnlineClose, { public: true, openUntil, reconnect: true, onReconnecting: (n) => showConnBanner(`Reconectando… (intento ${n})`), onReconnect: hideConnBanner });
    openCountdownModal(openUntil);
  } catch (_) {
    alert("No se pudo conectar al modo online. Intenta de nuevo.");
  } finally {
    if (btn) btn.disabled = false;
  }
}

function onOnlineMessage(msg) {
  if (msg.type === 'lobby_update') {
    onlinePlayers = msg.players;
    if (msg.openUntil) onlineOpenUntil = msg.openUntil;
    renderOnlinePlayers();
  } else if (msg.type === 'you_start') {
    hostStart(msg.players);
  } else if (msg.type === 'start_game') {
    onlineActive = false;
    stopCountdown();
    closeWaitModal();
    beginOnlineGame(msg.payload.players, msg.payload.board, msg.payload.setupRemaining, msg.payload.attackUnlocked, msg.payload.firstRoundTurnsLeft);
  } else if (msg.type === 'match_failed') {
    endOnline("No se encontraron suficientes jugadores. Intenta de nuevo.");
  }
}

function onOnlineFailed() {
  endOnline("No se pudo entrar a la sala online. Intenta de nuevo.");
}

function onOnlineClose() {
  if (!onlineActive) return;
  endOnline("Te desconectaste del modo online.");
}

function leaveOnline() {
  onlineActive = false;
  stopCountdown();
  closeWaitModal();
  disconnect();
  showScreen("#screen-start");
}

function endOnline(message) {
  onlineActive = false;
  stopCountdown();
  closeWaitModal();
  disconnect();
  showScreen("#screen-start");
  if (message) alert(message);
}

function openCountdownModal(openUntil) {
  onlineOpenUntil = openUntil;
  const r = 54;
  const circumference = 2 * Math.PI * r;
  $("#modal-card").innerHTML = `
    <div class="online-wait">
      <h2 class="online-title">Buscando partida…</h2>
      <div class="countdown">
        <svg viewBox="0 0 120 120" class="countdown-ring" aria-hidden="true">
          <circle class="ring-bg" cx="60" cy="60" r="${r}" />
          <circle class="ring-fg" cx="60" cy="60" r="${r}"
                  stroke-dasharray="${circumference.toFixed(1)}" stroke-dashoffset="0"
                  transform="rotate(-90 60 60)" />
        </svg>
        <div class="countdown-num" id="cd-num">60</div>
      </div>
      <p class="online-hint">La partida inicia automáticamente. Mínimo 2 jugadores.</p>
      <div class="online-players-head">Jugadores <span id="cd-count">0/6</span></div>
      <ul class="online-players" id="cd-players"></ul>
      <button class="btn btn-ghost" id="cd-leave">Salir de la cola</button>
    </div>`;
  $("#modal").classList.remove("hidden");
  $("#cd-leave").addEventListener("click", leaveOnline);
  startCountdown(circumference);
  renderOnlinePlayers();
}

function startCountdown(circumference) {
  stopCountdown();
  const tick = () => {
    const ring = $(".ring-fg");
    const numEl = $("#cd-num");
    const msLeft = onlineOpenUntil - Date.now();
    const remaining = Math.max(0, Math.ceil(msLeft / 1000));
    if (numEl) numEl.textContent = remaining > 0 ? remaining : "…";
    if (ring) {
      const frac = Math.max(0, Math.min(1, msLeft / ONLINE_WINDOW_MS));
      ring.style.strokeDashoffset = (circumference * (1 - frac)).toFixed(1);
    }
  };
  tick();
  countdownHandle = setInterval(tick, 250);
}

function stopCountdown() {
  if (countdownHandle) clearInterval(countdownHandle);
  countdownHandle = null;
}

function renderOnlinePlayers() {
  const list = $("#cd-players");
  if (!list) return;
  list.innerHTML = "";
  onlinePlayers.forEach((p, i) => {
    const li = document.createElement("li");
    li.className = "online-player";
    const sw = document.createElement("span");
    sw.className = "swatch";
    sw.style.background = PLAYER_COLORS[i] || "#888";
    const nm = document.createElement("span");
    nm.textContent = `${p.name}${p.id === lobby?.playerId ? " (tú)" : ""}`;
    li.append(sw, nm);
    list.appendChild(li);
  });
  const cnt = $("#cd-count");
  if (cnt) cnt.textContent = `${onlinePlayers.length}/6`;
}

function closeWaitModal() {
  $("#modal").classList.add("hidden");
}

// ---------- pasar del lobby a la partida sincronizada ----------
function beginOnlineGame(players, initialBoard, initialSetup, initialAttackUnlocked, initialFirstRoundTurnsLeft) {
  inLobby = false;
  const configs = players.map((p, i) => ({ name: p.name, color: PLAYER_COLORS[i] }));
  const game = new Game(configs);
  myIndex = players.findIndex((p) => p.id === lobby.playerId);

  // Aplicar el estado inicial autoritativo generado por el host.
  // Todos los clientes (incluido el host) reciben el mismo board via start_game,
  // eliminando cualquier divergencia por aleatoriedad local.
  if (initialBoard) {
    Object.assign(game.board, initialBoard);
    if (initialSetup) game.setupRemaining = [...initialSetup];
    if (initialAttackUnlocked != null) game.attackUnlocked = initialAttackUnlocked;
    if (initialFirstRoundTurnsLeft != null) game.firstRoundTurnsLeft = initialFirstRoundTurnsLeft;
  }

  setMessageHandler((msg) => {
    if (msg.type === 'card_used' && ui) {
      ui.showEnemyCardNotification(msg.payload);
      return;
    }
    // state_sync llega tras reconectar a media partida: misma forma que game_state.
    if ((msg.type === 'game_state' || msg.type === 'state_sync') && ui) {
      Object.assign(game.board, msg.payload.board ?? {});
      if (msg.payload.currentIndex != null) game.currentIndex = msg.payload.currentIndex;
      if (msg.payload.phase) game.phase = msg.payload.phase;
      if (msg.payload.setupRemaining) game.setupRemaining = msg.payload.setupRemaining;
      if (msg.payload.attackUnlocked != null) game.attackUnlocked = msg.payload.attackUnlocked;
      if (msg.payload.firstRoundTurnsLeft != null) game.firstRoundTurnsLeft = msg.payload.firstRoundTurnsLeft;
      if (msg.payload.round != null) game.round = msg.payload.round;
      if (msg.payload.reinforcements != null) game.reinforcements = msg.payload.reinforcements;
      if (Array.isArray(msg.payload.alive)) game.players.forEach((p, i) => { p.alive = msg.payload.alive[i]; });
      if (msg.payload.winner != null) game.winner = game.players[msg.payload.winner] ?? null;
      ui.refresh();
    }
  });

  const patchedRefresh = () => {
    sendGameState({
      board: game.board,
      currentIndex: game.currentIndex,
      phase: game.phase,
      setupRemaining: game.setupRemaining,
      attackUnlocked: game.attackUnlocked,
      firstRoundTurnsLeft: game.firstRoundTurnsLeft,
      round: game.round,
      reinforcements: game.reinforcements,
      winner: game.winner ? game.winner.id : null,
      alive: game.players.map((p) => p.alive),
    });
  };
  ['placeSetupArmy','placeReinforcement','attack','endTurn','fortify','autoPlaceSetup','surrender','applyCardEffect']
    .forEach(method => {
      const orig = game[method].bind(game);
      game[method] = (...args) => {
        const result = orig(...args);
        patchedRefresh();
        return result;
      };
    });

  updateMultiplayerBadge(roomId);
  ui = new UI(game, onGameOver, {
    myIndex,
    playerCards: [...playerCards],
    onCardUsed: (card, playerName) => sendAction('card_used', { playerName, card }),
  });
  showScreen("#screen-game");
  showWalletBadgeInGame();
}

function showWalletBadgeInGame() {
  const addr = walletAddress || sessionStorage.getItem('walletAddress');
  if (addr) {
    const topbarBadge = $("#topbar-wallet");
    if (topbarBadge) {
      topbarBadge.textContent = addr.slice(0, 6) + '…' + addr.slice(-4);
      topbarBadge.classList.remove('hidden');
    }
  }
}

function updateMultiplayerBadge(room) {
  const badge = $("#multiplayer-indicator");
  if (!badge) return;
  badge.textContent = `Sala: ${room}`;
  badge.classList.remove('hidden');
}

// ---------- fin de partida ----------
function onGameOver(winner) {
  if (rankedOnline && myIndex != null && winner.id === myIndex) {
    fetch('/api/win', { method: 'POST' }).catch(() => {});
  }
  disconnect();

  const game = ui.game;
  // En local (hotseat) siempre se muestra la pantalla de victoria del ganador.
  const didIWin = myIndex == null || winner.id === myIndex;

  const standings = [...game.players]
    .map((p) => ({ p, terr: game.territoriesOf(p.id).length }))
    .sort((a, b) => b.terr - a.terr)
    .map(({ p, terr }) => {
      const tag = p.id === winner.id ? "👑" : (!p.alive ? "☠" : "");
      return `<li class="end-row${p.id === winner.id ? ' is-winner' : ''}${!p.alive ? ' is-dead' : ''}">
          <span class="swatch" style="background:${p.color}"></span>
          <span class="end-name">${escapeHtml(p.name)}</span>
          <span class="end-terr">${terr} 🗺</span>
          <span class="end-tag">${tag}</span>
        </li>`;
    }).join("");

  const head = didIWin
    ? `<div class="end-emoji">🏆</div><div class="end-title">¡Victoria!</div>
       <div class="end-sub" style="color:${winner.color}">${escapeHtml(winner.name)} conquistó el mundo</div>`
    : `<div class="end-emoji">🏳️</div><div class="end-title">Derrota</div>
       <div class="end-sub">Ganó <b style="color:${winner.color}">${escapeHtml(winner.name)}</b></div>`;

  ui.openModal(`
    <div class="end-screen ${didIWin ? 'win' : 'lose'}">
      ${head}
      <ul class="end-standings">${standings}</ul>
      <p class="end-round">Partida terminada en la ronda ${game.round}</p>
      <div class="modal-actions">
        <button class="btn btn-primary" id="go-menu">Volver al menú</button>
      </div>
    </div>`);
  $("#go-menu").addEventListener("click", () => {
    ui.closeModal();
    showScreen("#screen-start");
  });
}

// ---------- banner de reconexión (no bloqueante) ----------
let _connBanner = null;
function showConnBanner(text) {
  if (!_connBanner) {
    _connBanner = document.createElement('div');
    _connBanner.id = 'conn-banner';
    _connBanner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#b91c1c;color:#fff;text-align:center;padding:6px 8px;font-size:14px;font-weight:600';
    document.body.appendChild(_connBanner);
  }
  _connBanner.textContent = text;
  _connBanner.style.display = 'block';
}
function hideConnBanner() {
  if (_connBanner) _connBanner.style.display = 'none';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

// ---------- bindings ----------
$("#player-count").addEventListener("change", renderPlayerFields);
$("#btn-start-local").addEventListener("click", startLocalGame);
$("#btn-wallet")?.addEventListener("click", handleConnectWallet);
$("#btn-quit").addEventListener("click", () => {
  if (confirm("Salir de la partida actual?")) {
    disconnect();
    showScreen("#screen-start");
  }
});

// Pestañas local / crear / unirse
document.querySelectorAll(".mode-tab").forEach((btn) => {
  btn.addEventListener("click", () => setMode(btn.dataset.mode));
});

// Generar código de sala aleatorio
$("#btn-gen-room")?.addEventListener("click", () => {
  const code = Math.random().toString(36).slice(2, 8).toUpperCase();
  const input = $("#create-room-code");
  if (input) input.value = `sala-${code}`;
});

$("#btn-create-room")?.addEventListener("click", () => {
  let code = $("#create-room-code").value.trim();
  if (!code) {
    code = `sala-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    $("#create-room-code").value = code;
  }
  const name = $("#create-name").value.trim();
  enterLobby(code, name);
});

$("#btn-join-room")?.addEventListener("click", () => {
  const code = $("#join-room-code").value.trim();
  if (!code) {
    alert("Ingresa el código de la sala a la que quieres unirte");
    return;
  }
  const name = $("#join-name").value.trim();
  enterLobby(code, name);
});

$("#btn-online-play")?.addEventListener("click", enterOnline);

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// El host genera el estado inicial autoritativo y lo difunde a todos.
function hostStart(playerList) {
  const players = shuffle(playerList);
  const configs = players.map((p, i) => ({ name: p.name, color: PLAYER_COLORS[i] }));
  const seedGame = new Game(configs);
  sendStartGame({ players, board: seedGame.board, setupRemaining: seedGame.setupRemaining, attackUnlocked: seedGame.attackUnlocked, firstRoundTurnsLeft: seedGame.firstRoundTurnsLeft });
}

$("#btn-lobby-start")?.addEventListener("click", () => hostStart(lobbyPlayers));

$("#btn-lobby-leave")?.addEventListener("click", () => {
  disconnect();
  lobby = null;
  lobbyPlayers = [];
  showScreen("#screen-start");
});

// Restaurar wallet si ya estaba conectada (misma sesión)
walletAddress = sessionStorage.getItem('walletAddress');
renderWalletUI();
renderPlayerFields();
loadProfile();
loadCards();
