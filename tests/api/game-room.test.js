import { test } from "node:test";
import assert from "node:assert/strict";

import { GameRoom } from "../../worker/index.js";
import { onRequest } from "../../functions/api/game-room.js";

// Fake WebSocket: registra lo enviado, su tag (playerId) y su attachment.
function makeWs(tag, attachment = {}) {
  const ws = { tag, sent: [], _att: attachment };
  ws.send = (msg) => ws.sent.push(msg);
  ws.serializeAttachment = (a) => { ws._att = a; };
  ws.deserializeAttachment = () => ws._att;
  return ws;
}

// Fake de this.state (Durable Object state) sin runtime real.
function makeState(sockets = []) {
  const store = new Map();
  const log = { puts: [], deletes: 0, alarms: [], deletedAlarms: 0 };
  return {
    sockets,
    store,
    log,
    getTags(ws) { return [ws.tag]; },
    getWebSockets() { return this.sockets; },
    acceptWebSocket(ws, tags) { ws.tag = tags[0]; this.sockets.push(ws); },
    storage: {
      async get(key) { return store.get(key); },
      async put(key, value) { store.set(key, value); log.puts.push({ key, value }); },
      async deleteAll() { store.clear(); log.deletes++; },
      async setAlarm(t) { log.alarms.push(t); },
      async deleteAlarm() { log.deletedAlarms++; },
    },
  };
}

function newRoom(state) {
  const room = new GameRoom(state, {});
  room.state = state;
  return room;
}

test("webSocketMessage con game_state persiste el payload", async () => {
  const sender = makeWs("p1");
  const state = makeState([sender]);
  const room = newRoom(state);

  await room.webSocketMessage(
    sender,
    JSON.stringify({ type: "game_state", payload: { turn: 5 } })
  );

  assert.deepEqual(state.store.get("gameState"), { turn: 5 });
});

test("broadcast envía a todos menos al emisor", () => {
  const a = makeWs("p1");
  const b = makeWs("p2");
  const c = makeWs("p3");
  const state = makeState([a, b, c]);
  const room = newRoom(state);

  room.broadcast("p1", "hola");

  assert.equal(a.sent.length, 0);
  assert.deepEqual(b.sent, ["hola"]);
  assert.deepEqual(c.sent, ["hola"]);
});

test("webSocketMessage difunde el mensaje al resto con 'from'", async () => {
  const sender = makeWs("p1");
  const other = makeWs("p2");
  const state = makeState([sender, other]);
  const room = newRoom(state);

  await room.webSocketMessage(sender, JSON.stringify({ type: "attack", payload: { to: "x" } }));

  assert.equal(sender.sent.length, 0);
  assert.equal(other.sent.length, 1);
  assert.deepEqual(JSON.parse(other.sent[0]), {
    from: "p1",
    type: "attack",
    payload: { to: "x" },
  });
});

test("JSON inválido no lanza, no persiste ni difunde", async () => {
  const sender = makeWs("p1");
  const other = makeWs("p2");
  const state = makeState([sender, other]);
  const room = newRoom(state);

  await assert.doesNotReject(() => room.webSocketMessage(sender, "{roto"));
  assert.equal(state.store.size, 0);
  assert.equal(other.sent.length, 0);
});

test("webSocketClose difunde player_left y lobby_update al resto", async () => {
  const leaving = makeWs("p1", { name: "Ana", ready: false });
  const other = makeWs("p2", { name: "Beto", ready: true });
  const state = makeState([leaving, other]);
  const room = newRoom(state);

  await room.webSocketClose(leaving);

  assert.equal(other.sent.length, 2);
  assert.deepEqual(JSON.parse(other.sent[0]), { type: "player_left", playerId: "p1" });
  assert.deepEqual(JSON.parse(other.sent[1]), {
    type: "lobby_update",
    players: [{ id: "p2", name: "Beto", ready: true }],
    openUntil: null,
  });
  assert.equal(state.log.deletes, 0); // queda p2: no se resetea la sala
});

