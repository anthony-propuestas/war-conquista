import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  joinRoom,
  requestMatch,
  setMessageHandler,
  sendAction,
  sendGameState,
  setReady,
  startGame,
  disconnect,
  isConnected,
} from "../js/multiplayer.js";

const OPEN = 1;
const CONNECTING = 0;
const CLOSED = 3;

let instances = [];

class FakeWebSocket {
  static OPEN = OPEN;
  static CONNECTING = CONNECTING;
  static CLOSED = CLOSED;

  constructor(url) {
    this.url = url;
    this.readyState = CONNECTING;
    this.sent = [];
    this.closed = false;
    this.listeners = {};
    instances.push(this);
  }
  addEventListener(type, cb) {
    this.listeners[type] = cb;
  }
  emit(type, ev) {
    if (this.listeners[type]) this.listeners[type](ev);
  }
  send(msg) {
    this.sent.push(msg);
  }
  close() {
    this.closed = true;
    this.readyState = CLOSED;
  }
}

beforeEach(() => {
  instances = [];
  globalThis.WebSocket = FakeWebSocket;
  globalThis.location = { protocol: "https:", host: "war.example.com" };
});

afterEach(() => {
  disconnect();
  delete globalThis.WebSocket;
  delete globalThis.location;
  delete globalThis.fetch;
});

test("isConnected() es false sin conexión", () => {
  assert.equal(isConnected(), false);
});

test("joinRoom construye URL wss en https y registra onMessage", () => {
  joinRoom("sala1", "p1", () => {});
  assert.equal(instances.length, 1);
  assert.match(
    instances[0].url,
    /^wss:\/\/war\.example\.com\/api\/game-room\?roomId=sala1&playerId=p1&playerName=Jugador$/
  );
});

test("joinRoom incluye el playerName explícito url-encoded", () => {
  joinRoom("sala1", "p1", () => {}, "Ana López");
  assert.ok(instances[0].url.includes("playerName=Ana%20L%C3%B3pez"));
});

test("joinRoom con opts.public añade public=1 y openUntil a la URL", () => {
  joinRoom("s", "p", () => {}, "Jugador", undefined, undefined, { public: true, openUntil: 1700000000000 });
  assert.ok(instances[0].url.includes("&public=1&openUntil=1700000000000"));
});

test("joinRoom sin opts.public no incluye public ni openUntil", () => {
  joinRoom("s", "p", () => {});
  assert.ok(!instances[0].url.includes("public="));
  assert.ok(!instances[0].url.includes("openUntil="));
});

test("requestMatch hace POST a /api/game-room?match=1 y devuelve el JSON", async () => {
  let captured = null;
  globalThis.fetch = async (url, opts) => {
    captured = { url, opts };
    return { ok: true, json: async () => ({ roomId: "online-abc", openUntil: 123 }) };
  };
  const result = await requestMatch();
  assert.equal(captured.url, "/api/game-room?match=1");
  assert.equal(captured.opts.method, "POST");
  assert.deepEqual(result, { roomId: "online-abc", openUntil: 123 });
});

test("requestMatch lanza si la respuesta no es ok", async () => {
  globalThis.fetch = async () => ({ ok: false });
  await assert.rejects(() => requestMatch(), /No se pudo emparejar/);
});

test("joinRoom usa ws cuando el protocolo no es https", () => {
  globalThis.location = { protocol: "http:", host: "localhost:8788" };
  joinRoom("sala 2", "p&2", () => {});
  assert.ok(instances[0].url.startsWith("ws://localhost:8788/"));
  // valores con caracteres especiales van url-encoded
  assert.ok(instances[0].url.includes("roomId=sala%202"));
  assert.ok(instances[0].url.includes("playerId=p%262"));
});

test("onJoinFailed se llama si el socket cierra sin haber abierto", () => {
  let failed = 0;
  joinRoom("s", "p", () => {}, "Jugador", () => { failed++; });
  instances[0].emit("close", {});
  assert.equal(failed, 1);
});

test("onJoinFailed NO se llama si el socket abrió antes de cerrar", () => {
  let failed = 0;
  joinRoom("s", "p", () => {}, "Jugador", () => { failed++; });
  instances[0].emit("open", {});
  instances[0].emit("close", {});
  assert.equal(failed, 0);
});

test("onClose se llama si el socket cierra después de haber abierto", () => {
  let closed = 0;
  joinRoom("s", "p", () => {}, "Jugador", () => {}, () => { closed++; });
  instances[0].emit("open", {});
  instances[0].emit("close", {});
  assert.equal(closed, 1);
});

test("el handler de message parsea JSON y llama onMessage", () => {
  let received = null;
  joinRoom("s", "p", (data) => { received = data; });
  instances[0].emit("message", { data: JSON.stringify({ type: "ping", n: 1 }) });
  assert.deepEqual(received, { type: "ping", n: 1 });
});

test("JSON inválido en message no lanza y no llama onMessage", () => {
  let calls = 0;
  joinRoom("s", "p", () => { calls++; });
  assert.doesNotThrow(() => instances[0].emit("message", { data: "{no-json" }));
  assert.equal(calls, 0);
});

test("setMessageHandler reemplaza el handler de mensajes", () => {
  let viaOriginal = null;
  let viaNuevo = null;
  joinRoom("s", "p", (data) => { viaOriginal = data; });
  setMessageHandler((data) => { viaNuevo = data; });
  instances[0].emit("message", { data: JSON.stringify({ type: "ping" }) });
  assert.equal(viaOriginal, null);
  assert.deepEqual(viaNuevo, { type: "ping" });
});

