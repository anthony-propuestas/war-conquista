// ============================================================
//  WAR - Motor del juego (logica pura, sin DOM)
//  Maneja estado, turnos, fases, combate, cartas y victoria.
// ============================================================

import {
  TERRITORIES, CONTINENTS, ADJACENCY, INITIAL_ARMIES,
  CARD_TRADE_VALUES, CARD_SYMBOLS,
} from "./map-data.js";

const ALL_IDS = Object.keys(TERRITORIES);

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const d6 = () => Math.floor(Math.random() * 6) + 1;

export class Game {
  // playerConfigs: [{ name, color }]
  constructor(playerConfigs) {
    this.players = playerConfigs.map((p, i) => ({
      id: i,
      name: p.name,
      color: p.color,
      cards: [],
      alive: true,
    }));
    // estado de cada territorio
    this.board = {};
    for (const id of ALL_IDS) this.board[id] = { owner: null, armies: 0 };

    this.currentIndex = 0;
    this.phase = "setup";          // setup | reinforce | attack | fortify | gameover
    this.reinforcements = 0;       // ejercitos por colocar (refuerzo o setup)
    this.cardTradeCount = 0;       // canjes globales realizados
    this.conqueredThisTurn = false;
    this.pendingConquest = null;   // { from, to, min, max }
    this.fortifyDone = false;
    this.winner = null;
    this.log = [];

    this._distributeTerritories();
  }

  // ---------- helpers ----------
  get current() { return this.players[this.currentIndex]; }

  _log(msg) { this.log.push({ t: Date.now(), msg }); }

  owner(id) { return this.board[id].owner; }
  armies(id) { return this.board[id].armies; }

  territoriesOf(playerId) {
    return ALL_IDS.filter((id) => this.board[id].owner === playerId);
  }

  ownsContinent(playerId, contId) {
    return ALL_IDS
      .filter((id) => TERRITORIES[id].continent === contId)
      .every((id) => this.board[id].owner === playerId);
  }

  // ---------- preparacion ----------
  _distributeTerritories() {
    const ids = shuffle(ALL_IDS);
    const n = this.players.length;
    ids.forEach((id, i) => {
      const owner = i % n;
      this.board[id] = { owner, armies: 1 };
    });
    // ejercitos restantes a colocar por jugador durante el setup
    const initial = INITIAL_ARMIES[n];
    this.setupRemaining = this.players.map(
      (p) => initial - this.territoriesOf(p.id).length
    );
    // empieza el jugador 0 colocando
    this.currentIndex = 0;
    this.phase = "setup";
    this._log(`Partida iniciada con ${n} jugadores. Coloca tus ejercitos.`);
  }

  // coloca 1 ejercito de setup en territorio propio; avanza turno de setup
  placeSetupArmy(id) {
    if (this.phase !== "setup") return false;
    if (this.board[id].owner !== this.current.id) return false;
    if (this.setupRemaining[this.current.id] <= 0) return false;

    this.board[id].armies++;
    this.setupRemaining[this.current.id]--;
    this._advanceSetup();
    return true;
  }

  // coloca automaticamente todos los ejercitos restantes del jugador actual
  autoPlaceSetup() {
    if (this.phase !== "setup") return;
    const pid = this.current.id;
    const mine = this.territoriesOf(pid);
    while (this.setupRemaining[pid] > 0) {
      const id = mine[Math.floor(Math.random() * mine.length)];
      this.board[id].armies++;
      this.setupRemaining[pid]--;
    }
    this._advanceSetup(true);
  }

  _advanceSetup(forceNext = false) {
    // si todos terminaron -> empezar la partida
    if (this.setupRemaining.every((r) => r <= 0)) {
      this._log("Despliegue completo. Comienza la batalla!");
      this.currentIndex = 0;
      this._beginTurn();
      return;
    }
    // pasar al siguiente jugador que aun tenga ejercitos
    do {
      this.currentIndex = (this.currentIndex + 1) % this.players.length;
    } while (this.setupRemaining[this.current.id] <= 0);
  }