test("webSocketClose resetea la sala si no quedan jugadores", async () => {
  const leaving = makeWs("p1", { name: "Ana", ready: false });
  const state = makeState([leaving]);
  const room = newRoom(state);
  state.store.set("started", true);

  // Sin otros sockets: el unico restante es el que cierra.
  state.getWebSockets = () => [];
  await room.webSocketClose(leaving);

  assert.equal(state.log.deletes, 1);
  assert.equal(state.store.size, 0);
});

test("fetch sin Upgrade: websocket responde 426", async () => {
  const room = newRoom(makeState());
  const res = await room.fetch(new Request("http://localhost/api/game-room?roomId=r"));
  assert.equal(res.status, 426);
});

test("fetch con sala ya iniciada responde 409", async () => {
  const state = makeState();
  state.store.set("started", true);
  const room = newRoom(state);
  const res = await room.fetch(
    new Request("http://localhost/api/game-room?roomId=r", {
      headers: { Upgrade: "websocket" },
    })
  );
  assert.equal(res.status, 409);
});

test("fetch con sala llena (>=6 jugadores) responde 403", async () => {
  const sockets = [];
  for (let i = 0; i < 6; i++) sockets.push(makeWs(`p${i}`));
  const room = newRoom(makeState(sockets));
  const res = await room.fetch(
    new Request("http://localhost/api/game-room?roomId=r", {
      headers: { Upgrade: "websocket" },
    })
  );
  assert.equal(res.status, 403);
});

test("webSocketMessage con set_ready actualiza el attachment y difunde lobby_update", async () => {
  const sender = makeWs("p1", { name: "Ana", ready: false });
  const other = makeWs("p2", { name: "Beto", ready: false });
  const state = makeState([sender, other]);
  const room = newRoom(state);

  await room.webSocketMessage(sender, JSON.stringify({ type: "set_ready", payload: { ready: true } }));

  assert.equal(sender._att.ready, true);
  assert.deepEqual(JSON.parse(other.sent[0]), {
    type: "lobby_update",
    players: [
      { id: "p1", name: "Ana", ready: true },
      { id: "p2", name: "Beto", ready: false },
    ],
    openUntil: null,
  });
});

test("webSocketMessage con start_game marca started y difunde a todos sin excluir al emisor", async () => {
  const sender = makeWs("p1");
  const other = makeWs("p2");
  const state = makeState([sender, other]);
  const room = newRoom(state);

  await room.webSocketMessage(sender, JSON.stringify({ type: "start_game", payload: { players: [] } }));

  assert.equal(state.store.get("started"), true);
  assert.equal(state.log.deletedAlarms, 1);
  assert.equal(sender.sent.length, 1);
  assert.equal(other.sent.length, 1);
  assert.deepEqual(JSON.parse(sender.sent[0]), {
    from: "p1",
    type: "start_game",
    payload: { players: [] },
  });
});

test("webSocketMessage con game_state en fase gameover resetea la sala", async () => {
  const sender = makeWs("p1");
  const state = makeState([sender]);
  const room = newRoom(state);
  state.store.set("started", true);

  await room.webSocketMessage(sender, JSON.stringify({ type: "game_state", payload: { phase: "gameover" } }));

  assert.equal(state.log.deletes, 1);
  assert.equal(state.store.size, 0);
});

test("broadcastLobby envía {type, players, openUntil} con id/name/ready", async () => {
  const a = makeWs("p1", { name: "Ana", ready: false });
  const state = makeState([a]);
  const room = newRoom(state);

  await room.broadcastLobby();

  assert.deepEqual(JSON.parse(a.sent[0]), {
    type: "lobby_update",
    players: [{ id: "p1", name: "Ana", ready: false }],
    openUntil: null,
  });
});

// ---------- emparejador (modo online) ----------

test("handleMatch crea una sala nueva cuando no hay ninguna abierta", async () => {
  const state = makeState();
  const room = newRoom(state);

  const res = await room.handleMatch();
  const body = await res.json();

  assert.match(body.roomId, /^online-/);
  assert.ok(body.openUntil > Date.now());
  assert.equal(state.store.get("mm").count, 1);
});

