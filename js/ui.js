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

const TURN_SECONDS = 90;

export class UI {
  constructor(game, onGameOver, opts = {}) {
    this.game = game;
    this.onGameOver = onGameOver;
    this.selected = null;       // territorio seleccionado
    this.nodes = {};            // id -> { g, circle, count }
    this.gameOverHandled = false;
    this.placingMode = false;   // modo colocacion de tropas (activado por boton)
    this.pendingTarget = null;  // zona enemiga pre-seleccionada al hacer clic sin seleccion previa

    // restriccion de turno (solo partidas online en sala)
    this.myIndex = opts.myIndex ?? null;
    this.onlineMode = this.myIndex !== null;

    // items de mejora: copia local para controlar usadas en esta sesion
    this.playerCards = (opts.playerCards || []).map(c => ({ ...c }));
    this.usedInSession = new Set(); // ids de cartas usadas en esta partida (sincronía optimista)
    this.onCardUsed = opts.onCardUsed ?? null;
    this._cunTimer = null;

    // temporizador por fase (solo online y cuando es mi turno)
    this.timerKey = null;
    this.timerHandle = null;
    this.timerRemaining = TURN_SECONDS;

    this.buildMap();
    this.refresh();
    initPixiOverlay($("#map")).catch(() => {});
  }

  isMyTurn() {
    return !this.onlineMode || this.myIndex === this.game.current.id;
  }

  // ---------- construccion del mapa (una vez) ----------
  buildMap() {
    const map = $("#map");
    map.innerHTML = "";
    const DISPLAY_VIEWBOX = "0 0 1000 560"; // espacio SVG completo: todos los territorios visibles
    map.setAttribute("viewBox", DISPLAY_VIEWBOX);
    const [VX, VY, W, H] = DISPLAY_VIEWBOX.split(" ").map(Number);

    // 0) defs: sombra de tierra + clipPaths para territorios partidos
    const defs = svg("defs");
    const shadow = svg("filter", { id: "landShadow", x: "-20%", y: "-20%", width: "140%", height: "140%" });
    shadow.appendChild(svg("feDropShadow", {
      dx: 0, dy: 5, stdDeviation: 7, "flood-color": "#03101c", "flood-opacity": "0.45",
    }));
    defs.appendChild(shadow);
    const arrowMarker = svg("marker", {
      id: "atk-arrow", markerWidth: "8", markerHeight: "6",
      refX: "7", refY: "3", orient: "auto"
    });
    arrowMarker.appendChild(svg("polygon", { points: "0 0, 8 3, 0 6", fill: "white", stroke: "black", "stroke-width": "0.8" }));
    defs.appendChild(arrowMarker);
    for (const [id, r] of Object.entries(TERRITORY_CLIPS)) {
      const cp = svg("clipPath", { id: `clip-${id}` });
      cp.appendChild(svg("rect", { x: r[0], y: r[1], width: r[2] - r[0], height: r[3] - r[1] }));
      defs.appendChild(cp);
    }
    map.appendChild(defs);

    // Viewport group: todo el contenido zoomeable va aquí
    const vp = svg("g", { id: "vp" });

    // 1) oceano: reticula de meridianos y paralelos
    const grid = svg("g", { class: "graticule" });
    for (let x = VX; x <= VX + W; x += 100) grid.appendChild(svg("line", { x1: x, y1: VY, x2: x, y2: VY + H }));
    for (let y = VY; y <= VY + H; y += 70) grid.appendChild(svg("line", { x1: VX, y1: y, x2: VX + W, y2: y }));
    vp.appendChild(grid);

    // 2) rutas maritimas (conexiones por agua; van debajo de la tierra)
    const sea = svg("g", { class: "sea-routes" });
    for (const [a, b] of SEA_ROUTES) {
      const ca = TERRITORY_CENTERS[a], cb = TERRITORY_CENTERS[b];
      if (!ca || !cb) continue;
      sea.appendChild(svg("line", { x1: ca[0], y1: ca[1], x2: cb[0], y2: cb[1], class: "sea-route" }));
    }
    vp.appendChild(sea);

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
    vp.appendChild(layer);

    // 4) etiquetas de continente (sobre el centroide de sus territorios)
    const contLabels = svg("g");
    for (const [cid, cont] of Object.entries(CONTINENTS)) {
      const ids = Object.keys(TERRITORIES).filter((id) => TERRITORIES[id].continent === cid);
      const cs = ids.map((id) => TERRITORY_CENTERS[id]).filter(Boolean);
      if (!cs.length) continue;
      const cx = cs.reduce((s, p) => s + p[0], 0) / cs.length;
      const minY = Math.min(...cs.map((p) => p[1]));
      const label = svg("text", { x: cx, y: minY - 18, class: "continent-label" });
      label.textContent = cont.name.toUpperCase();
      contLabels.appendChild(label);
    }
    vp.appendChild(contLabels);

    this.arrowsLayer = svg("g", { id: "attack-arrows", "pointer-events": "none" });
    vp.appendChild(this.arrowsLayer);
    map.appendChild(vp);

    this._initZoomPan(map);
  }

