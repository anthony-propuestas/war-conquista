// ============================================================
//  Generador de formas del mapa (dev-only, ejecutar una vez)
//  Fuente: Natural Earth via world-atlas (DOMINIO PUBLICO).
//  Proyeccion: geoNaturalEarth1 (aspecto de mapamundi real).
//  Salida: js/map-shapes.js  ->  TERRITORY_SHAPES, TERRITORY_CENTERS,
//          MAP_VIEWBOX, SEA_ROUTES
//
//  Casi todos los territorios = union de paises completos.
//  EE.UU., Canada, Rusia y Australia se reparten en varios
//  territorios con cortes geograficos (bordes internos rectos,
//  como el tablero clasico de Risk).
// ============================================================
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import * as topojson from "topojson-client";
import { geoPath, geoNaturalEarth1 } from "d3-geo";
import { geoProject } from "d3-geo-projection";

const require = createRequire(import.meta.url);
const topo = require("world-atlas/countries-110m.json");

const W = 1000, H = 560, PAD = 16;
const VIEWBOX = `0 0 ${W} ${H}`;

const fc = topojson.feature(topo, topo.objects.countries);
const byName = new Map(fc.features.map((f) => [f.properties.name, f]));
// geometrias de la topologia (conservan arcos compartidos) -> permiten disolver
// fronteras internas con topojson.merge
const geomByName = new Map(
  topo.objects.countries.geometries.map((g) => [g.properties.name, g]),
);

// proyeccion global (mundo completo, centrado)
const projection = geoNaturalEarth1().fitExtent(
  [[PAD, PAD], [W - PAD, H - PAD]],
  { type: "Sphere" },
);
const path = geoPath(projection);

// ---------- territorios = union de paises completos ----------
const GROUPS = {
  groenlandia: ["Greenland"],
  centroamerica: ["Mexico", "Guatemala", "Belize", "Honduras", "El Salvador",
    "Nicaragua", "Costa Rica", "Panama", "Cuba", "Jamaica", "Haiti",
    "Dominican Rep.", "Bahamas", "Puerto Rico", "Trinidad and Tobago"],

  venezuela: ["Venezuela", "Colombia", "Guyana", "Suriname", "Ecuador"],
  peru: ["Peru", "Bolivia", "Chile", "Paraguay"],
  brasil: ["Brazil"],
  argentina: ["Argentina", "Uruguay", "Falkland Is."],

  islandia: ["Iceland"],
  granbretana: ["United Kingdom", "Ireland"],
  escandinavia: ["Norway", "Sweden", "Finland", "Denmark"],
  europa_norte: ["Germany", "Poland", "Czechia", "Austria", "Switzerland",
    "Netherlands", "Belgium", "Luxembourg", "Slovakia", "Hungary", "Slovenia"],
  europa_oeste: ["France", "Spain", "Portugal"],
  europa_sur: ["Italy", "Croatia", "Bosnia and Herz.", "Serbia", "Montenegro",
    "Kosovo", "Albania", "Macedonia", "Greece", "Bulgaria", "Romania"],
  ucrania: ["Ukraine", "Belarus", "Estonia", "Latvia", "Lithuania", "Moldova"],

  africa_norte: ["Morocco", "W. Sahara", "Algeria", "Tunisia", "Libya",
    "Mauritania", "Mali", "Niger", "Senegal", "Gambia", "Guinea",
    "Guinea-Bissau", "Sierra Leone", "Liberia", "Côte d'Ivoire", "Ghana",
    "Togo", "Benin", "Burkina Faso", "Nigeria", "Chad", "Cameroon"],
  egipto: ["Egypt"],
  africa_este: ["Sudan", "S. Sudan", "Ethiopia", "Eritrea", "Djibouti",
    "Somalia", "Somaliland", "Kenya", "Uganda", "Rwanda", "Burundi", "Tanzania"],
  congo: ["Dem. Rep. Congo", "Congo", "Central African Rep.", "Gabon",
    "Eq. Guinea", "Angola", "Zambia"],
  africa_sur: ["South Africa", "Namibia", "Botswana", "Zimbabwe", "Mozambique",
    "Malawi", "Lesotho", "eSwatini"],
  madagascar: ["Madagascar"],

  afganistan: ["Afghanistan", "Kazakhstan", "Uzbekistan", "Turkmenistan",
    "Kyrgyzstan", "Tajikistan"],
  medio_oriente: ["Turkey", "Syria", "Lebanon", "Israel", "Palestine", "Jordan",
    "Iraq", "Iran", "Saudi Arabia", "Yemen", "Oman", "United Arab Emirates",
    "Qatar", "Kuwait", "Georgia", "Armenia", "Azerbaijan", "Cyprus", "N. Cyprus"],
  india: ["India", "Pakistan", "Bangladesh", "Nepal", "Bhutan", "Sri Lanka"],
  china: ["China", "Taiwan", "North Korea", "South Korea"],
  mongolia: ["Mongolia"],
  japon: ["Japan"],
  siam: ["Myanmar", "Thailand", "Laos", "Cambodia", "Vietnam", "Malaysia", "Brunei"],

  indonesia: ["Indonesia", "Timor-Leste", "Philippines"],
  nueva_guinea: ["Papua New Guinea", "Solomon Is.", "Vanuatu", "New Caledonia", "Fiji"],
};

