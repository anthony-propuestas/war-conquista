import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CONTINENTS, TERRITORIES, ADJACENCY, buildAdjacency,
  INITIAL_ARMIES, CARD_TRADE_VALUES, CARD_SYMBOLS,
} from "../js/map-data.js";

test("hay 42 territorios y cada continente existe", () => {
  const ids = Object.keys(TERRITORIES);
  assert.equal(ids.length, 42);
  for (const id of ids) {
    assert.ok(CONTINENTS[TERRITORIES[id].continent], `continente desconocido en ${id}`);
  }
});

test("ADJACENCY es simetrica y referencia ids validos", () => {
  const ids = new Set(Object.keys(TERRITORIES));
  for (const [from, list] of Object.entries(ADJACENCY)) {
    for (const to of list) {
      assert.ok(ids.has(to), `${from} es adyacente a id inexistente ${to}`);
      assert.notEqual(to, from, `${from} no debe ser adyacente a si mismo`);
      assert.ok(ADJACENCY[to].includes(from), `falta arista inversa ${to}->${from}`);
    }
  }
});

test("todo territorio tiene al menos una adyacencia", () => {
  for (const id of Object.keys(TERRITORIES)) {
    assert.ok(ADJACENCY[id] && ADJACENCY[id].length > 0, `${id} sin adyacencias`);
  }
});

test("buildAdjacency devuelve arrays y coincide con la export ADJACENCY", () => {
  const adj = buildAdjacency();
  for (const id of Object.keys(adj)) {
    assert.ok(Array.isArray(adj[id]), `${id} deberia ser array`);
    assert.deepEqual([...adj[id]].sort(), [...ADJACENCY[id]].sort());
  }
});

test("constantes de reglas con la forma esperada", () => {
  assert.deepEqual(Object.keys(INITIAL_ARMIES).map(Number).sort((a, b) => a - b), [2, 3, 4, 5, 6]);
  assert.deepEqual(CARD_TRADE_VALUES, [4, 6, 8, 10, 12, 15]);
  assert.deepEqual(CARD_SYMBOLS, ["infanteria", "caballeria", "artilleria"]);
});
