import { test } from "node:test";
import assert from "node:assert/strict";

import { GameRoom } from "../../worker/index.js";

// Fake WebSocket: registra lo enviado y su tag (playerId)
function makeWs(tag) {
  const ws = { tag, sent: [] };
  ws.send = (msg) => ws.sent.push(msg);
  return ws;
}

// Fake de this.state (Durable Object state) sin runtime real
function makeState(sockets = []) {
  const puts = [];
  const deletes = [];
  return {
    sockets,
    puts,
    deletes,
    getTags(ws) { return [ws.tag]; },
    getWebSockets() { return this.sockets; },
    storage: {
      put(key, value) { puts.push({ key, value }); },
      deleteAll() { deletes.push(true); },
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

  assert.equal(state.puts.length, 1);
  assert.deepEqual(state.puts[0], { key: "gameState", value: { turn: 5 } });
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
  assert.equal(state.puts.length, 0);
  assert.equal(other.sent.length, 0);
});

test("webSocketClose difunde player_left y lobby_update al resto", async () => {
  const leaving = makeWs("p1");
  const other = makeWs("p2");
  const state = makeState([leaving, other]);
  const room = newRoom(state);
  room.players.set("p1", { name: "Ana", ready: false });
  room.players.set("p2", { name: "Beto", ready: true });

  await room.webSocketClose(leaving);

  assert.equal(other.sent.length, 2);
  assert.deepEqual(JSON.parse(other.sent[0]), { type: "player_left", playerId: "p1" });
  assert.deepEqual(JSON.parse(other.sent[1]), {
    type: "lobby_update",
    players: [{ id: "p2", name: "Beto", ready: true }],
  });
  assert.equal(state.deletes.length, 0); // queda p2: no se resetea la sala
});

test("webSocketClose resetea la sala si no quedan jugadores", async () => {
  const leaving = makeWs("p1");
  const state = makeState([leaving]);
  const room = newRoom(state);
  room.players.set("p1", { name: "Ana", ready: false });
  room.started = true;

  await room.webSocketClose(leaving);

  assert.equal(state.deletes.length, 1);
  assert.equal(room.players.size, 0);
  assert.equal(room.started, false);
});

test("fetch sin Upgrade: websocket responde 426", async () => {
  const room = newRoom(makeState());
  const res = await room.fetch(new Request("http://localhost/api/game-room?roomId=r"));
  assert.equal(res.status, 426);
});

test("fetch con sala ya iniciada responde 409", async () => {
  const room = newRoom(makeState());
  room.started = true;
  const res = await room.fetch(
    new Request("http://localhost/api/game-room?roomId=r", {
      headers: { Upgrade: "websocket" },
    })
  );
  assert.equal(res.status, 409);
});

test("fetch con sala llena (>=6 jugadores) responde 403", async () => {
  const room = newRoom(makeState());
  for (let i = 0; i < 6; i++) room.players.set(`p${i}`, { name: "J", ready: true });
  const res = await room.fetch(
    new Request("http://localhost/api/game-room?roomId=r", {
      headers: { Upgrade: "websocket" },
    })
  );
  assert.equal(res.status, 403);
});

test("webSocketMessage con set_ready actualiza al jugador y difunde lobby_update", async () => {
  const sender = makeWs("p1");
  const other = makeWs("p2");
  const state = makeState([sender, other]);
  const room = newRoom(state);
  room.players.set("p1", { name: "Ana", ready: false });
  room.players.set("p2", { name: "Beto", ready: false });

  await room.webSocketMessage(sender, JSON.stringify({ type: "set_ready", payload: { ready: true } }));

  assert.equal(room.players.get("p1").ready, true);
  assert.deepEqual(JSON.parse(other.sent[0]), {
    type: "lobby_update",
    players: [
      { id: "p1", name: "Ana", ready: true },
      { id: "p2", name: "Beto", ready: false },
    ],
  });
});

test("webSocketMessage con start_game marca started y difunde a todos sin excluir al emisor", async () => {
  const sender = makeWs("p1");
  const other = makeWs("p2");
  const state = makeState([sender, other]);
  const room = newRoom(state);

  await room.webSocketMessage(sender, JSON.stringify({ type: "start_game", payload: { players: [] } }));

  assert.equal(room.started, true);
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
  room.players.set("p1", { name: "Ana", ready: true });
  room.started = true;

  await room.webSocketMessage(sender, JSON.stringify({ type: "game_state", payload: { phase: "gameover" } }));

  assert.equal(state.deletes.length, 1);
  assert.equal(room.players.size, 0);
  assert.equal(room.started, false);
});

test("broadcastLobby envía la forma {type, players} con id/name/ready", () => {
  const a = makeWs("p1");
  const state = makeState([a]);
  const room = newRoom(state);
  room.players.set("p1", { name: "Ana", ready: false });

  room.broadcastLobby();

  assert.deepEqual(JSON.parse(a.sent[0]), {
    type: "lobby_update",
    players: [{ id: "p1", name: "Ana", ready: false }],
  });
});
