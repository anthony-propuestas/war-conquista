// ============================================================
//  WAR - Datos del mapa
//  42 territorios, 6 continentes (mapa clasico estilo WAR/Risk)
//  Cada territorio: id, nombre, continente, x, y (posicion SVG)
//  viewBox del mapa: 0 0 1100 640
// ============================================================

export const CONTINENTS = {
  america_norte: { name: "America del Norte", bonus: 5, color: "#e8b84b" },
  america_sur:   { name: "America del Sur",   bonus: 2, color: "#d9694e" },
  europa:        { name: "Europa",            bonus: 5, color: "#5b8bd0" },
  africa:        { name: "Africa",            bonus: 3, color: "#9c6b3f" },
  asia:          { name: "Asia",              bonus: 7, color: "#6cae6c" },
  oceania:       { name: "Oceania",           bonus: 2, color: "#9b7fc4" },
};

export const TERRITORIES = {
  // ---------- America del Norte ----------
  alaska:        { name: "Alaska",            continent: "america_norte", x: 70,  y: 95 },
  noroeste:      { name: "Territorio NO",     continent: "america_norte", x: 165, y: 90 },
  groenlandia:   { name: "Groenlandia",       continent: "america_norte", x: 320, y: 55 },
  alberta:       { name: "Alberta",           continent: "america_norte", x: 150, y: 160 },
  ontario:       { name: "Ontario",           continent: "america_norte", x: 235, y: 160 },
  quebec:        { name: "Quebec",            continent: "america_norte", x: 320, y: 150 },
  oeste_eeuu:    { name: "Oeste EE.UU.",      continent: "america_norte", x: 160, y: 235 },
  este_eeuu:     { name: "Este EE.UU.",       continent: "america_norte", x: 255, y: 240 },
  centroamerica: { name: "Centroamerica",     continent: "america_norte", x: 195, y: 310 },

  // ---------- America del Sur ----------
  venezuela:     { name: "Venezuela",         continent: "america_sur", x: 270, y: 380 },
  peru:          { name: "Peru",              continent: "america_sur", x: 270, y: 470 },
  brasil:        { name: "Brasil",            continent: "america_sur", x: 360, y: 450 },
  argentina:     { name: "Argentina",         continent: "america_sur", x: 295, y: 555 },

  // ---------- Europa ----------
  islandia:      { name: "Islandia",          continent: "europa", x: 460, y: 110 },
  granbretana:   { name: "Gran Bretana",      continent: "europa", x: 465, y: 185 },
  escandinavia:  { name: "Escandinavia",      continent: "europa", x: 560, y: 100 },
  europa_norte:  { name: "Europa Norte",      continent: "europa", x: 560, y: 180 },
  europa_oeste:  { name: "Europa Oeste",      continent: "europa", x: 480, y: 255 },
  europa_sur:    { name: "Europa Sur",        continent: "europa", x: 575, y: 250 },
  ucrania:       { name: "Ucrania",           continent: "europa", x: 660, y: 150 },

  // ---------- Africa ----------
  africa_norte:  { name: "Africa Norte",      continent: "africa", x: 535, y: 350 },
  egipto:        { name: "Egipto",            continent: "africa", x: 610, y: 330 },
  africa_este:   { name: "Africa Este",       continent: "africa", x: 650, y: 410 },
  congo:         { name: "Congo",             continent: "africa", x: 595, y: 445 },
  africa_sur:    { name: "Africa Sur",        continent: "africa", x: 610, y: 535 },
  madagascar:    { name: "Madagascar",        continent: "africa", x: 700, y: 500 },

  // ---------- Asia ----------
  ural:          { name: "Ural",              continent: "asia", x: 740, y: 140 },
  siberia:       { name: "Siberia",           continent: "asia", x: 820, y: 100 },
  yakutsk:       { name: "Yakutsk",           continent: "asia", x: 905, y: 70  },
  kamchatka:     { name: "Kamchatka",         continent: "asia", x: 1000,y: 95  },
  irkutsk:       { name: "Irkutsk",           continent: "asia", x: 875, y: 155 },
  mongolia:      { name: "Mongolia",          continent: "asia", x: 895, y: 215 },
  japon:         { name: "Japon",             continent: "asia", x: 1010,y: 210 },
  afganistan:    { name: "Afganistan",        continent: "asia", x: 740, y: 230 },
  china:         { name: "China",             continent: "asia", x: 840, y: 270 },
  medio_oriente: { name: "Medio Oriente",     continent: "asia", x: 685, y: 290 },
  india:         { name: "India",             continent: "asia", x: 790, y: 330 },
  siam:          { name: "Siam",              continent: "asia", x: 870, y: 340 },

  // ---------- Oceania ----------
  indonesia:     { name: "Indonesia",         continent: "oceania", x: 890, y: 420 },
  nueva_guinea:  { name: "Nueva Guinea",      continent: "oceania", x: 990, y: 425 },
  australia_oeste:{ name: "Australia Oeste",  continent: "oceania", x: 910, y: 510 },
  australia_este:{ name: "Australia Este",    continent: "oceania", x: 1000,y: 520 },
};