  // ---------- inicio de turno / refuerzo ----------
  _beginTurn() {
    this.phase = "reinforce";
    this.conqueredThisTurn = false;
    this.pendingConquest = null;
    this.fortifyDone = false;
    this.reinforcements = this.reinforcementsFor(this.current.id);
    this._log(
      `Turno de ${this.current.name}. Refuerzos: ${this.reinforcements}.`
    );
  }

  reinforcementsFor(playerId) {
    const count = this.territoriesOf(playerId).length;
    let armies = Math.max(3, Math.floor(count / 3));
    for (const contId of Object.keys(CONTINENTS)) {
      if (this.ownsContinent(playerId, contId)) {
        armies += CONTINENTS[contId].bonus;
      }
    }
    return armies;
  }

  placeReinforcement(id, count = 1) {
    if (this.phase !== "reinforce") return false;
    if (this.board[id].owner !== this.current.id) return false;
    if (this.reinforcements <= 0) return false;
    const c = Math.min(count, this.reinforcements);
    this.board[id].armies += c;
    this.reinforcements -= c;
    return true;
  }

  endReinforce() {
    if (this.phase !== "reinforce" || this.reinforcements > 0) return false;
    this.phase = "attack";
    this._log(`${this.current.name} pasa a la fase de ataque.`);
    return true;
  }

  // ---------- cartas ----------
  mustTradeCards() {
    return this.current.cards.length >= 5;
  }

  isValidSet(indices) {
    if (indices.length !== 3) return false;
    const cards = indices.map((i) => this.current.cards[i]);
    if (cards.some((c) => c === undefined)) return false;
    const syms = cards.map((c) => c.symbol);
    const allSame = syms.every((s) => s === syms[0]);
    const allDiff = new Set(syms).size === 3;
    return allSame || allDiff;
  }

  tradeCards(indices) {
    if (this.phase !== "reinforce") return false;
    if (!this.isValidSet(indices)) return false;
    // valor del canje
    const idx = Math.min(this.cardTradeCount, CARD_TRADE_VALUES.length - 1);
    let value = CARD_TRADE_VALUES[idx];
    if (this.cardTradeCount >= CARD_TRADE_VALUES.length) {
      value = CARD_TRADE_VALUES[CARD_TRADE_VALUES.length - 1] +
        5 * (this.cardTradeCount - CARD_TRADE_VALUES.length + 1);
    }
    // bonus: +2 si alguna carta es de un territorio propio
    let bonus = 0;
    const cards = indices.map((i) => this.current.cards[i]);
    for (const c of cards) {
      if (c.territory && this.board[c.territory].owner === this.current.id) {
        bonus = 2; break;
      }
    }
    // remover cartas (de mayor a menor indice)
    [...indices].sort((a, b) => b - a).forEach((i) => this.current.cards.splice(i, 1));
    this.cardTradeCount++;
    this.reinforcements += value + bonus;
    this._log(
      `${this.current.name} canjea cartas: +${value}${bonus ? ` (+${bonus} bonus)` : ""} ejercitos.`
    );
    return true;
  }

  // ---------- combate ----------
  canAttack(fromId, toId) {
    return (
      this.phase === "attack" &&
      !this.pendingConquest &&
      this.board[fromId].owner === this.current.id &&
      this.board[toId].owner !== this.current.id &&
      this.board[fromId].armies >= 2 &&
      ADJACENCY[fromId].includes(toId)
    );
  }