test("handleMatch reusa la misma sala dentro de la ventana de 60s", async () => {
  const state = makeState();
  const room = newRoom(state);

  const a = await (await room.handleMatch()).json();
  const b = await (await room.handleMatch()).json();

  assert.equal(a.roomId, b.roomId);
  assert.equal(state.store.get("mm").count, 2);
});

test("handleMatch rota a sala nueva al llegar a 6 jugadores", async () => {
  const state = makeState();
  const room = newRoom(state);
  state.store.set("mm", { roomId: "online-llena", openedAt: Date.now(), count: 6 });

  const body = await (await room.handleMatch()).json();
  assert.notEqual(body.roomId, "online-llena");
});

test("handleMatch rota a sala nueva cuando la ventana ya expiró", async () => {
  const state = makeState();
  const room = newRoom(state);
  state.store.set("mm", { roomId: "online-vieja", openedAt: Date.now() - 61000, count: 1 });

  const body = await (await room.handleMatch()).json();
  assert.notEqual(body.roomId, "online-vieja");
});

// ---------- alarma (fin del contador publico) ----------

test("alarm con >=2 jugadores manda you_start al primero", async () => {
  const a = makeWs("p1", { name: "Ana", ready: true });
  const b = makeWs("p2", { name: "Beto", ready: true });
  const state = makeState([a, b]);
  const room = newRoom(state);

  await room.alarm();

  assert.equal(a.sent.length, 1);
  assert.equal(b.sent.length, 0);
  const msg = JSON.parse(a.sent[0]);
  assert.equal(msg.type, "you_start");
  assert.equal(msg.players.length, 2);
});

test("alarm con <2 jugadores cancela el emparejamiento y resetea", async () => {
  const a = makeWs("p1", { name: "Ana", ready: true });
  const state = makeState([a]);
  const room = newRoom(state);

  await room.alarm();

  assert.deepEqual(JSON.parse(a.sent[0]), { type: "match_failed" });
  assert.equal(state.log.deletes, 1);
});

test("alarm no hace nada si la sala ya inició", async () => {
  const a = makeWs("p1", { name: "Ana", ready: true });
  const b = makeWs("p2", { name: "Beto", ready: true });
  const state = makeState([a, b]);
  const room = newRoom(state);
  state.store.set("started", true);

  await room.alarm();

  assert.equal(a.sent.length, 0);
  assert.equal(b.sent.length, 0);
});

// ---------- router de Pages (functions/api/game-room.js) ----------

// env falso: registra el nombre con que se resuelve el DO y la request reenviada.
function fakeEnv(response = new Response("ok")) {
  const calls = { idFromName: [], fetched: null };
  return {
    calls,
    GAME_ROOM: {
      idFromName(name) { calls.idFromName.push(name); return { name }; },
      get() { return { fetch: (req) => { calls.fetched = req; return response; } }; },
    },
  };
}

test("router usa roomId 'default' cuando no hay query param", async () => {
  const env = fakeEnv();
  await onRequest({ request: new Request("http://localhost/api/game-room"), env });
  assert.deepEqual(env.calls.idFromName, ["default"]);
});

test("router usa el roomId explícito de la query", async () => {
  const env = fakeEnv();
  await onRequest({ request: new Request("http://localhost/api/game-room?roomId=sala1"), env });
  assert.deepEqual(env.calls.idFromName, ["sala1"]);
});

test("router enruta match=1 al emparejador fijo, ignorando roomId", async () => {
  const env = fakeEnv();
  await onRequest({ request: new Request("http://localhost/api/game-room?match=1&roomId=x"), env });
  assert.deepEqual(env.calls.idFromName, ["__matchmaker__"]);
});

test("router reenvía la request original a room.fetch y devuelve su respuesta", async () => {
  const expected = new Response("forwarded");
  const env = fakeEnv(expected);
  const request = new Request("http://localhost/api/game-room?roomId=sala1");
  const res = await onRequest({ request, env });
  assert.equal(env.calls.fetched, request);
  assert.equal(res, expected);
});
