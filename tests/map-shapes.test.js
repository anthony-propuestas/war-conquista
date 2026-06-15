import { test } from "node:test";
import assert from "node:assert/strict";
import { TERRITORIES, ADJACENCY } from "../js/map-data.js";
import { TERRITORY_SHAPES, TERRITORY_CENTERS, SEA_ROUTES } from "../js/map-shapes.js";

const terrIds = new Set(Object.keys(TERRITORIES));

test("cada territorio tiene forma y centro validos", () => {
  for (const id of terrIds) {
    const d = TERRITORY_SHAPES[id];
    assert.ok(d && d.length > 10, `${id}: forma ausente o vacia`);
    const c = TERRITORY_CENTERS[id];
    assert.ok(Array.isArray(c) && !isNaN(c[0]) && !isNaN(c[1]), `${id}: centro invalido`);
    assert.ok(c[0] >= 0 && c[0] <= 1000 && c[1] >= 0 && c[1] <= 560,
      `${id}: centro fuera del viewBox (${c})`);
  }
});

test("el numero de cada territorio cae DENTRO de su forma", () => {
  // subpaths separados por M; cada uno x,y(L x,y)*Z  (sin curvas)
  const parseRings = (d) =>
    d.split("M").filter(Boolean).map((sub) =>
      sub.replace(/Z\s*$/i, "").split("L").map((tok) => {
        const [x, y] = tok.trim().split(",").map(Number);
        return [x, y];
      }).filter((p) => isFinite(p[0]) && isFinite(p[1])),
    ).filter((r) => r.length >= 3);
  // even-odd sobre todos los anillos (respeta huecos)
  const inside = (x, y, rings) => {
    let c = false;
    for (const ring of rings)
      for (let i = 0, n = ring.length, j = n - 1; i < n; j = i++) {
        const a = ring[i], b = ring[j];
        if ((a[1] > y) !== (b[1] > y) &&
            x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
      }
    return c;
  };
  for (const id of terrIds) {
    const [cx, cy] = TERRITORY_CENTERS[id];
    assert.ok(inside(cx, cy, parseRings(TERRITORY_SHAPES[id])),
      `${id}: la etiqueta (${cx},${cy}) cae fuera de su zona`);
  }
});

test("no hay formas de ids inexistentes", () => {
  for (const id of Object.keys(TERRITORY_SHAPES)) {
    assert.ok(terrIds.has(id), `forma huerfana: ${id}`);
  }
});

test("SEA_ROUTES referencian ids validos y adyacentes", () => {
  for (const [a, b] of SEA_ROUTES) {
    assert.ok(terrIds.has(a), `SEA_ROUTES: id invalido ${a}`);
    assert.ok(terrIds.has(b), `SEA_ROUTES: id invalido ${b}`);
    assert.ok(
      ADJACENCY[a]?.includes(b),
      `SEA_ROUTE [${a},${b}] no esta en ADJACENCY`,
    );
  }
});
