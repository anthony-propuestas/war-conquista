import { test } from "node:test";
import assert from "node:assert/strict";

import { Game } from "../js/game.js";
import {
  TERRITORIES, CONTINENTS,
} from "../js/map-data.js";

const ALL_IDS = Object.keys(TERRITORIES);
const newGame = () => new Game([
  { name: "Ana", color: "#f00" },
  { name: "Beto", color: "#00f" },
]);

// Asigna `ids` al jugador `pid` (armies=1) y todo lo demas al rival.
function ownOnly(game, pid, ids) {
  const other = pid === 0 ? 1 : 0;
  for (const id of ALL_IDS) game.board[id] = { owner: other, armies: 1 };
  for (const id of ids) game.board[id] = { owner: pid, armies: 1 };
}

const byCont = (c, k) =>
  ALL_IDS.filter((id) => TERRITORIES[id].continent === c).slice(0, k);

// Stubea Math.random con una secuencia en cola solo durante fn().
function withDice(values, fn) {
  const orig = Math.random;
  let i = 0;
  Math.random = () => values[i++];
  try { return fn(); } finally { Math.random = orig; }
}

// ---------- setup / distribucion ----------
test("constructor entrega un continente completo a cada jugador y deja el resto neutral", () => {
  const g = newGame();
  for (const id of ALL_IDS) assert.equal(g.board[id].armies, 1);

  // cada jugador debe poseer exactamente los territorios de 1 continente
  for (const p of g.players) {
    const owned = g.territoriesOf(p.id);
    const conts = new Set(owned.map((id) => TERRITORIES[id].continent));
    assert.equal(conts.size, 1);
    const [cid] = conts;
    const fullCont = ALL_IDS.filter((id) => TERRITORIES[id].continent === cid);
    assert.equal(owned.length, fullCont.length);
    assert.equal(g.setupRemaining[p.id], 5);
  }

  // los continentes no asignados quedan sin dueño
  const ownedConts = new Set(
    g.players.flatMap((p) => g.territoriesOf(p.id).map((id) => TERRITORIES[id].continent))
  );
  for (const id of ALL_IDS) {
    if (!ownedConts.has(TERRITORIES[id].continent)) {
      assert.equal(g.board[id].owner, null);
    }
  }
  assert.equal(Object.keys(CONTINENTS).length >= 2, true);
  assert.equal(g.phase, "setup");
});

// ---------- refuerzos ----------
test("reinforcementsFor: floor(territorios / 2)", () => {
  const g = newGame();
  ownOnly(g, 0, byCont("america_sur", 6)); // 6 territorios
  assert.equal(g.reinforcementsFor(0), 3); // floor(6/2)
});

test("reinforcementsFor: 9 territorios", () => {
  const g = newGame();
  ownOnly(g, 0, byCont("america_norte", 9));
  assert.equal(g.reinforcementsFor(0), 4); // floor(9/2)
});

test("reinforcementsFor: 12 territorios", () => {
  const g = newGame();
  ownOnly(g, 0, [...byCont("asia", 8), ...byCont("africa", 4)]); // 12
  assert.equal(g.reinforcementsFor(0), 6); // floor(12/2)
});

// ---------- combate ----------
test("canAttack respeta fase, propiedad, adyacencia y ejercitos", () => {
  const g = newGame();
  g.phase = "attack";
  g.attackUnlocked = true;
  g.board["alaska"] = { owner: 0, armies: 5 };
  g.board["kamchatka"] = { owner: 1, armies: 1 };
  assert.equal(g.canAttack("alaska", "kamchatka"), true);

  g.board["alaska"].armies = 1; // muy pocos
  assert.equal(g.canAttack("alaska", "kamchatka"), false);

  g.board["alaska"].armies = 5;
  g.board["kamchatka"].owner = 0; // territorio propio
  assert.equal(g.canAttack("alaska", "kamchatka"), false);

  g.board["kamchatka"].owner = 1;
  assert.equal(g.canAttack("alaska", "japon"), false); // no adyacente

  g.phase = "fortify";
  assert.equal(g.canAttack("alaska", "kamchatka"), false); // fase incorrecta
});

