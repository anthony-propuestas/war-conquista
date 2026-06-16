import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  joinRoom,
  sendAction,
  sendGameState,
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
});

test("isConnected() es false sin conexión", () => {
  assert.equal(isConnected(), false);
});

test("joinRoom construye URL wss en https y registra onMessage", () => {
  joinRoom("sala1", "p1", () => {});
  assert.equal(instances.length, 1);
  assert.match(
    instances[0].url,
    /^wss:\/\/war\.example\.com\/api\/game-room\?roomId=sala1&playerId=p1$/
  );
});

test("joinRoom usa ws cuando el protocolo no es https", () => {
  globalThis.location = { protocol: "http:", host: "localhost:8788" };
  joinRoom("sala 2", "p&2", () => {});
  assert.ok(instances[0].url.startsWith("ws://localhost:8788/"));
  // valores con caracteres especiales van url-encoded
  assert.ok(instances[0].url.includes("roomId=sala%202"));
  assert.ok(instances[0].url.includes("playerId=p%262"));
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

test("disconnect cierra el socket y deja isConnected() en false", () => {
  joinRoom("s", "p", () => {});
  instances[0].readyState = OPEN;
  assert.equal(isConnected(), true);
  disconnect();
  assert.equal(instances[0].closed, true);
  assert.equal(isConnected(), false);
});