// ---------- territorios que parten un pais (cortes geograficos) ----------
// box = [lonMin, lonMax, latMin, latMax]; multiples boxes => union.
// Para Rusia se normalizan longitudes negativas (+360) antes de cortar.
const SPLITS = {
  // Estados Unidos
  alaska:     { country: "United States of America", dropEastHemi: true, boxes: [[-180, -129, 50, 75]] },
  oeste_eeuu: { country: "United States of America", dropEastHemi: true, boxes: [[-130, -100, 24, 50]] },
  este_eeuu:  { country: "United States of America", dropEastHemi: true, boxes: [[-100, -66, 24, 50]] },
  // Canada
  noroeste: { country: "Canada", boxes: [[-141, -52, 60, 84]] },
  alberta:  { country: "Canada", boxes: [[-141, -95, 41, 60]] },
  ontario:  { country: "Canada", boxes: [[-95, -78, 41, 60]] },
  quebec:   { country: "Canada", boxes: [[-78, -52, 41, 60]] },
  // Rusia (lon original; la proyeccion envuelve >180, asi que el trozo
  // de Chukotka al otro lado del antimeridiano se descarta por la caja)
  ural:      { country: "Russia", boxes: [[19, 66, 41, 82]] },
  siberia:   { country: "Russia", boxes: [[66, 100, 41, 82]] },
  yakutsk:   { country: "Russia", boxes: [[100, 150, 58, 82]] },
  irkutsk:   { country: "Russia", boxes: [[100, 150, 41, 58]] },
  kamchatka: { country: "Russia", boxes: [[150, 180, 41, 82]] },
  // Australia
  australia_oeste: { country: "Australia", boxes: [[110, 133, -45, -9]] },
  australia_este:  { country: "Australia", boxes: [[133, 155, -45, -9]] },
};

// Ajustes manuales del centro de la etiqueta (coords proyectadas del viewBox).
// Normalmente vacio: polylabel ya garantiza un punto interior. Usar solo si
// alguna etiqueta concreta queda esteticamente mal pese a estar dentro.
const CENTER_OVERRIDES = {};

// ---------- utilidades de geometria ----------
function polygonsOf(feature) {
  const g = feature.geometry;
  return g.type === "Polygon" ? [g.coordinates] : g.coordinates; // array de poligonos
}

// Sutherland-Hodgman contra una caja alineada a ejes [xMin,xMax,yMin,yMax]
function clipRing(ring, [xMin, xMax, yMin, yMax]) {
  const clipEdge = (pts, inside, intersect) => {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const cur = pts[i], prev = pts[(i - 1 + pts.length) % pts.length];
      const curIn = inside(cur), prevIn = inside(prev);
      if (curIn) {
        if (!prevIn) out.push(intersect(prev, cur));
        out.push(cur);
      } else if (prevIn) {
        out.push(intersect(prev, cur));
      }
    }
    return out;
  };
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  let r = ring;
  r = clipEdge(r, (p) => p[0] >= xMin, (a, b) => lerp(a, b, (xMin - a[0]) / (b[0] - a[0])));
  r = clipEdge(r, (p) => p[0] <= xMax, (a, b) => lerp(a, b, (xMax - a[0]) / (b[0] - a[0])));
  r = clipEdge(r, (p) => p[1] >= yMin, (a, b) => lerp(a, b, (yMin - a[1]) / (b[1] - a[1])));
  r = clipEdge(r, (p) => p[1] <= yMax, (a, b) => lerp(a, b, (yMax - a[1]) / (b[1] - a[1])));
  return r;
}