test("attack: atacante gana, conquista y los supervivientes ocupan la zona", () => {
  const g = newGame();
  g.phase = "attack";
  g.attackUnlocked = true;
  g.board["alaska"] = { owner: 0, armies: 5 };
  g.board["kamchatka"] = { owner: 1, armies: 1 }; // defiende con 1
  // atacar con 3 unidades -> 3 dados = 6, 1 dado defensor = 1
  const res = withDice([0.9, 0.9, 0.9, 0.0], () => g.attack("alaska", "kamchatka", 3));
  assert.equal(res.atkLoss, 0);
  assert.equal(res.defLoss, 1);
  assert.equal(res.conquered, true);
  assert.equal(res.moved, 3);                  // supervivientes = atkCount - atkLoss
  assert.equal(g.board["kamchatka"].owner, 0);
  assert.equal(g.board["kamchatka"].armies, 3); // ocupan con los supervivientes
  assert.equal(g.board["alaska"].armies, 2);    // 5 - 3 que salieron
});

test("attack: empate gana defensor (sin conquista)", () => {
  const g = newGame();
  g.phase = "attack";
  g.attackUnlocked = true;
  g.board["alaska"] = { owner: 0, armies: 3 };
  g.board["kamchatka"] = { owner: 1, armies: 2 }; // defiende con 2
  // atacar con 2: todos los dados = 3 -> empate en ambos pares -> atacante pierde 2
  const res = withDice([0.4, 0.4, 0.4, 0.4], () => g.attack("alaska", "kamchatka", 2));
  assert.equal(res.atkLoss, 2);
  assert.equal(res.defLoss, 0);
  assert.equal(res.conquered, false);
  assert.equal(res.moved, undefined);
  assert.equal(g.board["alaska"].armies, 1);
  assert.equal(g.board["kamchatka"].armies, 2);
});

test("maxAttackUnits = armies - 1 (siempre deja 1 atras, minimo 1)", () => {
  const g = newGame();
  g.board["alaska"] = { owner: 0, armies: 5 };
  assert.equal(g.maxAttackUnits("alaska"), 4);
  g.board["alaska"].armies = 1;
  assert.equal(g.maxAttackUnits("alaska"), 1);
});

test("attack sin unidades usa el maximo (armies - 1)", () => {
  const g = newGame();
  g.phase = "attack";
  g.attackUnlocked = true;
  g.board["alaska"] = { owner: 0, armies: 4 };    // maxAtk = 3
  g.board["kamchatka"] = { owner: 1, armies: 1 };
  const res = withDice([0.9, 0.9, 0.9, 0.0], () => g.attack("alaska", "kamchatka"));
  assert.equal(res.conquered, true);
  assert.equal(res.moved, 3);
  assert.equal(g.board["alaska"].armies, 1);     // dejo 1 atras
  assert.equal(g.board["kamchatka"].armies, 3);
});

test("attack con menos unidades deja mas tropas en el origen", () => {
  const g = newGame();
  g.phase = "attack";
  g.attackUnlocked = true;
  g.board["alaska"] = { owner: 0, armies: 10 };
  g.board["kamchatka"] = { owner: 1, armies: 1 };
  // atacar con solo 2 unidades aunque haya 9 disponibles
  const res = withDice([0.9, 0.9, 0.0], () => g.attack("alaska", "kamchatka", 2));
  assert.equal(res.conquered, true);
  assert.equal(res.moved, 2);
  assert.equal(g.board["alaska"].armies, 8);     // 10 - 2 que salieron
  assert.equal(g.board["kamchatka"].armies, 2);
});

// ---------- transiciones de fase ----------
test("endReinforce bloquea con refuerzos pendientes", () => {
  const g = newGame();
  g.phase = "reinforce";
  g.reinforcements = 2;
  assert.equal(g.endReinforce(), false);
  g.reinforcements = 0;
  assert.equal(g.endReinforce(), true);
  assert.equal(g.phase, "attack");
});

test("endAttack pasa a fortify y se rechaza fuera de fase", () => {
  const g = newGame();
  g.phase = "reinforce";
  assert.equal(g.endAttack(), false); // fase incorrecta
  g.phase = "attack";
  assert.equal(g.endAttack(), true);
  assert.equal(g.phase, "fortify");
});

test("skipFortify avanza al siguiente turno", () => {
  const g = newGame();
  ownOnly(g, 0, byCont("america_norte", 9)); // ambos jugadores con territorios
  g.phase = "fortify";
  g.currentIndex = 0;
  assert.equal(g.skipFortify(), true);
  assert.equal(g.currentIndex, 1);
  assert.equal(g.phase, "reinforce");
});

