// ============================================================
//  WAR - Interfaz: render del mapa SVG, sidebar e interaccion
// ============================================================

import { TERRITORIES, CONTINENTS, ADJACENCY } from "./map-data.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const CARD_ICON = { infanteria: "🪖", caballeria: "🐎", artilleria: "💣" };

function svg(tag, attrs = {}) {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}
const $ = (sel) => document.querySelector(sel);

// ----- geometria del mapa: costas organicas por continente -----
function convexHull(points) {
  const pts = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length <= 3) return pts;
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

// expande el casco hacia afuera (mas puntos + ruido) -> costa irregular
function expandCoast(hull, pad) {
  const cx = hull.reduce((s, p) => s + p.x, 0) / hull.length;
  const cy = hull.reduce((s, p) => s + p.y, 0) / hull.length;
  const dense = [];
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    dense.push(a, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  }
  return dense.map((p) => {
    const dx = p.x - cx, dy = p.y - cy;
    const len = Math.hypot(dx, dy) || 1;
    const noise = Math.sin(p.x * 12.9898 + p.y * 78.233) * 43758.5453;
    const jit = ((noise - Math.floor(noise)) - 0.5) * 30;
    const dist = pad + jit;
    return { x: p.x + (dx / len) * dist, y: p.y + (dy / len) * dist };
  });
}