function ringAreaProj(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i], [x2, y2] = ring[(i + 1) % ring.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}
function ringCentroidProj(ring) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i], [x2, y2] = ring[(i + 1) % ring.length];
    const cross = x1 * y2 - x2 * y1;
    a += cross; cx += (x1 + x2) * cross; cy += (y1 + y2) * cross;
  }
  a /= 2;
  if (!a) return null;
  return [cx / (6 * a), cy / (6 * a)];
}

// ---------- polo de inaccesibilidad (algoritmo de Mapbox polylabel) ----------
// Devuelve el punto INTERIOR mas alejado de cualquier borde -> garantizado
// dentro de la forma, a diferencia del centroide de area que en poligonos
// concavos o multiparte cae en el mar o sobre el vecino.
function segDistSq(px, py, a, b) {
  let x = a[0], y = a[1], dx = b[0] - x, dy = b[1] - y;
  if (dx !== 0 || dy !== 0) {
    const t = ((px - x) * dx + (py - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) { x = b[0]; y = b[1]; }
    else if (t > 0) { x += dx * t; y += dy * t; }
  }
  dx = px - x; dy = py - y;
  return dx * dx + dy * dy;
}
// distancia con signo a un poligono (anillo exterior + huecos); positiva = dentro
function pointToPolyDist(x, y, rings) {
  let inside = false, minSq = Infinity;
  for (const ring of rings) {
    for (let i = 0, len = ring.length, j = len - 1; i < len; j = i++) {
      const a = ring[i], b = ring[j];
      if ((a[1] > y) !== (b[1] > y) &&
          x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
      minSq = Math.min(minSq, segDistSq(x, y, a, b));
    }
  }
  return (inside ? 1 : -1) * Math.sqrt(minSq);
}
function makeCell(x, y, h, rings) {
  const d = pointToPolyDist(x, y, rings);
  return { x, y, h, d, max: d + h * Math.SQRT2 };
}
function centroidCell(rings) {
  let area = 0, x = 0, y = 0;
  const ring = rings[0];
  for (let i = 0, len = ring.length, j = len - 1; i < len; j = i++) {
    const a = ring[i], b = ring[j], f = a[0] * b[1] - b[0] * a[1];
    x += (a[0] + b[0]) * f; y += (a[1] + b[1]) * f; area += f * 3;
  }
  if (area === 0) return makeCell(ring[0][0], ring[0][1], 0, rings);
  return makeCell(x / area, y / area, 0, rings);
}
function polylabel(rings, precision = 0.5) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of rings[0]) {
    if (p[0] < minX) minX = p[0]; if (p[1] < minY) minY = p[1];
    if (p[0] > maxX) maxX = p[0]; if (p[1] > maxY) maxY = p[1];
  }
  const width = maxX - minX, height = maxY - minY;
  const cellSize = Math.max(1e-9, Math.min(width, height)), h = cellSize / 2;
  const queue = [];
  for (let x = minX; x < maxX; x += cellSize)
    for (let y = minY; y < maxY; y += cellSize)
      queue.push(makeCell(x + h, y + h, h, rings));
  let best = centroidCell(rings);
  const bbox = makeCell(minX + width / 2, minY + height / 2, 0, rings);
  if (bbox.d > best.d) best = bbox;
  while (queue.length) {
    let bi = 0;
    for (let i = 1; i < queue.length; i++) if (queue[i].max > queue[bi].max) bi = i;
    const cell = queue.splice(bi, 1)[0];
    if (cell.d > best.d) best = cell;
    if (cell.max - best.d <= precision) continue;
    const hh = cell.h / 2;
    queue.push(makeCell(cell.x - hh, cell.y - hh, hh, rings));
    queue.push(makeCell(cell.x + hh, cell.y - hh, hh, rings));
    queue.push(makeCell(cell.x - hh, cell.y + hh, hh, rings));
    queue.push(makeCell(cell.x + hh, cell.y + hh, hh, rings));
  }
  return [best.x, best.y];
}
// limpia anillos (descarta no-finitos / degenerados) listos para polylabel
function cleanRings(poly) {
  return poly.map((r) => r.filter((p) => p && isFinite(p[0]) && isFinite(p[1])))
             .filter((r) => r.length >= 3);
}
// de un MultiPolygon proyectado, elige el poligono de mayor area (ignora islas)
// y devuelve el punto-etiqueta interior en coordenadas de pantalla.
function labelPointFromPolys(polys) {
  let best = null, bestA = -Infinity;
  for (const poly of polys) {
    const rings = cleanRings(poly);
    if (!rings.length) continue;
    const a = ringAreaProj(rings[0]);
    if (a > bestA) { bestA = a; best = rings; }
  }
  if (!best) return null;
  const [x, y] = polylabel(best);
  return [fmt(x), fmt(y)];
}