test("sendAction no envía si el socket no está OPEN", () => {
  joinRoom("s", "p", () => {});
  instances[0].readyState = CONNECTING;
  sendAction("attack", { from: "a" });
  assert.equal(instances[0].sent.length, 0);
});

test("sendAction envía {type,payload} cuando está OPEN", () => {
  joinRoom("s", "p", () => {});
  instances[0].readyState = OPEN;
  sendAction("attack", { from: "a", to: "b" });
  assert.equal(instances[0].sent.length, 1);
  assert.deepEqual(JSON.parse(instances[0].sent[0]), {
    type: "attack",
    payload: { from: "a", to: "b" },
  });
});

test("sendAction usa payload vacío por defecto", () => {
  joinRoom("s", "p", () => {});
  instances[0].readyState = OPEN;
  sendAction("ready");
  assert.deepEqual(JSON.parse(instances[0].sent[0]), { type: "ready", payload: {} });
});

test("sendGameState delega en sendAction('game_state', state)", () => {
  joinRoom("s", "p", () => {});
  instances[0].readyState = OPEN;
  sendGameState({ turn: 3 });
  assert.deepEqual(JSON.parse(instances[0].sent[0]), {
    type: "game_state",
    payload: { turn: 3 },
  });
});

test("setReady envía sendAction('set_ready', {ready})", () => {
  joinRoom("s", "p", () => {});
  instances[0].readyState = OPEN;
  setReady(true);
  assert.deepEqual(JSON.parse(instances[0].sent[0]), {
    type: "set_ready",
    payload: { ready: true },
  });
});

test("startGame envía sendAction('start_game', payload completo)", () => {
  joinRoom("s", "p", () => {});
  instances[0].readyState = OPEN;
  const players = [{ id: "p1", name: "Ana" }];
  const board = { "AF": { owner: 0, armies: 3 } };
  const setupRemaining = [5, 5];
  startGame({ players, board, setupRemaining });
  assert.deepEqual(JSON.parse(instances[0].sent[0]), {
    type: "start_game",
    payload: { players, board, setupRemaining },
  });
});

test("disconnect cierra el socket y deja isConnected() en false", () => {
  joinRoom("s", "p", () => {});
  instances[0].readyState = OPEN;
  assert.equal(isConnected(), true);
  disconnect();
  assert.equal(instances[0].closed, true);
  assert.equal(isConnected(), false);
});

// ---------- heartbeat + reconexión ----------

test("un mensaje 'pong' no llega a onMessage", () => {
  let calls = 0;
  joinRoom("s", "p", () => { calls++; });
  instances[0].emit("open", {});
  instances[0].emit("message", { data: "pong" });
  assert.equal(calls, 0);
});

test("caída con reconnect:true agenda reconexión y reconecta al abrir el nuevo socket", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  let reconnecting = null;
  let reconnected = 0;
  let closed = 0;
  joinRoom("s", "p", () => {}, "Jugador", () => {}, () => { closed++; }, {
    reconnect: true,
    onReconnecting: (n) => { reconnecting = n; },
    onReconnect: () => { reconnected++; },
  });
  instances[0].emit("open", {});
  instances[0].emit("close", {});

  assert.equal(reconnecting, 1);     // primer intento anunciado
  assert.equal(closed, 0);           // no se reporta cierre definitivo
  assert.equal(instances.length, 1); // aún no reconectó

  t.mock.timers.tick(1000);          // primer backoff
  assert.equal(instances.length, 2); // socket nuevo creado
  instances[1].emit("open", {});
  assert.equal(reconnected, 1);
});

test("reconexión agotada (todos los backoffs fallan) reporta onClose", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  let closed = 0;
  joinRoom("s", "p", () => {}, "Jugador", () => {}, () => { closed++; }, {
    reconnect: true,
    onReconnecting: () => {},
  });
  instances[0].emit("open", {});
  instances[0].emit("close", {}); // agenda el primer reintento (delay 1000)

  // Cada reintento abre un socket que cierra sin haber abierto → reagenda.
  const backoffs = [1000, 2000, 4000, 8000, 15000, 15000];
  for (const d of backoffs) {
    t.mock.timers.tick(d);
    instances[instances.length - 1].emit("close", {});
  }

  assert.equal(closed, 1); // tras agotar los backoffs
});

test("heartbeat envía 'ping' cuando el socket está OPEN", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  joinRoom("s", "p", () => {});
  instances[0].emit("open", {});
  instances[0].readyState = OPEN;
  t.mock.timers.tick(25000);
  assert.ok(instances[0].sent.includes("ping"));
});

test("sin pong dentro del timeout, el heartbeat cierra el socket", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
  joinRoom("s", "p", () => {});
  instances[0].emit("open", {});
  instances[0].readyState = OPEN;
  t.mock.timers.tick(75000); // supera PONG_TIMEOUT_MS (60000)
  assert.equal(instances[0].closed, true);
});

test("disconnect durante la espera cancela el reintento de reconexión", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  let closed = 0;
  joinRoom("s", "p", () => {}, "Jugador", () => {}, () => { closed++; }, {
    reconnect: true,
    onReconnecting: () => {},
  });
  instances[0].emit("open", {});
  instances[0].emit("close", {}); // agenda reconexión

  disconnect();
  t.mock.timers.tick(15000);

  assert.equal(instances.length, 1); // no se creó socket nuevo
  assert.equal(closed, 0);           // disconnect no dispara onClose
});
