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
  return {
    sockets,
    puts,
    getTags(ws) { return [ws.tag]; },
    getWebSockets() { return this.sockets; },
    storage: {
      put(key, value) { puts.push({ key, value }); },
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

test("webSocketClose difunde player_left al resto", async () => {
  const leaving = makeWs("p1");
  const other = makeWs("p2");
  const state = makeState([leaving, other]);
  const room = newRoom(state);

  await room.webSocketClose(leaving);

  assert.equal(other.sent.length, 1);
  assert.deepEqual(JSON.parse(other.sent[0]), { type: "player_left", playerId: "p1" });
});

test("fetch sin Upgrade: websocket responde 426", async () => {
  const room = newRoom(makeState());
  const res = await room.fetch(new Request("http://localhost/api/game-room?roomId=r"));
  assert.equal(res.status, 426);
});
