import { test } from "node:test";
import assert from "node:assert/strict";

import { Game } from "../js/game.js";
import {
  TERRITORIES, INITIAL_ARMIES, CARD_TRADE_VALUES,
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
test("constructor reparte los 42 territorios sin dueño null", () => {
  const g = newGame();
  const owned = ALL_IDS.filter((id) => g.board[id].owner !== null);
  assert.equal(owned.length, 42);
  for (const id of ALL_IDS) assert.equal(g.board[id].armies, 1);
  // 42 / 2 jugadores = 21 cada uno
  assert.equal(g.territoriesOf(0).length, 21);
  assert.equal(g.territoriesOf(1).length, 21);
  assert.equal(g.setupRemaining[0], INITIAL_ARMIES[2] - 21);
  assert.equal(g.setupRemaining[1], INITIAL_ARMIES[2] - 21);
  assert.equal(g.phase, "setup");
});

// ---------- refuerzos ----------
test("reinforcementsFor: minimo 3 + bonus de continente", () => {
  const g = newGame();
  ownOnly(g, 0, byCont("america_sur", 4)); // 4 territorios, continente completo, bonus 2
  // max(3, floor(4/3)) + 2 = 3 + 2
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

// ---------- cartas ----------
test("isValidSet: 3 iguales o 3 distintas validan; lo demas no", () => {
  const g = newGame();
  g.players[0].cards = [
    { symbol: "infanteria" }, { symbol: "infanteria" }, { symbol: "infanteria" },
    { symbol: "caballeria" }, { symbol: "artilleria" },
  ];
  assert.equal(g.isValidSet([0, 1, 2]), true);   // 3 iguales
  assert.equal(g.isValidSet([0, 3, 4]), true);   // 3 distintas
  assert.equal(g.isValidSet([0, 1, 3]), false);  // 2+1
  assert.equal(g.isValidSet([0, 1]), false);     // longitud != 3
  assert.equal(g.isValidSet([0, 1, 99]), false); // indice inexistente
});

test("tradeCards: otorga el primer valor de la secuencia y remueve las cartas", () => {
  const g = newGame();
  g.phase = "reinforce";
  g.reinforcements = 0;
  g.cardTradeCount = 0;
  g.players[0].cards = [
    { symbol: "infanteria" }, { symbol: "infanteria" }, { symbol: "infanteria" },
  ];
  assert.equal(g.tradeCards([0, 1, 2]), true);
  assert.equal(g.reinforcements, CARD_TRADE_VALUES[0]); // 4
  assert.equal(g.players[0].cards.length, 0);
  assert.equal(g.cardTradeCount, 1);
});

test("tradeCards: escala +5 tras agotar la secuencia", () => {
  const g = newGame();
  g.phase = "reinforce";
  g.reinforcements = 0;
  g.cardTradeCount = CARD_TRADE_VALUES.length; // 6
  g.players[0].cards = [
    { symbol: "caballeria" }, { symbol: "caballeria" }, { symbol: "caballeria" },
  ];
  g.tradeCards([0, 1, 2]);
  // ultimo valor (15) + 5*(6-6+1) = 20
  assert.equal(g.reinforcements, CARD_TRADE_VALUES.at(-1) + 5);
});

test("tradeCards: +2 de bonus por carta de territorio propio", () => {
  const g = newGame();
  g.phase = "reinforce";
  g.reinforcements = 0;
  g.cardTradeCount = 0;
  g.board["brasil"] = { owner: 0, armies: 1 };
  g.players[0].cards = [
    { symbol: "infanteria", territory: "brasil" },
    { symbol: "infanteria" }, { symbol: "infanteria" },
  ];
  g.tradeCards([0, 1, 2]);
  assert.equal(g.reinforcements, CARD_TRADE_VALUES[0] + 2); // 4 + 2
});

test("mustTradeCards con 5 o mas cartas", () => {
  const g = newGame();
  g.players[0].cards = Array.from({ length: 5 }, () => ({ symbol: "infanteria" }));
  assert.equal(g.mustTradeCards(), true);
  g.players[0].cards.pop();
  assert.equal(g.mustTradeCards(), false);
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
  g.conqueredThisTurn = false;
  assert.equal(g.skipFortify(), true);
  assert.equal(g.currentIndex, 1);
  assert.equal(g.phase, "reinforce");
});

// ---------- victoria / eliminacion ----------
test("_checkElimination elimina al jugador sin territorios y transfiere cartas", () => {
  const g = newGame();
  ownOnly(g, 0, ALL_IDS); // jugador 1 se queda sin nada
  g.currentIndex = 0;
  g.players[0].cards = [];
  g.players[1].cards = [{ symbol: "infanteria" }];
  g._checkElimination();
  assert.equal(g.players[1].alive, false);
  assert.deepEqual(g.players[1].cards, []);
  assert.equal(g.players[0].cards.length, 1);
});

test("_checkWin declara ganador al poseer los 42 territorios", () => {
  const g = newGame();
  ownOnly(g, 0, ALL_IDS);
  g.currentIndex = 0;
  g._checkWin();
  assert.equal(g.phase, "gameover");
  assert.equal(g.winner, g.players[0]);
});