  attack(fromId, toId) {
    if (!this.canAttack(fromId, toId)) return null;

    const atkCount = Math.min(3, this.board[fromId].armies - 1);
    const defCount = Math.min(2, this.board[toId].armies);

    const atkDice = Array.from({ length: atkCount }, d6).sort((a, b) => b - a);
    const defDice = Array.from({ length: defCount }, d6).sort((a, b) => b - a);

    let atkLoss = 0, defLoss = 0;
    const pairs = Math.min(atkDice.length, defDice.length);
    for (let i = 0; i < pairs; i++) {
      if (atkDice[i] > defDice[i]) defLoss++;
      else atkLoss++; // empate gana defensor
    }

    this.board[fromId].armies -= atkLoss;
    this.board[toId].armies -= defLoss;

    const result = {
      from: fromId, to: toId, atkDice, defDice, atkLoss, defLoss,
      conquered: false,
    };

    this._log(
      `${TERRITORIES[fromId].name} ataca ${TERRITORIES[toId].name}: ` +
      `[${atkDice.join(",")}] vs [${defDice.join(",")}] ` +
      `-> atacante -${atkLoss}, defensor -${defLoss}.`
    );

    if (this.board[toId].armies <= 0) {
      result.conquered = true;
      const min = atkCount;                       // al menos los dados usados
      const max = this.board[fromId].armies - 1;  // dejar 1 atras
      this.board[toId].owner = this.current.id;
      this.conqueredThisTurn = true;
      this.pendingConquest = { from: fromId, to: toId, min, max };
      this._log(`${this.current.name} conquista ${TERRITORIES[toId].name}!`);
    }
    return result;
  }

  moveAfterConquest(count) {
    if (!this.pendingConquest) return false;
    const { from, to, min, max } = this.pendingConquest;
    const c = Math.max(min, Math.min(count, max));
    this.board[from].armies -= c;
    this.board[to].armies += c;
    this.pendingConquest = null;
    this._checkElimination();
    this._checkWin();
    return true;
  }

  endAttack() {
    if (this.phase !== "attack" || this.pendingConquest) return false;
    this.phase = "fortify";
    return true;
  }

  // ---------- fortificacion ----------
  canFortify(fromId, toId) {
    return (
      this.phase === "fortify" &&
      !this.fortifyDone &&
      this.board[fromId].owner === this.current.id &&
      this.board[toId].owner === this.current.id &&
      fromId !== toId &&
      this.board[fromId].armies >= 2 &&
      ADJACENCY[fromId].includes(toId)
    );
  }

  fortify(fromId, toId, count) {
    if (!this.canFortify(fromId, toId)) return false;
    const c = Math.max(1, Math.min(count, this.board[fromId].armies - 1));
    this.board[fromId].armies -= c;
    this.board[toId].armies += c;
    this.fortifyDone = true;
    this._log(`${this.current.name} fortifica ${TERRITORIES[toId].name} (+${c}).`);
    this.endTurn();
    return true;
  }

  skipFortify() {
    if (this.phase !== "fortify") return false;
    this.endTurn();
    return true;
  }

  // ---------- fin de turno ----------
  endTurn() {
    // otorgar carta si conquisto al menos un territorio
    if (this.conqueredThisTurn) {
      const symbol = CARD_SYMBOLS[Math.floor(Math.random() * CARD_SYMBOLS.length)];
      const mine = this.territoriesOf(this.current.id);
      const territory = mine[Math.floor(Math.random() * mine.length)];
      this.current.cards.push({ symbol, territory });
      this._log(`${this.current.name} gana una carta de territorio.`);
    }
    // siguiente jugador vivo
    do {
      this.currentIndex = (this.currentIndex + 1) % this.players.length;
    } while (!this.current.alive);
    this._beginTurn();
  }

  _checkElimination() {
    for (const p of this.players) {
      if (p.alive && this.territoriesOf(p.id).length === 0) {
        p.alive = false;
        // transferir sus cartas al jugador actual
        this.current.cards.push(...p.cards);
        p.cards = [];
        this._log(`${p.name} ha sido eliminado!`);
      }
    }
  }

  _checkWin() {
    const alive = this.players.filter((p) => p.alive);
    const allOwned = this.territoriesOf(this.current.id).length === ALL_IDS.length;
    if (alive.length === 1 || allOwned) {
      this.phase = "gameover";
      this.winner = this.current;
      this._log(`VICTORIA de ${this.current.name}! Domina el mundo.`);
    }
  }
}
