// Levanta los dos procesos de desarrollo que el modo online necesita:
//  1) el worker del Durable Object (war-game-room, clase GameRoom)
//  2) Pages, con el binding GAME_ROOM conectado a ese worker
// wrangler 4 ya no soporta definir el DO inline en `pages dev`; deben correr juntos.
import { spawn } from "node:child_process";

// --use-system-ca: esta maquina intercepta TLS (ver memoria del proyecto).
const env = { ...process.env, NODE_OPTIONS: "--use-system-ca" };

const procs = [
  ["DO", "wrangler", ["dev", "--config", "worker/wrangler.toml", "--port", "8787"]],
  ["Pages", "wrangler", ["pages", "dev", ".", "--do", "GAME_ROOM=GameRoom@war-game-room", "--port", "8788"]],
];

let closing = false;
const children = procs.map(([name, cmd, args]) => {
  const child = spawn(cmd, args, { stdio: "inherit", shell: true, env });
  child.on("exit", (code) => {
    if (!closing) console.log(`\n[${name}] terminó (código ${code}). Cerrando todo…`);
    shutdown();
  });
  return child;
});

function shutdown() {
  if (closing) return;
  closing = true;
  for (const c of children) { try { c.kill(); } catch {} }
  process.exit();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
