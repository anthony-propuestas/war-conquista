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

    // 1) zonas de continente (bbox calculada)
    const zones = svg("g");
    for (const [cid, cont] of Object.entries(CONTINENTS)) {
      const ids = Object.keys(TERRITORIES).filter(
        (id) => TERRITORIES[id].continent === cid
      );
      const xs = ids.map((id) => TERRITORIES[id].x);
      const ys = ids.map((id) => TERRITORIES[id].y);
      const pad = 42;
      const x = Math.min(...xs) - pad, y = Math.min(...ys) - pad;
      const w = Math.max(...xs) - Math.min(...xs) + pad * 2;
      const h = Math.max(...ys) - Math.min(...ys) + pad * 2;
      const rect = svg("rect", {
        x, y, width: w, height: h, rx: 34,
        fill: cont.color, class: "continent-zone",
      });
      zones.appendChild(rect);
      const label = svg("text", {
        x: x + w / 2, y: y + 16, class: "continent-label",
      });
      label.textContent = `${cont.name.toUpperCase()}  +${cont.bonus}`;
      zones.appendChild(label);
    }
    map.appendChild(zones);

    // 2) lineas de adyacencia (cada par una vez)
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

    // 3) territorios
    const layer = svg("g");
    for (const [id, t] of Object.entries(TERRITORIES)) {
      const g = svg("g", { class: "terr", "data-id": id });
      const circle = svg("circle", { class: "node", cx: t.x, cy: t.y, r: 21 });
      const count = svg("text", { class: "count", x: t.x, y: t.y });
      const label = svg("text", { class: "label", x: t.x, y: t.y + 36 });
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
    const p = this.game.current;
    const banner = $("#turn-banner");
    banner.innerHTML = "";
    const dot = document.createElement("span");
    dot.className = "turn-dot";
    dot.style.background = p.color;
    const txt = document.createElement("span");
    txt.textContent = `Turno de ${p.name}`;
    banner.append(dot, txt);
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
