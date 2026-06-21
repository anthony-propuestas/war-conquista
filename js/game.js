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
    this.phase = "setup";          // setup | play | gameover
    this.reinforcements = 0;       // ejercitos por colocar
    this.winner = null;
    this.round = 1;                // ronda actual (todos juegan una vez = 1 ronda)
    this._turnsPlayed = 0;
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
    this.phase = "play";
    this.reinforcements = this.reinforcementsFor(this.current.id);
    this._log(
      `Turno de ${this.current.name}. Refuerzos: ${this.reinforcements}.`
    );
  }

  reinforcementsFor(playerId) {
    return Math.floor(this.territoriesOf(playerId).length / 2);
  }

  placeReinforcement(id, count = 1) {
    if (this.phase !== "play") return false;
    if (this.board[id].owner !== this.current.id) return false;
    if (this.reinforcements <= 0) return false;
    const c = Math.min(count, this.reinforcements);
    this.board[id].armies += c;
    this.reinforcements -= c;
    return true;
  }

  // ---------- combate ----------
  canAttack(fromId, toId) {
    return (
      this.attackUnlocked &&
      this.phase === "play" &&
      this.board[fromId].owner === this.current.id &&
      this.board[toId].owner !== this.current.id &&
      this.board[fromId].armies >= 2 &&
      ADJACENCY[fromId].includes(toId)
    );
  }

  // numero maximo de unidades con las que se puede atacar (siempre queda 1 atras)
  maxAttackUnits(fromId) {
    return Math.max(1, this.board[fromId].armies - 1);
  }

  // attackUnits: unidades elegidas para atacar -> tantos dados.
  // El defensor tira con TODAS sus unidades. Se ordenan y comparan por pares
  // (empate gana defensor). Si el defensor llega a 0, las unidades atacantes
  // supervivientes ocupan la zona automaticamente (nunca queda en 0).
  attack(fromId, toId, attackUnits) {
    if (!this.canAttack(fromId, toId)) return null;

    const maxAtk = this.maxAttackUnits(fromId);
    let atkCount = Math.max(1, Math.min(attackUnits | 0 || maxAtk, maxAtk));
    const defCount = this.board[toId].armies; // defiende con todas

    // Doble ataque: duplica dados del atacante esta vez
    if (this._doubleAttack) { atkCount = Math.min(atkCount * 2, this.board[fromId].armies - 1 || 1); this._doubleAttack = false; }

    const atkDice = Array.from({ length: atkCount }, d6).sort((a, b) => b - a);
    let defDice = Array.from({ length: defCount }, d6).sort((a, b) => b - a);

    // Escudo: si el defensor lo tiene activo, sus dados son todos 6
    if (this._shield === this.board[toId].owner) { defDice = defDice.map(() => 6); this._shield = null; }

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
      const survivors = atkCount - atkLoss;     // atacantes que sobrevivieron
      this.board[fromId].armies -= survivors;   // salen del origen (queda >=1)
      this.board[toId].armies = survivors;      // ocupan la zona (>=1)
      this.board[toId].owner = this.current.id;
      result.moved = survivors;
      this._log(`${this.current.name} conquista ${TERRITORIES[toId].name} con ${survivors}!`);
      this._checkElimination();
      this._checkWin();
    }
    return result;
  }

  // ---------- movimiento de tropas ----------
  canFortify(fromId, toId) {
    return (
      this.phase === "play" &&
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
    this._log(`${this.current.name} fortifica ${TERRITORIES[toId].name} (+${c}).`);
    return true;
  }

  skipFortify() {
    if (this.phase !== "play") return false;
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
    this._turnsPlayed++;
    this.round = Math.floor(this._turnsPlayed / this.players.length) + 1;
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
    // ultimo jugador en pie (solo aplica en partidas multijugador)
    if (alive.length === 1 && this.players.length > 1) {
      this.phase = "gameover";
      this.winner = alive[0];
      this._log(`VICTORIA de ${this.winner.name}! Es el ultimo en pie.`);
      return;
    }
    // dominacion total del mapa por el jugador actual
    if (this.current.alive &&
        this.territoriesOf(this.current.id).length === ALL_IDS.length) {
      this.phase = "gameover";
      this.winner = this.current;
      this._log(`VICTORIA de ${this.winner.name}! Domina el mundo.`);
    }
  }

  // ---------- items de mejora ----------
  // effectType: 'EXTRA_UNITS' | 'DOUBLE_ATTACK' | 'SHIELD'
  applyCardEffect(playerId, effectType, effectValue) {
    if (this.phase !== 'play') return false;
    if (this.current.id !== playerId) return false;
    if (effectType === 'EXTRA_UNITS') {
      this.reinforcements += Number(effectValue);
      this._log(`${this.current.name} usa una carta: +${effectValue} refuerzos extra!`);
      return true;
    }
    if (effectType === 'DOUBLE_ATTACK') {
      this._doubleAttack = true;
      this._log(`${this.current.name} activa Doble Ataque!`);
      return true;
    }
    if (effectType === 'SHIELD') {
      this._shield = playerId;
      this._log(`${this.current.name} activa un Escudo!`);
      return true;
    }
    return false;
  }

  // ---------- rendicion ----------
  canSurrender() {
    return this.phase === "play" && this.round >= 7;
  }

  // El jugador abandona: sale del orden de turnos pero sus territorios
  // permanecen en el mapa (conquistables por los demas).
  surrender(playerId) {
    const p = this.players[playerId];
    if (!p || !p.alive || this.phase !== "play") return false;
    p.alive = false;
    this._log(`${p.name} se ha rendido.`);
    this._checkWin();
    if (this.phase !== "gameover" && playerId === this.currentIndex) this.endTurn();
    return true;
  }
}
