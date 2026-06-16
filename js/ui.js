// ============================================================
//  WAR - Interfaz: render del mapa SVG, sidebar e interaccion
// ============================================================

import { TERRITORIES, CONTINENTS, ADJACENCY } from "./map-data.js";
import { TERRITORY_SHAPES, TERRITORY_CENTERS, MAP_VIEWBOX, SEA_ROUTES, TERRITORY_CLIPS } from "./map-shapes.js";
import { initPixiOverlay, playBattleAnimation } from "./pixi-overlay.js";

const SVG_NS = "http://www.w3.org/2000/svg";

const PLAYER_SHAPES = [
  "M 0,-8 C 4.4,-8 8,-4.4 8,0 C 8,4.4 4.4,8 0,8 C -4.4,8 -8,4.4 -8,0 C -8,-4.4 -4.4,-8 0,-8 Z",
  "M -7.1,-7.1 L 7.1,-7.1 L 7.1,7.1 L -7.1,7.1 Z",
  "M 0,-8 L 2.32,-3.2 L 7.6,-2.48 L 3.84,1.2 L 4.72,6.48 L 0,4 L -4.72,6.48 L -3.84,1.2 L -7.6,-2.48 L -2.32,-3.2 Z",
  "M 0,-8 L 6.4,0 L 0,8 L -6.4,0 Z",
  "M 0,-8 L 8,5.84 L -8,5.84 Z",
  "M 0,-8 L 6.96,-4 L 6.96,4 L 0,8 L -6.96,4 L -6.96,-4 Z",
];

function svg(tag, attrs = {}) {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}
const $ = (sel) => document.querySelector(sel);

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export class UI {
  constructor(game, onGameOver) {
    this.game = game;
    this.onGameOver = onGameOver;
    this.selected = null;       // territorio seleccionado
    this.nodes = {};            // id -> { g, circle, count }
    this.gameOverHandled = false;

    this.buildMap();
    this.refresh();
    initPixiOverlay($("#map")).catch(() => {});
  }

  // ---------- construccion del mapa (una vez) ----------
  buildMap() {
    const map = $("#map");
    map.innerHTML = "";
    const DISPLAY_VIEWBOX = "0 15 1000 460"; // recorta el oceano vacio sin mover territorios
    map.setAttribute("viewBox", DISPLAY_VIEWBOX);
    const [VX, VY, W, H] = DISPLAY_VIEWBOX.split(" ").map(Number);

    // 0) defs: sombra de tierra + clipPaths para territorios partidos
    const defs = svg("defs");
    const shadow = svg("filter", { id: "landShadow", x: "-20%", y: "-20%", width: "140%", height: "140%" });
    shadow.appendChild(svg("feDropShadow", {
      dx: 0, dy: 5, stdDeviation: 7, "flood-color": "#03101c", "flood-opacity": "0.45",
    }));
    defs.appendChild(shadow);
    for (const [id, r] of Object.entries(TERRITORY_CLIPS)) {
      const cp = svg("clipPath", { id: `clip-${id}` });
      cp.appendChild(svg("rect", { x: r[0], y: r[1], width: r[2] - r[0], height: r[3] - r[1] }));
      defs.appendChild(cp);
    }
    map.appendChild(defs);

    // 1) oceano: reticula de meridianos y paralelos
    const grid = svg("g", { class: "graticule" });
    for (let x = VX; x <= VX + W; x += 100) grid.appendChild(svg("line", { x1: x, y1: VY, x2: x, y2: VY + H }));
    for (let y = VY; y <= VY + H; y += 70) grid.appendChild(svg("line", { x1: VX, y1: y, x2: VX + W, y2: y }));
    map.appendChild(grid);

    // 2) rutas maritimas (conexiones por agua; van debajo de la tierra)
    const sea = svg("g", { class: "sea-routes" });
    for (const [a, b] of SEA_ROUTES) {
      const ca = TERRITORY_CENTERS[a], cb = TERRITORY_CENTERS[b];
      if (!ca || !cb) continue;
      sea.appendChild(svg("line", { x1: ca[0], y1: ca[1], x2: cb[0], y2: cb[1], class: "sea-route" }));
    }
    map.appendChild(sea);

    // 3) territorios: silueta geografica real (path) + contador + nombre
    const layer = svg("g", { filter: "url(#landShadow)" });
    for (const [id, t] of Object.entries(TERRITORIES)) {
      const c = TERRITORY_CENTERS[id] || [0, 0];
      const g = svg("g", { class: "terr", "data-id": id, "data-continent": t.continent });
      const region = svg("path", { class: "region", d: TERRITORY_SHAPES[id] || "" });
      if (TERRITORY_CLIPS[id]) region.setAttribute("clip-path", `url(#clip-${id})`);
      const marker = svg("path", { class: "marker", "pointer-events": "none",
        transform: `translate(${c[0]},${c[1]})`, display: "none" });
      const count = svg("text", { class: "count", x: c[0], y: c[1] });
      const label = svg("text", { class: "label", x: c[0], y: c[1] - 9 });
      label.textContent = t.name;
      g.append(region, marker, label, count);
      g.addEventListener("click", (e) => this.onTerritoryClick(id, e));
      layer.appendChild(g);
      this.nodes[id] = { g, region, marker, count };
    }
    map.appendChild(layer);

    // 4) etiquetas de continente (sobre el centroide de sus territorios)
    const contLabels = svg("g");
    for (const [cid, cont] of Object.entries(CONTINENTS)) {
      const ids = Object.keys(TERRITORIES).filter((id) => TERRITORIES[id].continent === cid);
      const cs = ids.map((id) => TERRITORY_CENTERS[id]).filter(Boolean);
      if (!cs.length) continue;
      const cx = cs.reduce((s, p) => s + p[0], 0) / cs.length;
      const minY = Math.min(...cs.map((p) => p[1]));
      const label = svg("text", { x: cx, y: minY - 18, class: "continent-label" });
      label.textContent = `${cont.name.toUpperCase()}  +${cont.bonus}`;
      contLabels.appendChild(label);
    }
    map.appendChild(contLabels);
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
      node.region.setAttribute("fill", owner ? owner.color : "#888888");
      node.count.textContent = cell.armies;
      if (owner) {
        node.marker.setAttribute("d", PLAYER_SHAPES[owner.id] ?? PLAYER_SHAPES[0]);
        node.marker.removeAttribute("display");
      } else {
        node.marker.setAttribute("display", "none");
      }
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
      playBattleAnimation($("#map"), this.selected, id, !!res.conquered);
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