// ---------- victoria / eliminacion ----------
test("_checkElimination elimina al jugador sin territorios", () => {
  const g = newGame();
  ownOnly(g, 0, ALL_IDS); // jugador 1 se queda sin nada
  g.currentIndex = 0;
  g._checkElimination();
  assert.equal(g.players[1].alive, false);
});

test("_checkWin declara ganador al poseer los 44 territorios", () => {
  const g = newGame();
  ownOnly(g, 0, ALL_IDS);
  g.currentIndex = 0;
  g._checkWin();
  assert.equal(g.phase, "gameover");
  assert.equal(g.winner, g.players[0]);
});

// ---------- setup 5-por-jugador ----------
test("setup: setupRemaining es 5 por jugador tras construir", () => {
  const g = newGame();
  assert.equal(g.setupRemaining[0], 5);
  assert.equal(g.setupRemaining[1], 5);
  assert.equal(g.phase, "setup");
});

test("setup: placeSetupArmy mantiene al mismo jugador hasta agotar sus 5", () => {
  const g = newGame();
  const p0Terrs = g.territoriesOf(0);
  for (let i = 0; i < 4; i++) g.placeSetupArmy(p0Terrs[0]);
  assert.equal(g.currentIndex, 0);
  assert.equal(g.setupRemaining[0], 1);
  g.placeSetupArmy(p0Terrs[0]);
  assert.equal(g.currentIndex, 1);
  assert.equal(g.setupRemaining[0], 0);
});

test("setup: autoPlaceSetup de ambos jugadores inicia la partida en reinforce", () => {
  const g = newGame();
  g.autoPlaceSetup(); // coloca los 5 de p0, rota a p1
  g.autoPlaceSetup(); // coloca los 5 de p1, inicia partida
  assert.equal(g.phase, "reinforce");
  assert.equal(g.currentIndex, 0);
});

// ---------- attackUnlocked ----------
test("canAttack devuelve false cuando attackUnlocked es false", () => {
  const g = newGame();
  g.phase = "attack";
  g.board["alaska"] = { owner: 0, armies: 5 };
  g.board["kamchatka"] = { owner: 1, armies: 1 };
  // attackUnlocked sigue false por defecto
  assert.equal(g.canAttack("alaska", "kamchatka"), false);
});

test("multiples ataques consecutivos en el mismo turno sin limite", () => {
  const g = newGame();
  g.phase = "attack";
  g.attackUnlocked = true;
  g.board["alaska"] = { owner: 0, armies: 5 };
  g.board["kamchatka"] = { owner: 1, armies: 3 };

  // primer ataque con 2 unidades: gana ambos pares, kamchatka 3->1, sin conquista
  const r1 = withDice([0.9, 0.9, 0.0, 0.0, 0.0], () => g.attack("alaska", "kamchatka", 2));
  assert.equal(r1.conquered, false);
  assert.equal(g.board["kamchatka"].armies, 1);
  assert.equal(g.board["alaska"].armies, 5); // no perdio tropas
  assert.equal(g.phase, "attack");

  // canAttack sigue activo en el mismo turno — no hay limite de 1 ataque por turno
  assert.equal(g.canAttack("alaska", "kamchatka"), true);

  // segundo ataque: conquista (kamchatka 1->0)
  const r2 = withDice([0.9, 0.9, 0.0], () => g.attack("alaska", "kamchatka", 2));
  assert.equal(r2.conquered, true);
  assert.equal(g.board["kamchatka"].owner, 0);
});

test("endTurn: attackUnlocked se activa tras la primera ronda completa", () => {
  const g = newGame();
  g.autoPlaceSetup();
  g.autoPlaceSetup(); // fase reinforce, currentIndex=0

  // turno de p0
  g.reinforcements = 0;
  g.endReinforce();   // attack
  g.endAttack();      // fortify
  g.skipFortify();    // endTurn: firstRoundTurnsLeft=1, aun false
  assert.equal(g.attackUnlocked, false);

  // turno de p1
  g.reinforcements = 0;
  g.endReinforce();
  g.endAttack();
  g.skipFortify();    // endTurn: firstRoundTurnsLeft=0, ahora true
  assert.equal(g.attackUnlocked, true);
  assert.ok(g.log.some((e) => e.msg.includes("Primera ronda completa")));
});
