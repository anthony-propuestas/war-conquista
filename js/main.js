// ============================================================
//  WAR - Punto de entrada: pantalla de inicio, arranque del
//  juego y conexion con el leaderboard (Cloudflare D1).
// ============================================================

import { PLAYER_COLORS } from "./map-data.js";
import { Game } from "./game.js";
import { UI } from "./ui.js";

const $ = (s) => document.querySelector(s);
let ui = null;

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
  const game = new Game(configs);
  ui = new UI(game, onGameOver);
  showScreen("#screen-game");
}

// ---------- fin de partida ----------
function onGameOver(winner) {
  ui.openModal(`
    <div style="text-align:center">
      <div style="font-size:3rem">🏆</div>
      <div class="win-title" style="color:${winner.color}">${winner.name}</div>
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

// ---------- leaderboard (Cloudflare Pages Function + D1) ----------
async function submitScore(name) {
  try {
    await fetch("/api/scores", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
  } catch (_) { /* sin backend: el juego funciona igual */ }
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
    box.innerHTML = ""; // sin backend disponible
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
$("#btn-quit").addEventListener("click", () => {
  if (confirm("Salir de la partida actual?")) showScreen("#screen-start");
});

renderPlayerFields();
loadLeaderboard();
