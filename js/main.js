import { PLAYER_COLORS } from "./map-data.js";
import { Game } from "./game.js";
import { UI } from "./ui.js";
import { connectWallet, getAddress } from "./wallet.js";
import { joinRoom, sendGameState, disconnect, isConnected } from "./multiplayer.js";

const $ = (s) => document.querySelector(s);
let ui = null;
let walletAddress = null;
let roomId = null;

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

// ---------- iniciar partida ----------
function startGame() {
  const inputs = [...document.querySelectorAll("#player-fields input")];
  const configs = inputs.map((inp, i) => ({
    name: inp.value.trim() || `Jugador ${i + 1}`,
    color: PLAYER_COLORS[i],
  }));

  roomId = ($("#room-input")?.value || "").trim() || null;

  const game = new Game(configs);

  // Si hay sala, sincronizar estado con otros jugadores
  if (roomId) {
    const playerId = walletAddress || ('anon-' + Math.random().toString(36).slice(2, 8));
    joinRoom(roomId, playerId, (msg) => {
      if (msg.type === 'game_state' && ui) {
        // Aplicar estado remoto al juego local
        Object.assign(game.board, msg.payload.board ?? {});
        if (msg.payload.currentIndex != null) game.currentIndex = msg.payload.currentIndex;
        if (msg.payload.phase) game.phase = msg.payload.phase;
        ui.refresh();
      }
    });

    // Enviar estado tras cada acción
    const origRefresh = game._emitState?.bind(game);
    const patchedRefresh = () => {
      sendGameState({
        board: game.board,
        currentIndex: game.currentIndex,
        phase: game.phase,
      });
    };
    // Hook: parchar métodos que cambian estado
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
  }

  ui = new UI(game, onGameOver);
  showScreen("#screen-game");

  // Mostrar wallet address en topbar del juego
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
    loadLeaderboard();
  });
  submitScore(winner.name);
}

// ---------- leaderboard ----------
async function submitScore(name) {
  try {
    await fetch("/api/scores", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
  } catch (_) {}
}

async function loadLeaderboard() {
  const box = $("#leaderboard");
  try {
    const res = await fetch("/api/scores");
    if (!res.ok) throw new Error();
    const data = await res.json();
    if (!data.length) { box.innerHTML = ""; return; }
    box.innerHTML = `<h3>🏆 Salon de la fama</h3><ol>` +
      data.map((r) => `<li>${escapeHtml(r.name)} — ${r.wins} victoria(s)</li>`).join("") +
      `</ol>`;
  } catch (_) {
    box.innerHTML = "";
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

// ---------- bindings ----------
$("#player-count").addEventListener("change", renderPlayerFields);
$("#btn-start").addEventListener("click", startGame);
$("#btn-wallet")?.addEventListener("click", handleConnectWallet);
$("#btn-quit").addEventListener("click", () => {
  if (confirm("Salir de la partida actual?")) {
    disconnect();
    showScreen("#screen-start");
  }
});

// Generar código de sala aleatorio
$("#btn-gen-room")?.addEventListener("click", () => {
  const code = Math.random().toString(36).slice(2, 8).toUpperCase();
  const input = $("#room-input");
  if (input) input.value = `sala-${code}`;
});

// Restaurar wallet si ya estaba conectada (misma sesión)
walletAddress = sessionStorage.getItem('walletAddress');
renderWalletUI();
renderPlayerFields();
loadLeaderboard();
