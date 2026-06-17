import { PLAYER_COLORS } from "./map-data.js";
import { Game } from "./game.js";
import { UI } from "./ui.js";
import { connectWallet, getAddress } from "./wallet.js";
import { joinRoom, sendGameState, setMessageHandler, setReady, startGame as sendStartGame, disconnect, isConnected } from "./multiplayer.js";

const $ = (s) => document.querySelector(s);
let ui = null;
let walletAddress = null;
let roomId = null;

// ---------- lobby (sala de espera) ----------
let lobby = null; // { roomId, playerId, playerName }
let lobbyPlayers = [];
let myIndex = null; // indice del jugador local en la partida online actual

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
  const game = new Game(configs);
  ui = new UI(game, onGameOver);
  showScreen("#screen-game");
  showWalletBadgeInGame();
}

// ---------- crear / unirse a sala (entra al lobby) ----------
function enterLobby(code, playerName) {
  roomId = code;
  const playerId = walletAddress || ('anon-' + Math.random().toString(36).slice(2, 8));
  lobby = { roomId, playerId, playerName: playerName || defaultPlayerName() };
  lobbyPlayers = [];

  $("#lobby-room-code").textContent = roomId;
  $("#lobby-players-list").innerHTML = "";
  $("#lobby-ready-checkbox").checked = false;
  $("#btn-lobby-start").classList.add("hidden");

  joinRoom(roomId, playerId, onLobbyMessage, lobby.playerName, () => {
    alert("No se pudo unir a la sala. Puede que ya haya iniciado o no exista.");
    lobby = null;
    showScreen("#screen-start");
  });
  showScreen("#screen-lobby");
}

function onLobbyMessage(msg) {
  if (msg.type === 'lobby_update') {
    lobbyPlayers = msg.players;
    renderLobby();
  } else if (msg.type === 'start_game') {
    beginOnlineGame(msg.payload.players);
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
  const allReady = lobbyPlayers.length > 0 && lobbyPlayers.every((p) => p.ready);
  $("#btn-lobby-start").classList.toggle("hidden", !(isHost && allReady));
}

// ---------- pasar del lobby a la partida sincronizada ----------
function beginOnlineGame(players) {
  const configs = players.map((p, i) => ({ name: p.name, color: PLAYER_COLORS[i] }));
  const game = new Game(configs);
  myIndex = players.findIndex((p) => p.id === lobby.playerId);

  setMessageHandler((msg) => {
    if (msg.type === 'game_state' && ui) {
      Object.assign(game.board, msg.payload.board ?? {});
      if (msg.payload.currentIndex != null) game.currentIndex = msg.payload.currentIndex;
      if (msg.payload.phase) game.phase = msg.payload.phase;
      ui.refresh();
    }
  });

  const patchedRefresh = () => {
    sendGameState({
      board: game.board,
      currentIndex: game.currentIndex,
      phase: game.phase,
    });
  };
  ['placeSetupArmy','placeReinforcement','attack','endReinforce','endAttack','skipFortify','fortify','moveAfterConquest','autoPlaceSetup']
    .forEach(method => {
      const orig = game[method].bind(game);
      game[method] = (...args) => {
        const result = orig(...args);
        patchedRefresh();
        return result;
      };
    });

  updateMultiplayerBadge(roomId);
  ui = new UI(game, onGameOver, { myIndex });
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
  if (myIndex != null && winner.id === myIndex) {
    fetch('/api/win', { method: 'POST' }).catch(() => {});
  }
  disconnect();
  ui.openModal(`
    <div style="text-align:center">
      <div style="font-size:3rem">🏆</div>
      <div class="win-title" style="color:${winner.color}">${escapeHtml(winner.name)}</div>
      <p>ha conquistado el mundo!</p>
      <div class="modal-actions">
        <button class="btn btn-primary" id="go-menu">Volver al menu</button>
      </div>
    </div>`);
  $("#go-menu").addEventListener("click", () => {
    ui.closeModal();
    showScreen("#screen-start");
  });
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

$("#lobby-ready-checkbox")?.addEventListener("change", (e) => {
  setReady(e.target.checked);
});

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

$("#btn-lobby-start")?.addEventListener("click", () => {
  sendStartGame(shuffle(lobbyPlayers));
});

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