// spline cerrada Catmull-Rom -> path SVG suave
function smoothClosedPath(pts) {
  const n = pts.length;
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)} `;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
    d += `C ${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)} `;
  }
  return d + "Z";
}

function hexToRgb(h) { h = h.replace("#", ""); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
function mixColor(hex, target, t) {
  const c = hexToRgb(hex);
  const ch = (i) => Math.round(c[i] + (target[i] - c[i]) * t);
  return `rgb(${ch(0)},${ch(1)},${ch(2)})`;
}
const lighten = (hex, t) => mixColor(hex, [255, 255, 255], t);
const darken = (hex, t) => mixColor(hex, [12, 22, 34], t);

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export class UI {
  constructor(game, onGameOver) {
    this.game = game;
    this.onGameOver = onGameOver;
    this.selected = null;       // territorio seleccionado
    this.selectedCards = new Set();
    this.nodes = {};            // id -> { g, circle, count }
    this.gameOverHandled = false;

    this.buildMap();
    this.bindStatic();
    this.refresh();
  }

  // ---------- construccion del mapa (una vez) ----------
  buildMap() {
    const map = $("#map");
    map.innerHTML = "";

    // 0) defs: sombra de tierra + degradado de relieve por continente
    const defs = svg("defs");
    const shadow = svg("filter", { id: "landShadow", x: "-25%", y: "-25%", width: "150%", height: "150%" });
    shadow.appendChild(svg("feDropShadow", {
      dx: 0, dy: 7, stdDeviation: 11, "flood-color": "#03101c", "flood-opacity": "0.5",
    }));
    defs.appendChild(shadow);
    for (const [cid, cont] of Object.entries(CONTINENTS)) {
      const lg = svg("linearGradient", { id: `grad-${cid}`, x1: 0, y1: 0, x2: 0, y2: 1 });
      lg.appendChild(svg("stop", { offset: "0%", "stop-color": lighten(cont.color, 0.45) }));
      lg.appendChild(svg("stop", { offset: "52%", "stop-color": cont.color }));
      lg.appendChild(svg("stop", { offset: "100%", "stop-color": darken(cont.color, 0.4) }));
      defs.appendChild(lg);
    }
    map.appendChild(defs);

    // 1) oceano: reticula de meridianos y paralelos
    const grid = svg("g", { class: "graticule" });
    for (let x = 0; x <= 1100; x += 100) grid.appendChild(svg("line", { x1: x, y1: 0, x2: x, y2: 640 }));
    for (let y = 0; y <= 640; y += 80) grid.appendChild(svg("line", { x1: 0, y1: y, x2: 1100, y2: y }));
    map.appendChild(grid);

    // 2) masas de tierra: casco convexo suavizado por continente
    const land = svg("g", { filter: "url(#landShadow)" });
    const labels = svg("g");
    for (const [cid, cont] of Object.entries(CONTINENTS)) {
      const ids = Object.keys(TERRITORIES).filter((id) => TERRITORIES[id].continent === cid);
      const pts = ids.map((id) => ({ x: TERRITORIES[id].x, y: TERRITORIES[id].y }));
      const coast = expandCoast(convexHull(pts), 58);
      const d = smoothClosedPath(coast);
      land.appendChild(svg("path", { d, class: "shoreline" }));
      land.appendChild(svg("path", { d, class: "landmass", fill: `url(#grad-${cid})` }));
      const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
      const minY = Math.min(...pts.map((p) => p.y));
      const label = svg("text", { x: cx, y: minY - 30, class: "continent-label" });
      label.textContent = `${cont.name.toUpperCase()}  +${cont.bonus}`;
      labels.appendChild(label);
    }
    map.appendChild(land);
    map.appendChild(labels);

    // 3) rutas de adyacencia (cada par una vez)
    const lines = svg("g");
    const seen = new Set();
    for (const [from, neighbors] of Object.entries(ADJACENCY)) {
      for (const to of neighbors) {
        const key = [from, to].sort().join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        const a = TERRITORIES[from], b = TERRITORIES[to];
        // no dibujar lineas que cruzan todo el mapa (ej. Alaska-Kamchatka)
        if (Math.abs(a.x - b.x) > 520) continue;
        lines.appendChild(svg("line", {
          x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: "adj-line",
        }));
      }
    }
    map.appendChild(lines);

    // 4) territorios
    const layer = svg("g");
    for (const [id, t] of Object.entries(TERRITORIES)) {
      const g = svg("g", { class: "terr", "data-id": id });
      const circle = svg("circle", { class: "node", cx: t.x, cy: t.y, r: 20 });
      const count = svg("text", { class: "count", x: t.x, y: t.y });
      const label = svg("text", { class: "label", x: t.x, y: t.y + 34 });
      label.textContent = t.name;
      g.append(circle, count, label);
      g.addEventListener("click", (e) => this.onTerritoryClick(id, e));
      layer.appendChild(g);
      this.nodes[id] = { g, circle, count };
    }
    map.appendChild(layer);
  }

  bindStatic() {
    $("#btn-trade").addEventListener("click", () => this.tradeSelectedCards());
  }

  // ---------- refresco completo ----------
  refresh() {
    this.updateMap();
    this.updateSidebar();
    this.updateBanner();
    if (this.game.phase === "gameover" && !this.gameOverHandled) {
      this.gameOverHandled = true;
      this.onGameOver(this.game.winner);
    }
  }

  updateMap() {
    const g = this.game;
    const sel = this.selected;
    for (const [id, node] of Object.entries(this.nodes)) {
      const cell = g.board[id];
      const owner = cell.owner != null ? g.players[cell.owner] : null;
      node.circle.setAttribute("fill", owner ? owner.color : "#5a6b7d");
      node.count.textContent = cell.armies;
      node.g.classList.remove("selectable", "selected", "target", "dim");
    }

    // resaltar segun fase
    if (g.phase === "reinforce") {
      this.forEachOwn((id) => this.nodes[id].g.classList.add("selectable"));
    } else if (g.phase === "attack") {
      if (!sel) {
        this.forEachOwn((id) => {
          if (g.armies(id) >= 2 && this.hasEnemyNeighbor(id))
            this.nodes[id].g.classList.add("selectable");
        });
      } else {
        this.nodes[sel].g.classList.add("selected");
        for (const nb of ADJACENCY[sel]) {
          if (g.owner(nb) !== g.current.id)
            this.nodes[nb].g.classList.add("target");
        }
      }
    } else if (g.phase === "fortify") {
      if (!sel) {
        this.forEachOwn((id) => {
          if (g.armies(id) >= 2 && this.hasOwnNeighbor(id))
            this.nodes[id].g.classList.add("selectable");
        });
      } else {
        this.nodes[sel].g.classList.add("selected");
        for (const nb of ADJACENCY[sel]) {
          if (g.owner(nb) === g.current.id)
            this.nodes[nb].g.classList.add("target");
        }
      }
    } else if (g.phase === "setup") {
      this.forEachOwn((id) => this.nodes[id].g.classList.add("selectable"));
    }
  }

  forEachOwn(fn) {
    const pid = this.game.current.id;
    for (const id of Object.keys(this.nodes))
      if (this.game.owner(id) === pid) fn(id);
  }
  hasEnemyNeighbor(id) {
    return ADJACENCY[id].some((nb) => this.game.owner(nb) !== this.game.current.id);
  }
  hasOwnNeighbor(id) {
    return ADJACENCY[id].some((nb) => this.game.owner(nb) === this.game.current.id);
  }

  // ---------- banner y sidebar ----------
  updateBanner() {
    const g = this.game;
    const p = g.current;
    const topbar = document.querySelector(".topbar");
    if (topbar) topbar.style.setProperty("--turn-color", p.color);

    // stepper de fases
    const order = { reinforce: 0, attack: 1, fortify: 2 };
    const steps = g.phase === "setup"
      ? [["setup", "Despliegue"]]
      : [["reinforce", "Refuerzo"], ["attack", "Ataque"], ["fortify", "Fortificacion"]];
    const cur = order[g.phase] ?? 0;
    const stepsHtml = steps.map(([key, label]) => {
      let cls = "step";
      if (g.phase === "setup") cls += " current";
      else if (order[key] < cur) cls += " done";
      else if (order[key] === cur) cls += " current";
      return `<span class="${cls}">${label}</span>`;
    }).join('<span class="step-sep">›</span>');

    const initial = (p.name.trim().charAt(0) || "?").toUpperCase();
    $("#turn-banner").innerHTML = `
      <div class="turn-card">
        <span class="turn-avatar" style="background:${p.color}">${escapeHtml(initial)}</span>
        <div class="turn-meta">
          <span class="turn-label">Turno de</span>
          <span class="turn-name">${escapeHtml(p.name)}</span>
        </div>
      </div>
      <div class="phase-steps">${stepsHtml}</div>`;
  }

  updateSidebar() {
    const g = this.game;
    this.renderPhaseBox();
    this.renderActions();
    this.renderCards();
    this.renderPlayers();
    this.renderLog();
  }

  renderPhaseBox() {
    const g = this.game;
    const box = $("#phase-box");
    const labels = {
      setup: "Despliegue", reinforce: "Refuerzo",
      attack: "Ataque", fortify: "Fortificacion", gameover: "Fin",
    };
    const hints = {
      setup: `Coloca tus ejercitos en tus territorios. Restantes: ${g.setupRemaining[g.current.id]}`,
      reinforce: "Haz clic en tus territorios para colocar tropas. (Shift+clic = 5)",
      attack: "Elige un territorio propio y ataca a un vecino enemigo.",
      fortify: "Mueve tropas entre dos territorios propios conectados.",
      gameover: "Partida terminada.",
    };
    let extra = "";
    if (g.phase === "reinforce")
      extra = `<div class="reinforce-num">${g.reinforcements} <span style="font-size:.9rem;color:var(--ink-dim)">tropas</span></div>`;
    if (g.phase === "setup")
      extra = `<div class="reinforce-num">${g.setupRemaining[g.current.id]} <span style="font-size:.9rem;color:var(--ink-dim)">por colocar</span></div>`;
    box.innerHTML = `
      <div class="phase-name">${labels[g.phase]}</div>
      ${extra}
      <div class="phase-hint">${hints[g.phase]}</div>`;
  }

  renderActions() {
    const g = this.game;
    const box = $("#action-box");
    box.innerHTML = "";
    const addBtn = (text, cls, fn, disabled = false) => {
      const b = document.createElement("button");
      b.className = `btn ${cls}`;
      b.textContent = text;
      b.disabled = disabled;
      b.addEventListener("click", fn);
      box.appendChild(b);
    };

    if (g.phase === "setup") {
      addBtn("Auto-colocar mis tropas", "btn-small", () => {
        g.autoPlaceSetup(); this.selected = null; this.refresh();
      });
    } else if (g.phase === "reinforce") {
      addBtn("Terminar refuerzo →", "btn-primary",
        () => { if (g.endReinforce()) { this.selected = null; this.refresh(); } },
        g.reinforcements > 0);
    } else if (g.phase === "attack") {
      addBtn("Terminar ataque →", "btn-ok",
        () => { if (g.endAttack()) { this.selected = null; this.hideDice(); this.refresh(); } });
    } else if (g.phase === "fortify") {
      addBtn("Saltar y terminar turno", "btn-small",
        () => { this.selected = null; this.hideDice(); g.skipFortify(); this.refresh(); });
    }
  }

  renderCards() {
    const g = this.game;
    const list = $("#cards-list");
    list.innerHTML = "";
    $("#cards-count").textContent = g.current.cards.length;
    g.current.cards.forEach((c, i) => {
      const el = document.createElement("div");
      el.className = "card" + (this.selectedCards.has(i) ? " sel" : "");
      el.textContent = CARD_ICON[c.symbol] || "★";
      el.title = c.symbol;
      el.addEventListener("click", () => {
        if (this.selectedCards.has(i)) this.selectedCards.delete(i);
        else this.selectedCards.add(i);
        this.renderCards();
      });
      list.appendChild(el);
    });
    const trade = $("#btn-trade");
    const valid = g.phase === "reinforce" && g.isValidSet([...this.selectedCards]);
    trade.disabled = !valid;
    trade.textContent = g.mustTradeCards() && g.phase === "reinforce"
      ? "Canjear (obligatorio)" : "Canjear set";
  }

  tradeSelectedCards() {
    if (this.game.tradeCards([...this.selectedCards])) {
      this.selectedCards.clear();
      this.refresh();
    }
  }

  renderPlayers() {
    const g = this.game;
    const ul = $("#players-list");
    ul.innerHTML = "";
    for (const p of g.players) {
      const li = document.createElement("li");
      li.style.setProperty("--pc", p.color);
      if (p.id === g.current.id) li.classList.add("active");
      if (!p.alive) li.classList.add("dead");
      const sw = document.createElement("span");
      sw.className = "swatch"; sw.style.background = p.color;
      const name = document.createElement("span");
      name.textContent = p.name;
      const tc = document.createElement("span");
      tc.className = "terr-count";
      tc.textContent = `${g.territoriesOf(p.id).length} 🗺`;
      li.append(sw, name, tc);
      ul.appendChild(li);
    }
  }

  renderLog() {
    const ul = $("#log-list");
    ul.innerHTML = "";
    this.game.log.slice(-40).forEach((entry) => {
      const li = document.createElement("li");
      li.textContent = entry.msg;
      ul.appendChild(li);
    });
  }

  // ---------- clic en territorio ----------
  onTerritoryClick(id, e) {
    const g = this.game;
    if (g.phase === "setup") {
      if (g.placeSetupArmy(id)) this.refresh();
      return;
    }
    if (g.phase === "reinforce") {
      if (g.owner(id) === g.current.id) {
        const amount = e && e.shiftKey ? 5 : 1;
        g.placeReinforcement(id, amount);
        this.refresh();
      }
      return;
    }
    if (g.phase === "attack") { this.handleAttackClick(id); return; }
    if (g.phase === "fortify") { this.handleFortifyClick(id); return; }
  }

  handleAttackClick(id) {
    const g = this.game;
    if (!this.selected) {
      if (g.owner(id) === g.current.id && g.armies(id) >= 2 && this.hasEnemyNeighbor(id)) {
        this.selected = id; this.updateMap();
      }
      return;
    }
    if (id === this.selected) { this.selected = null; this.updateMap(); return; }
    if (g.owner(id) === g.current.id) {
      // reseleccionar
      if (g.armies(id) >= 2) { this.selected = id; this.updateMap(); }
      return;
    }
    // intentar atacar
    if (g.canAttack(this.selected, id)) {
      const res = g.attack(this.selected, id);
      this.showDice(res);
      if (res.conquered) {
        this.openConquestModal();
      } else {
        if (g.armies(this.selected) < 2) this.selected = null;
        this.refresh();
      }
    }
  }

  handleFortifyClick(id) {
    const g = this.game;
    if (!this.selected) {
      if (g.owner(id) === g.current.id && g.armies(id) >= 2 && this.hasOwnNeighbor(id)) {
        this.selected = id; this.updateMap();
      }
      return;
    }
    if (id === this.selected) { this.selected = null; this.updateMap(); return; }
    if (g.canFortify(this.selected, id)) {
      this.openFortifyModal(this.selected, id);
    } else if (g.owner(id) === g.current.id && g.armies(id) >= 2) {
      this.selected = id; this.updateMap();
    }
  }

  // ---------- dados ----------
  showDice(res) {
    const tray = $("#dice-tray");
    tray.classList.remove("hidden");
    const dieRow = (dice, cls, otherDice) => dice.map((d, i) => {
      let mark = "";
      if (otherDice[i] !== undefined) {
        if (cls === "atk") mark = d > otherDice[i] ? "win" : "lose";
        else mark = d >= otherDice[i] ? "win" : "lose";
      }
      return `<div class="die ${cls} ${mark}">${d}</div>`;
    }).join("");
    tray.innerHTML = `
      <div class="dice-group">
        <h4>Atacante</h4>
        <div class="dice-row">${dieRow(res.atkDice, "atk", res.defDice)}</div>
      </div>
      <div class="dice-group">
        <h4>Defensor</h4>
        <div class="dice-row">${dieRow(res.defDice, "def", res.atkDice)}</div>
      </div>`;
  }
  hideDice() { $("#dice-tray").classList.add("hidden"); }

  // ---------- modales ----------
  openModal(html) {
    $("#modal-card").innerHTML = html;
    $("#modal").classList.remove("hidden");
  }
  closeModal() { $("#modal").classList.add("hidden"); }

  openConquestModal() {
    const g = this.game;
    const { from, to, min, max } = g.pendingConquest;
    const val = min;
    this.openModal(`
      <h2>Territorio conquistado</h2>
      <p>Mueve tus ejercitos a <b>${TERRITORIES[to].name}</b> desde ${TERRITORIES[from].name}.</p>
      <div class="row">
        <input type="range" id="m-range" min="${min}" max="${max}" value="${val}" />
        <b id="m-val" style="min-width:2ch;text-align:center">${val}</b>
      </div>
      <div class="modal-actions">
        <button class="btn btn-primary" id="m-ok">Mover</button>
      </div>`);
    const range = $("#m-range"), out = $("#m-val");
    range.addEventListener("input", () => out.textContent = range.value);
    $("#m-ok").addEventListener("click", () => {
      g.moveAfterConquest(parseInt(range.value, 10));
      this.closeModal();
      if (g.armies(this.selected) < 2) this.selected = null;
      this.refresh();
    });
  }

  openFortifyModal(from, to) {
    const g = this.game;
    const max = g.armies(from) - 1;
    this.openModal(`
      <h2>Fortificar</h2>
      <p>Mover tropas de ${TERRITORIES[from].name} a <b>${TERRITORIES[to].name}</b>.</p>
      <div class="row">
        <input type="range" id="f-range" min="1" max="${max}" value="${max}" />
        <b id="f-val" style="min-width:2ch;text-align:center">${max}</b>
      </div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="f-cancel">Cancelar</button>
        <button class="btn btn-primary" id="f-ok">Mover y terminar turno</button>
      </div>`);
    const range = $("#f-range"), out = $("#f-val");
    range.addEventListener("input", () => out.textContent = range.value);
    $("#f-cancel").addEventListener("click", () => this.closeModal());
    $("#f-ok").addEventListener("click", () => {
      g.fortify(from, to, parseInt(range.value, 10));
      this.closeModal();
      this.selected = null;
      this.hideDice();
      this.refresh();
    });
  }
}