function fmt(n) { return Math.round(n * 10) / 10; }
function ringToPath(projRing) {
  let d = `M${fmt(projRing[0][0])},${fmt(projRing[0][1])}`;
  for (let i = 1; i < projRing.length; i++) d += `L${fmt(projRing[i][0])},${fmt(projRing[i][1])}`;
  return d + "Z";
}

// ---------- construir un territorio dividido ----------
// Proyecta cada anillo del pais a coordenadas de pantalla y luego recorta
// con clipRing (espacio plano), evitando que d3-geo distorsione los bordes
// rectos del clip al interpretarlos como arcos geodesicos.
const projectedCache = new Map();
function projectedFeature(name) {
  if (!projectedCache.has(name)) {
    // geoProject usa el stream de la proyeccion: corta el antimeridiano (evita
    // las bandas horizontales en paises que cruzan +-180, p.ej. Rusia/Alaska)
    // y remuestrea, devolviendo el feature en coordenadas de pantalla planas.
    projectedCache.set(name, geoProject(byName.get(name), projection));
  }
  return projectedCache.get(name);
}

function buildSplit(def) {
  const feat = byName.get(def.country);
  if (!feat) throw new Error("pais no encontrado: " + def.country);

  const [lonMin, lonMax, latMin, latMax] = def.boxes[0];

  // caja de clip en coordenadas de pantalla
  const corners = [
    [lonMin, latMin], [lonMax, latMin],
    [lonMax, latMax], [lonMin, latMax],
  ].map((c) => projection(c)).filter(Boolean);
  const xs = corners.map((c) => c[0]), ys = corners.map((c) => c[1]);
  const clipBox = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];

  // anillos ya proyectados (antimeridiano cortado), luego recortar en espacio plano
  const rings = [];
  for (const poly of polygonsOf(projectedFeature(def.country))) {
    const projRing = poly[0].filter((p) => p && isFinite(p[0]) && isFinite(p[1]));
    if (projRing.length < 3) continue;
    const clipped = clipRing(projRing, clipBox);
    if (clipped.length >= 3) rings.push(clipped);
  }

  if (!rings.length) {
    console.warn("  ! buildSplit: sin geometria:", def.country, clipBox);
    return { d: "", center: [0, 0], clip: null };
  }

  // etiqueta: los splits son rectangulos geograficos, asi que el CENTRO del
  // bounding-box de la mayor pieza queda visualmente centrado. polylabel (max
  // holgura) lo dejaba pegado a un lado / sobre el vecino. Si el centro del bbox
  // cae dentro de la pieza lo usamos; si no (p.ej. Canada -> Bahia de Hudson),
  // caemos al polo de inaccesibilidad, que garantiza un punto interior.
  let biggest = null, bigA = -Infinity;
  for (const r of rings) { const a = ringAreaProj(r); if (a > bigA) { bigA = a; biggest = r; } }
  const xs2 = biggest.map((p) => p[0]), ys2 = biggest.map((p) => p[1]);
  const bx = (Math.min(...xs2) + Math.max(...xs2)) / 2;
  const by = (Math.min(...ys2) + Math.max(...ys2)) / 2;
  const center = pointToPolyDist(bx, by, [biggest]) > 0
    ? [fmt(bx), fmt(by)]
    : labelPointFromPolys(rings.map((r) => [r])) ?? [0, 0];
  return { d: rings.map(ringToPath).join(" "), center, clip: null };
}

