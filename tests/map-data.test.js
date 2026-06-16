import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CONTINENTS, TERRITORIES, ADJACENCY, buildAdjacency,
  INITIAL_ARMIES,
} from "../js/map-data.js";

test("hay 44 territorios y cada continente existe", () => {
  const ids = Object.keys(TERRITORIES);
  assert.equal(ids.length, 44);
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
  assert.deepEqual(Object.keys(INITIAL_ARMIES).map(Number).sort((a, b) => a - b), [1, 2, 3]);
});