  // ---------- zoom y pan del mapa ----------
  _initZoomPan(mapEl) {
    const wrap = document.querySelector(".map-wrap");
    this._vp = { tx: 0, ty: 0, scale: 1 };
    this._panMoved = false;

    const applyTransform = () => {
      const { tx, ty, scale } = this._vp;
      document.getElementById("vp")
        .setAttribute("transform", `translate(${tx},${ty}) scale(${scale})`);
    };

    const zoomAround = (cx, cy, factor) => {
      const newScale = Math.min(6, Math.max(0.35, this._vp.scale * factor));
      const ratio = newScale / this._vp.scale;
      this._vp.tx = cx + (this._vp.tx - cx) * ratio;
      this._vp.ty = cy + (this._vp.ty - cy) * ratio;
      this._vp.scale = newScale;
      applyTransform();
    };

    // Convierte coordenadas de pantalla a espacio SVG viewBox
    const toSvg = (clientX, clientY) => {
      const rect = wrap.getBoundingClientRect();
      return [
        (clientX - rect.left) / rect.width  * 1000,
        (clientY - rect.top)  / rect.height * 560,
      ];
    };

    // Zoom con rueda, centrado en la posición del cursor
    wrap.addEventListener("wheel", (e) => {
      e.preventDefault();
      const [mx, my] = toSvg(e.clientX, e.clientY);
      zoomAround(mx, my, e.deltaY < 0 ? 1.15 : 1 / 1.15);
    }, { passive: false });

    // Pan con arrastre de puntero
    let _pan = null;
    mapEl.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      this._panMoved = false;
      _pan = { x: e.clientX, y: e.clientY, tx: this._vp.tx, ty: this._vp.ty, id: e.pointerId, captured: false };
    });
    mapEl.addEventListener("pointermove", (e) => {
      if (!_pan) return;
      const rect = wrap.getBoundingClientRect();
      const dx = (e.clientX - _pan.x) / rect.width  * 1000;
      const dy = (e.clientY - _pan.y) / rect.height * 560;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        this._panMoved = true;
        if (!_pan.captured) { mapEl.setPointerCapture(_pan.id); _pan.captured = true; }
      }
      this._vp.tx = _pan.tx + dx;
      this._vp.ty = _pan.ty + dy;
      applyTransform();
    });
    mapEl.addEventListener("pointerup", () => { _pan = null; });
    mapEl.addEventListener("pointercancel", () => { _pan = null; });

    // Pinch-to-zoom táctil
    let _touches = null;
    wrap.addEventListener("touchstart", (e) => {
      if (e.touches.length === 2) {
        _touches = { d: Math.hypot(
          e.touches[1].clientX - e.touches[0].clientX,
          e.touches[1].clientY - e.touches[0].clientY
        ), scale: this._vp.scale };
        e.preventDefault();
      }
    }, { passive: false });
    wrap.addEventListener("touchmove", (e) => {
      if (e.touches.length === 2 && _touches) {
        const d = Math.hypot(
          e.touches[1].clientX - e.touches[0].clientX,
          e.touches[1].clientY - e.touches[0].clientY
        );
        const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        const [mx, my] = toSvg(midX, midY);
        const newScale = Math.min(6, Math.max(0.35, _touches.scale * d / _touches.d));
        const ratio = newScale / this._vp.scale;
        this._vp.tx = mx + (this._vp.tx - mx) * ratio;
        this._vp.ty = my + (this._vp.ty - my) * ratio;
        this._vp.scale = newScale;
        applyTransform();
        e.preventDefault();
      }
    }, { passive: false });
    wrap.addEventListener("touchend", () => { _touches = null; });

    // Botones de zoom
    document.getElementById("btn-zoom-in")?.addEventListener("click", () => {
      zoomAround(500, 280, 1.3);
    });
    document.getElementById("btn-zoom-out")?.addEventListener("click", () => {
      zoomAround(500, 280, 1 / 1.3);
    });
    document.getElementById("btn-zoom-reset")?.addEventListener("click", () => {
      this._vp = { tx: 0, ty: 0, scale: 1 };
      applyTransform();
    });
  }

  // ---------- refresco completo ----------
  refresh() {
    this.updateMap();
    this.updateSidebar();
    this.updateBanner();
    this.syncTimer();
    if (this.game.phase === "gameover" && !this.gameOverHandled) {
      this.gameOverHandled = true;
      this.onGameOver(this.game.winner);
    }
  }

  // ---------- temporizador de 30s por fase (solo online, solo en mi turno) ----------
  syncTimer() {
    const g = this.game;
    if (!this.isMyTurn() || g.phase === "gameover") {
      this.stopTimer();
      return;
    }
    const key = `${g.currentIndex}`;
    if (key !== this.timerKey) {
      this.timerKey = key;
      this.startTimer();
    }
  }

  startTimer() {
    this.stopTimer();
    this.timerRemaining = TURN_SECONDS;
    this.renderTimer();
    this.timerHandle = setInterval(() => {
      this.timerRemaining--;
      this.renderTimer();
      if (this.timerRemaining <= 0) {
        this.stopTimer();
        this.handleTimeout();
      }
    }, 1000);
  }

  stopTimer() {
    if (this.timerHandle) clearInterval(this.timerHandle);
    this.timerHandle = null;
  }

  renderTimer() {
    const el = $("#turn-timer");
    if (el) el.textContent = `⏱ ${this.timerRemaining}s`;
  }

  handleTimeout() {
    const g = this.game;
    if (g.phase === "setup") {
      g.autoPlaceSetup();
    } else if (g.phase === "play") {
      this.closeModal();
      const mine = g.territoriesOf(g.current.id);
      while (g.reinforcements > 0 && mine.length) {
        g.placeReinforcement(mine[Math.floor(Math.random() * mine.length)], 1);
      }
      g.endTurn();
    }
    this.placingMode = false;
    this.selected = null;
    this.hideDice();
    this.refresh();
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
      node.g.classList.remove("selectable", "selected", "attack-target", "fortify-target",
                               "dim", "enemy-selected", "source-hint");
    }

    // resaltar segun fase (solo si es mi turno)
    if (!this.isMyTurn()) return;
    if (g.phase === "setup") {
      this.forEachOwn((id) => this.nodes[id].g.classList.add("selectable"));
    } else if (g.phase === "play") {
      if (this.placingMode) {
        this.forEachOwn((id) => this.nodes[id].g.classList.add("selectable"));
      } else if (sel) {
        this.nodes[sel].g.classList.add("selected");
        for (const nb of ADJACENCY[sel]) {
          if (g.owner(nb) !== g.current.id) this.nodes[nb].g.classList.add("attack-target");
          else if (nb !== sel) this.nodes[nb].g.classList.add("fortify-target");
        }
      } else if (this.pendingTarget) {
        this.nodes[this.pendingTarget].g.classList.add("enemy-selected");
        this.forEachOwn(oid => {
          if (this.game.canAttack(oid, this.pendingTarget))
            this.nodes[oid].g.classList.add("source-hint");
        });
      } else {
        this.forEachOwn((id) => {
          if (g.armies(id) >= 2 && (this.hasEnemyNeighbor(id) || this.hasOwnNeighbor(id)))
            this.nodes[id].g.classList.add("selectable");
        });
      }
    }

    if (this.arrowsLayer) {
      this.arrowsLayer.innerHTML = "";
      if (sel) {
        const sc = TERRITORY_CENTERS[sel];
        for (const nb of ADJACENCY[sel]) {
          if (g.owner(nb) === g.current.id) continue;
          const tc = TERRITORY_CENTERS[nb];
          if (!sc || !tc) continue;
          const dx = tc[0] - sc[0], dy = tc[1] - sc[1];
          const len = Math.sqrt(dx * dx + dy * dy);
          const ux = dx / len, uy = dy / len;
          const line = svg("line", {
            class: "attack-arrow",
            x1: sc[0] + ux * 22, y1: sc[1] + uy * 22,
            x2: tc[0] - ux * 22, y2: tc[1] - uy * 22,
            stroke: "white", "stroke-width": "2.5",
            "marker-end": "url(#atk-arrow)"
          });
          this.arrowsLayer.appendChild(line);
        }
      }
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

    const phaseLabel = g.phase === "setup" ? "Despliegue" : "Turno libre";
    const attackStatus = !g.attackUnlocked ? `<span class="step locked">Ataques 🔒 primera ronda</span>` : "";

    const initial = (p.name.trim().charAt(0) || "?").toUpperCase();
    $("#turn-banner").innerHTML = `
      <div class="turn-card">
        <span class="turn-avatar" style="background:${p.color}">${escapeHtml(initial)}</span>
        <div class="turn-meta">
          <span class="turn-label">Turno de</span>
          <span class="turn-name">${escapeHtml(p.name)}</span>
        </div>
        ${this.isMyTurn() ? `<span id="turn-timer" class="turn-timer"></span>` : ""}
      </div>
      <div class="phase-steps"><span class="step current">${phaseLabel}</span>${attackStatus}</div>`;
    const notice = document.getElementById('attack-locked-notice');
    if (notice) {
      const show = !g.attackUnlocked && g.phase === 'play' && this.isMyTurn();
      notice.classList.toggle('hidden', !show);
    }
  }

  updateSidebar() {
    const g = this.game;
    this.renderPhaseBox();
    this.renderActions();
    this.renderPlayers();
    this.renderItemsPanel();
    this.renderLog();
  }

  renderPhaseBox() {
    const g = this.game;
    const box = $("#phase-box");
    const labels = { setup: "Despliegue", play: "Turno libre", gameover: "Fin" };
    let extra = "";
    let hint = "";
    if (!this.isMyTurn()) {
      hint = `Esperando turno de ${escapeHtml(g.current.name)}...`;
    } else if (g.phase === "setup") {
      extra = `<div class="reinforce-num">${g.setupRemaining[g.current.id]} <span style="font-size:.9rem;color:var(--ink-dim)">por colocar</span></div>`;
      hint = "Coloca tus ejercitos en tus territorios.";
    } else if (g.phase === "play") {
      if (g.reinforcements > 0)
        extra = `<div class="reinforce-num">${g.reinforcements} <span style="font-size:.9rem;color:var(--ink-dim)">refuerzos</span></div>`;
      hint = g.reinforcements > 0
        ? "Activa 'Colocar tropas' para reforzar. Tambien puedes atacar o mover tropas."
        : "Ataca o mueve tropas libremente. Cuando termines, pulsa 'Terminar turno'.";
    }
    const roundTag = g.phase === "play" ? `<span class="round-tag">Ronda ${g.round}</span>` : "";
    box.innerHTML = `
      <div class="phase-name">${labels[g.phase] ?? g.phase}${roundTag}</div>
      ${extra}
      <div class="phase-hint">${hint}</div>`;
  }

  renderActions() {
    const g = this.game;
    const box = $("#action-box");
    box.innerHTML = "";
    if (!this.isMyTurn()) {
      box.innerHTML = `<div class="waiting-turn">Esperando turno de ${escapeHtml(g.current.name)}...</div>`;
      return;
    }
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
    } else if (g.phase === "play") {
      if (g.reinforcements > 0) {
        const placingCls = this.placingMode ? "btn-primary active" : "btn-ok";
        addBtn(this.placingMode ? "Colocar tropas (activo)" : "Colocar tropas", placingCls, () => {
          this.placingMode = !this.placingMode;
          this.selected = null;
          this.refresh();
        });
      }
      addBtn("Terminar turno", "btn-small", () => {
        this.placingMode = false;
        this.selected = null;
        this.hideDice();
        g.endTurn();
        this.refresh();
      });
      const canSurr = g.canSurrender();
      addBtn(canSurr ? "Rendirse" : "Rendirse (ronda 7+)", "btn-danger", () => {
        if (!confirm("¿Seguro que quieres rendirte? Perderás la partida.")) return;
        g.surrender(g.current.id);
        this.selected = null;
        this.hideDice();
        this.refresh();
      }, !canSurr);
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

  renderItemsPanel() {
    const panel = $("#items-panel");
    if (!panel) return;
    if (!this.playerCards.length) { panel.classList.add("hidden"); return; }
    panel.classList.remove("hidden");
    const ul = $("#items-list");
    ul.innerHTML = "";
    const EFFECT_ICON = { EXTRA_UNITS: "🪖", DOUBLE_ATTACK: "⚔", SHIELD: "🛡" };
    for (const card of this.playerCards) {
      const used = this.usedInSession.has(card.id) || card.used_at != null;
      const li = document.createElement("li");
      li.className = "item-card" + (used ? " item-used" : "");
      const isMyTurn = this.isMyTurn() && this.game.phase === "play";
      li.innerHTML = `
        <span class="item-icon">${EFFECT_ICON[card.effect_type] || "🃏"}</span>
        <span class="item-info">
          <span class="item-name">${escapeHtml(card.name)}</span>
          <span class="item-desc">${escapeHtml(card.description)}</span>
        </span>
        ${!used && isMyTurn
          ? `<button class="btn btn-ok btn-sm item-use-btn" data-id="${card.id}">Usar</button>`
          : `<span class="item-status">${used ? "Usada" : "—"}</span>`}
        ${!used ? `<button class="btn-icon-del" data-id="${card.id}" title="Descartar">✕</button>` : ""}`;
      ul.appendChild(li);
    }

    ul.querySelectorAll(".item-use-btn").forEach(btn => {
      btn.addEventListener("click", () => this._useCard(Number(btn.dataset.id)));
    });
    ul.querySelectorAll(".btn-icon-del").forEach(btn => {
      btn.addEventListener("click", () => this._discardCard(Number(btn.dataset.id)));
    });
  }

  async _useCard(cardId) {
    const card = this.playerCards.find(c => c.id === cardId);
    if (!card || this.usedInSession.has(cardId)) return;
    if (!confirm(`Usar "${card.name}"?`)) return;
    // Apply effect optimistically; mark used before fetch to block double-clicks
    this.game.applyCardEffect(this.game.current.id, card.effect_type, card.effect_value);
    this.usedInSession.add(cardId);
    const player = this.game.players[this.game.current?.id ?? this.myIndex ?? 0];
    this.onCardUsed?.(card, player?.name ?? 'Jugador');
    this.refresh();
    // Persist to API — keep card as used regardless of outcome to prevent double-use
    try {
      const res = await fetch('/api/cards/use', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ card_id: cardId }),
      });
      if (!res.ok && res.status !== 409) {
        console.warn('[cartas] No se registró el uso en el servidor (status', res.status, ')');
      }
    } catch {
      console.warn('[cartas] Error de red al registrar uso de carta');
    }
  }

  async _discardCard(cardId) {
    const card = this.playerCards.find(c => c.id === cardId);
    if (!card) return;
    if (!confirm(`Descartar "${card.name}"? Se eliminará de tu inventario.`)) return;
    this.playerCards = this.playerCards.filter(c => c.id !== cardId);
    fetch(`/api/cards/delete?id=${cardId}`, { method: 'DELETE' }).catch(() => {});
    this.renderItemsPanel();
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
    if (this._panMoved) { this._panMoved = false; return; }
    const g = this.game;
    if (!this.isMyTurn()) return;
    if (g.phase === "setup") {
      if (g.placeSetupArmy(id)) this.refresh();
      return;
    }
    if (g.phase === "play") {
      if (this.placingMode) {
        if (g.owner(id) === g.current.id) {
          const amount = e && e.shiftKey ? 5 : 1;
          g.placeReinforcement(id, amount);
          if (g.reinforcements <= 0) this.placingMode = false;
          this.refresh();
        }
        return;
      }
      this.handlePlayClick(id);
    }
  }

  handlePlayClick(id) {
    const g = this.game;

    // Clic en zona enemiga sin seleccion previa — muestra desde donde atacar
    if (!this.selected && g.owner(id) !== g.current.id) {
      const hasSource = Object.keys(this.nodes).some(oid => g.canAttack(oid, id));
      if (hasSource) {
        this.pendingTarget = (this.pendingTarget === id) ? null : id;
        this.updateMap();
      }
      return;
    }

    // Con pendingTarget activo, clic en zona propia → atacar o seleccionar
    if (this.pendingTarget && !this.selected && g.owner(id) === g.current.id) {
      const target = this.pendingTarget;
      this.pendingTarget = null;
      if (g.canAttack(id, target)) {
        this.openAttackModal(id, target);
      } else if (g.armies(id) >= 2 && (this.hasEnemyNeighbor(id) || this.hasOwnNeighbor(id))) {
        this.selected = id;
        this.updateMap();
      }
      return;
    }

    if (!this.selected) {
      if (g.owner(id) === g.current.id && g.armies(id) >= 2 &&
          (this.hasEnemyNeighbor(id) || this.hasOwnNeighbor(id))) {
        this.pendingTarget = null;
        this.selected = id; this.updateMap();
      }
      return;
    }
    if (id === this.selected) { this.selected = null; this.updateMap(); return; }
    if (g.owner(id) !== g.current.id) {
      // atacar
      if (g.canAttack(this.selected, id)) this.openAttackModal(this.selected, id);
    } else {
      // mover tropas
      if (g.canFortify(this.selected, id)) {
        this.openFortifyModal(this.selected, id);
      } else if (g.armies(id) >= 2) {
        this.selected = id; this.updateMap();
      }
    }
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
    // intentar atacar -> elegir con cuantas unidades
    if (g.canAttack(this.selected, id)) {
      this.openAttackModal(this.selected, id);
    }
  }

  resolveAttack(from, to, units) {
    const g = this.game;
    const res = g.attack(from, to, units);
    if (!res) return;
    this.selected = null;
    this.pendingTarget = null;
    this.refresh();
    this.showDice(res);
    playBattleAnimation($("#map"), from, to, !!res.conquered);
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
    const atk = res.atkDice, def = res.defDice;
    const pairs = Math.min(atk.length, def.length);

    let pairsHTML = '';
    for (let i = 0; i < pairs; i++) {
      const atkWins = atk[i] > def[i];
      pairsHTML += `
        <div class="dice-pair">
          <div class="die atk ${atkWins ? 'win' : 'lose'}">${atk[i]}</div>
          <div class="pair-connector">${atkWins ? '›' : '‹'}</div>
          <div class="die def ${atkWins ? 'lose' : 'win'}">${def[i]}</div>
        </div>`;
    }

    let unmatchedHTML = '';
    const extraAtk = atk.slice(pairs), extraDef = def.slice(pairs);
    if (extraAtk.length || extraDef.length) {
      const mkDie = (d, cls) => `<div class="die ${cls}">${d}</div>`;
      unmatchedHTML = `<div class="dice-unmatched">`;
      if (extraAtk.length) unmatchedHTML += `<div class="unmatched-group"><span class="unmatched-label">Atk</span>${extraAtk.map(d => mkDie(d, 'atk')).join('')}</div>`;
      if (extraDef.length) unmatchedHTML += `<div class="unmatched-group"><span class="unmatched-label">Def</span>${extraDef.map(d => mkDie(d, 'def')).join('')}</div>`;
      unmatchedHTML += `</div>`;
    }

    tray.innerHTML = `
      <div class="dice-tray-title">⚔ Combate</div>
      <div class="dice-pairs">${pairsHTML}</div>
      ${unmatchedHTML}`;
    setTimeout(() => {
      document.addEventListener("click", () => this.hideDice(), { once: true });
    }, 0);
  }
  hideDice() { $("#dice-tray").classList.add("hidden"); this.refresh(); }

  // ---------- modales ----------
  openModal(html) {
    $("#modal-card").innerHTML = html;
    $("#modal").classList.remove("hidden");
  }
  closeModal() { $("#modal").classList.add("hidden"); }

  openAttackModal(from, to) {
    const g = this.game;
    const max = g.maxAttackUnits(from);   // origen - 1 (siempre queda 1)
    const def = g.armies(to);
    this.openModal(`
      <h2>Atacar ${TERRITORIES[to].name}</h2>
      <p>Desde ${TERRITORIES[from].name}. Defiende con <b>${def}</b> ${def === 1 ? "tropa" : "tropas"} (${def} dados).</p>
      <div class="row">
        <input type="range" id="a-range" min="1" max="${max}" value="${max}" />
        <b id="a-val" style="min-width:2ch;text-align:center">${max}</b>
      </div>
      <p class="phase-hint" id="a-hint"></p>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="a-cancel">Cancelar</button>
        <button class="btn btn-primary" id="a-ok">Lanzar dados</button>
      </div>`);
    const range = $("#a-range"), out = $("#a-val"), hint = $("#a-hint");
    const upd = () => {
      out.textContent = range.value;
      hint.textContent = `Atacas con ${range.value} ${range.value === "1" ? "dado" : "dados"}.`;
    };
    upd();
    range.addEventListener("input", upd);
    $("#a-cancel").addEventListener("click", () => this.closeModal());
    $("#a-ok").addEventListener("click", () => {
      const units = parseInt(range.value, 10);
      this.closeModal();
      this.resolveAttack(from, to, units);
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
        <button class="btn btn-primary" id="f-ok">Mover tropas</button>
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

  showEnemyCardNotification({ playerName, card }) {
    const EFFECT_ICON = { EXTRA_UNITS: '🪖', DOUBLE_ATTACK: '⚔', SHIELD: '🛡' };
    const el = document.getElementById('card-used-notif');
    if (!el) return;
    document.getElementById('cun-icon').textContent   = EFFECT_ICON[card.effect_type] || '🃏';
    document.getElementById('cun-name').textContent   = card.name;
    document.getElementById('cun-desc').textContent   = card.description;
    document.getElementById('cun-player').textContent = `Usado por: ${escapeHtml(playerName)}`;
    el.classList.add('visible');
    clearTimeout(this._cunTimer);
    this._cunTimer = setTimeout(() => el.classList.remove('visible'), 4500);
  }
}