// ---------- construir un territorio = union de paises ----------
function buildGroup(names) {
  const geoms = names.map((n) => geomByName.get(n)).filter(Boolean);
  const missing = names.filter((n) => !geomByName.get(n));
  if (missing.length) console.warn("  ! paises no hallados:", missing.join(", "));
  // merge disuelve los arcos compartidos: solo queda el perimetro exterior de la
  // union, sin las fronteras internas entre paises de la misma zona de juego
  const merged = topojson.merge(topo, geoms);
  const d = path(merged);
  // proyecta la union a pantalla (igual que geoPath: corta antimeridiano y
  // remuestrea) y coloca la etiqueta en el punto interior del mayor poligono
  const projected = geoProject({ type: "Feature", geometry: merged, properties: {} }, projection);
  const center = labelPointFromPolys(polygonsOf(projected)) ?? [0, 0];
  return { d, center };
}

// ---------- ejecutar ----------
const SHAPES = {};
const CENTERS = {};
const CLIPS = {};   // solo para splits: [x0, y0, x1, y1] en coordenadas proyectadas
const assigned = new Set();

for (const [id, names] of Object.entries(GROUPS)) {
  const { d, center } = buildGroup(names);
  if (!d) { console.warn("VACIO:", id); continue; }
  SHAPES[id] = d; CENTERS[id] = center;
  names.forEach((n) => assigned.add(n));
}
for (const [id, def] of Object.entries(SPLITS)) {
  const { d, center, clip } = buildSplit(def);
  if (!d) { console.warn("VACIO:", id); continue; }
  SHAPES[id] = d; CENTERS[id] = center;
  if (clip) CLIPS[id] = clip;
  assigned.add(def.country);
}

// overrides manuales de centro de etiqueta
for (const [id, c] of Object.entries(CENTER_OVERRIDES)) {
  if (CENTERS[id]) CENTERS[id] = c;
}

// reporte de paises sin asignar (informativo)
const SKIP = new Set(["Antarctica", "Fr. S. Antarctic Lands", "New Zealand"]);
const unassigned = [...byName.keys()].filter((n) => !assigned.has(n) && !SKIP.has(n));
if (unassigned.length) console.warn("\nPaises SIN asignar:", unassigned.join(", "));

// rutas maritimas (conexiones por agua que la frontera no implica)
const SEA_ROUTES = [
  ["alaska", "kamchatka"],
  ["groenlandia", "islandia"],
  ["brasil", "africa_norte"],
  ["europa_sur", "africa_norte"],
  ["europa_sur", "egipto"],
  ["africa_este", "medio_oriente"],
  ["siam", "indonesia"],
  ["indonesia", "australia_oeste"],
  ["nueva_guinea", "australia_este"],
  ["japon", "kamchatka"],
  ["japon", "mongolia"],
  ["granbretana", "islandia"],
  ["granbretana", "europa_norte"],
];

// ---------- escribir salida ----------
const out = `// ============================================================
//  WAR - Formas geograficas del mapa (GENERADO automaticamente)
//  Generado por scripts/build-map-shapes.mjs
//  Datos: Natural Earth via world-atlas (DOMINIO PUBLICO)
//  Proyeccion: geoNaturalEarth1 · viewBox ${VIEWBOX}
//  No editar a mano: re-generar con  npm run build:map
// ============================================================

export const MAP_VIEWBOX = ${JSON.stringify(VIEWBOX)};

export const TERRITORY_SHAPES = {
${Object.entries(SHAPES).map(([id, d]) => `  ${id}: ${JSON.stringify(d)},`).join("\n")}
};

export const TERRITORY_CENTERS = {
${Object.entries(CENTERS).map(([id, c]) => `  ${id}: [${c[0]}, ${c[1]}],`).join("\n")}
};

export const SEA_ROUTES = ${JSON.stringify(SEA_ROUTES)};

export const TERRITORY_CLIPS = {
${Object.entries(CLIPS).map(([id, r]) => `  ${id}: [${r[0]}, ${r[1]}, ${r[2]}, ${r[3]}],`).join("\n")}
};
`;

const dir = dirname(fileURLToPath(import.meta.url));
const dest = join(dir, "..", "js", "map-shapes.js");
writeFileSync(dest, out);
console.log(`\nOK -> js/map-shapes.js  (${Object.keys(SHAPES).length} territorios)`);
