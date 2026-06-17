// ============================================================
//  WAR - Motor del juego (logica pura, sin DOM)
//  Maneja estado, turnos, fases, combate y victoria.
// ============================================================

import {
  TERRITORIES, CONTINENTS, ADJACENCY, INITIAL_ARMIES,
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
      alive: true,
    }));
    // estado de cada territorio
    this.board = {};
    for (const id of ALL_IDS) this.board[id] = { owner: null, armies: 0 };

    this.currentIndex = 0;
    this.phase = "setup";          // setup | reinforce | attack | fortify | gameover
    this.reinforcements = 0;       // ejercitos por colocar (refuerzo o setup)
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
    const contIds = shuffle(Object.keys(CONTINENTS));
    const n = this.players.length;
    for (const id of ALL_IDS) this.board[id] = { owner: null, armies: 1 };
    contIds.slice(0, n).forEach((cid, i) => {
      for (const id of ALL_IDS) {
        if (TERRITORIES[id].continent === cid) this.board[id].owner = i;
      }
    });
    // cada jugador coloca exactamente 5 ejercitos en su turno de setup
    this.setupRemaining = this.players.map(() => 5);
    this.attackUnlocked = false;
    this.firstRoundTurnsLeft = this.players.length;
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
    // solo rotar si el jugador actual ya termino sus 5
    if (this.setupRemaining[this.current.id] <= 0) {
      do {
        this.currentIndex = (this.currentIndex + 1) % this.players.length;
      } while (this.setupRemaining[this.current.id] <= 0);
    }
  }

  // ---------- inicio de turno / refuerzo ----------
  _beginTurn() {
    this.phase = "reinforce";
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

  // ---------- combate ----------
  canAttack(fromId, toId) {
    return (
      this.attackUnlocked &&
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
    if (!this.attackUnlocked) {
      this.firstRoundTurnsLeft--;
      if (this.firstRoundTurnsLeft <= 0) {
        this.attackUnlocked = true;
        this._log("Primera ronda completa. Los ataques ahora estan habilitados.");
      }
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