// Adyacencias (grafo no dirigido). Solo se declara una direccion;
// buildAdjacency() la hace bidireccional automaticamente.
const RAW_ADJ = {
  alaska:        ["noroeste", "alberta", "kamchatka"],
  noroeste:      ["alberta", "ontario", "groenlandia"],
  groenlandia:   ["ontario", "quebec", "islandia"],
  alberta:       ["ontario", "oeste_eeuu"],
  ontario:       ["quebec", "oeste_eeuu", "este_eeuu"],
  quebec:        ["este_eeuu"],
  oeste_eeuu:    ["este_eeuu", "centroamerica"],
  este_eeuu:     ["centroamerica"],
  centroamerica: ["venezuela"],

  venezuela:     ["brasil", "peru"],
  peru:          ["brasil", "argentina"],
  brasil:        ["argentina", "africa_norte"],

  islandia:      ["granbretana", "escandinavia"],
  granbretana:   ["escandinavia", "europa_norte", "europa_oeste"],
  escandinavia:  ["europa_norte", "ucrania"],
  ucrania:       ["europa_norte", "europa_sur", "ural", "afganistan", "medio_oriente"],
  europa_norte:  ["europa_sur", "europa_oeste"],
  europa_sur:    ["europa_oeste", "medio_oriente", "egipto", "africa_norte"],

  africa_norte:  ["egipto", "africa_este", "congo"],
  egipto:        ["africa_este", "medio_oriente"],
  africa_este:   ["congo", "africa_sur", "madagascar", "medio_oriente"],
  congo:         ["africa_sur"],
  africa_sur:    ["madagascar"],

  ural:          ["siberia", "china", "afganistan"],
  siberia:       ["yakutsk", "irkutsk", "mongolia", "china"],
  yakutsk:       ["kamchatka", "irkutsk"],
  kamchatka:     ["irkutsk", "mongolia", "japon"],
  irkutsk:       ["mongolia"],
  mongolia:      ["japon", "china"],
  afganistan:    ["china", "india", "medio_oriente"],
  china:         ["india", "siam", "mongolia"],
  medio_oriente: ["india"],
  india:         ["siam"],
  siam:          ["indonesia"],

  indonesia:     ["nueva_guinea", "australia_oeste"],
  nueva_guinea:  ["australia_oeste", "australia_este"],
  australia_oeste:["australia_este"],
};

export function buildAdjacency() {
  const adj = {};
  for (const id of Object.keys(TERRITORIES)) adj[id] = new Set();
  for (const [from, list] of Object.entries(RAW_ADJ)) {
    for (const to of list) {
      adj[from].add(to);
      adj[to].add(from);
    }
  }
  // Convertir Sets a arrays
  const out = {};
  for (const id of Object.keys(adj)) out[id] = [...adj[id]];
  return out;
}

export const ADJACENCY = buildAdjacency();

// Ejercitos iniciales segun numero de jugadores (regla clasica)
export const INITIAL_ARMIES = { 2: 40, 3: 35, 4: 30, 5: 25, 6: 20 };

// Colores de jugadores
export const PLAYER_COLORS = [
  "#e63946", // rojo
  "#457b9d", // azul
  "#2a9d8f", // verde
  "#e9c46a", // amarillo
  "#9d4edd", // morado
  "#212529", // negro
];

// Secuencia de canje de cartas (ejercitos otorgados)
export const CARD_TRADE_VALUES = [4, 6, 8, 10, 12, 15];
export const CARD_SYMBOLS = ["infanteria", "caballeria", "artilleria"];
