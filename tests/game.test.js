import { test } from "node:test";
import assert from "node:assert/strict";

import { Game } from "../js/game.js";
import {
  TERRITORIES, CONTINENTS, INITIAL_ARMIES,
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
    assert.equal(g.setupRemaining[p.id], INITIAL_ARMIES[2] - owned.length);
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
test("reinforcementsFor: minimo 3 + bonus de continente", () => {
  const g = newGame();
  ownOnly(g, 0, byCont("america_sur", 5)); // 5 territorios, continente completo, bonus 2
  // max(3, floor(5/3)) + 2 = 3 + 2
  assert.equal(g.reinforcementsFor(0), 5);
});

test("reinforcementsFor: continente grande con bonus", () => {
  const g = newGame();
  ownOnly(g, 0, byCont("america_norte", 9)); // bonus 5
  // max(3, floor(9/3)) + 5 = 3 + 5
  assert.equal(g.reinforcementsFor(0), 8);
});

test("reinforcementsFor: base >3 sin completar continente", () => {
  const g = newGame();
  ownOnly(g, 0, [...byCont("asia", 8), ...byCont("africa", 4)]); // 12, ninguno completo
  // max(3, floor(12/3)) + 0 = 4
  assert.equal(g.reinforcementsFor(0), 4);
});

// ---------- combate ----------
test("canAttack respeta fase, propiedad, adyacencia y ejercitos", () => {
  const g = newGame();
  g.phase = "attack";
  g.pendingConquest = null;
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

test("attack: atacante gana, conquista y fija pendingConquest", () => {
  const g = newGame();
  g.phase = "attack";
  g.pendingConquest = null;
  g.board["alaska"] = { owner: 0, armies: 5 };   // atkCount = 3
  g.board["kamchatka"] = { owner: 1, armies: 1 }; // defCount = 1
  // 3 dados atacante = 6, 1 dado defensor = 1
  const res = withDice([0.9, 0.9, 0.9, 0.0], () => g.attack("alaska", "kamchatka"));
  assert.equal(res.atkLoss, 0);
  assert.equal(res.defLoss, 1);
  assert.equal(res.conquered, true);
  assert.equal(g.board["kamchatka"].owner, 0);
  assert.deepEqual(g.pendingConquest, { from: "alaska", to: "kamchatka", min: 3, max: 4 });
});

test("attack: empate gana defensor (sin conquista)", () => {
  const g = newGame();
  g.phase = "attack";
  g.pendingConquest = null;
  g.board["alaska"] = { owner: 0, armies: 3 };   // atkCount = 2
  g.board["kamchatka"] = { owner: 1, armies: 2 }; // defCount = 2
  // todos los dados = 3 -> empate en ambos pares -> atacante pierde 2
  const res = withDice([0.4, 0.4, 0.4, 0.4], () => g.attack("alaska", "kamchatka"));
  assert.equal(res.atkLoss, 2);
  assert.equal(res.defLoss, 0);
  assert.equal(res.conquered, false);
  assert.equal(g.board["alaska"].armies, 1);
  assert.equal(g.board["kamchatka"].armies, 2);
  assert.equal(g.pendingConquest, null);
});

test("moveAfterConquest clampa el conteo a [min, max]", () => {
  const g = newGame();
  ownOnly(g, 1, ["argentina"]); // el rival conserva un territorio (sin victoria)
  g.board["alaska"] = { owner: 0, armies: 6 };
  g.board["kamchatka"] = { owner: 0, armies: 0 };
  g.pendingConquest = { from: "alaska", to: "kamchatka", min: 3, max: 5 };
  assert.equal(g.moveAfterConquest(10), true); // pedido 10 -> clamp a max 5
  assert.equal(g.board["alaska"].armies, 1);
  assert.equal(g.board["kamchatka"].armies, 5);
  assert.equal(g.pendingConquest, null);
});

test("moveAfterConquest respeta el minimo", () => {
  const g = newGame();
  ownOnly(g, 1, ["argentina"]);
  g.board["alaska"] = { owner: 0, armies: 6 };
  g.board["kamchatka"] = { owner: 0, armies: 0 };
  g.pendingConquest = { from: "alaska", to: "kamchatka", min: 3, max: 5 };
  g.moveAfterConquest(1); // pedido 1 -> clamp a min 3
  assert.equal(g.board["kamchatka"].armies, 3);
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

test("endAttack bloquea con conquista pendiente", () => {
  const g = newGame();
  g.phase = "attack";
  g.pendingConquest = { from: "a", to: "b", min: 1, max: 1 };
  assert.equal(g.endAttack(), false);
  g.pendingConquest = null;
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
