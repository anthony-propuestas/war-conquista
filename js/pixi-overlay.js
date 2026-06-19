import { Application, Graphics, Text, TextStyle } from 'pixi.js';

let app = null;
let canvas = null;

export async function initPixiOverlay(mapElement) {
  canvas = document.createElement('canvas');
  canvas.style.position = 'absolute';
  canvas.style.top = '0';
  canvas.style.left = '0';
  canvas.style.pointerEvents = 'none';
  canvas.style.zIndex = '10';

  const parent = mapElement.parentElement;
  parent.style.position = 'relative';
  parent.appendChild(canvas);

  app = new Application();
  await app.init({
    canvas,
    backgroundAlpha: 0,
    resizeTo: parent,
    antialias: true,
  });
}

// Obtiene coordenadas de pantalla de un territorio a partir del SVG
function getScreenPos(mapElement, territoryId) {
  const node = mapElement.querySelector(`[data-id="${territoryId}"]`);
  if (!node) return null;
  const rect = node.getBoundingClientRect();
  const parentRect = mapElement.parentElement.getBoundingClientRect();
  return {
    x: rect.left - parentRect.left + rect.width / 2,
    y: rect.top - parentRect.top + rect.height / 2,
  };
}

// Animacion de particulas de batalla entre dos territorios
export function playBattleAnimation(mapElement, fromId, toId, conquered) {
  // app.init() es async: si la animación se dispara antes de terminar, ticker/stage
  // aún no existen. Saltar evita el TypeError que rompía resolveAttack.
  if (!app || !app.ticker || !app.stage) return;

  const from = getScreenPos(mapElement, fromId);
  const to = getScreenPos(mapElement, toId);
  if (!from || !to) return;

  const count = 18;
  const color = conquered ? 0xffd700 : 0xff4444;
  const particles = [];

  for (let i = 0; i < count; i++) {
    const g = new Graphics();
    const size = 3 + Math.random() * 4;
    g.circle(0, 0, size).fill(color);
    g.x = to.x;
    g.y = to.y;
    g.alpha = 1;

    const angle = (Math.PI * 2 * i) / count;
    const speed = 1.5 + Math.random() * 2.5;
    particles.push({ g, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed });
    app.stage.addChild(g);
  }

  // Texto de resultado sobre el territorio destino
  const style = new TextStyle({ fontSize: 22, fill: color, fontWeight: 'bold', dropShadow: true });
  const label = new Text({ text: conquered ? '¡Conquistado!' : '¡Repelido!', style });
  label.anchor.set(0.5);
  label.x = to.x;
  label.y = to.y - 30;
  label.alpha = 1;
  app.stage.addChild(label);

  // Línea de ataque desde → hasta
  const line = new Graphics();
  line.moveTo(from.x, from.y).lineTo(to.x, to.y)
    .stroke({ color: color, width: 2, alpha: 0.7 });
  app.stage.addChild(line);

  let frame = 0;
  const tick = () => {
    frame++;
    for (const p of particles) {
      p.g.x += p.vx;
      p.g.y += p.vy;
      p.g.alpha -= 0.025;
      p.vy += 0.08; // gravedad
    }
    label.alpha -= 0.015;
    line.alpha -= 0.02;

    if (frame >= 60) {
      app.ticker.remove(tick);
      for (const p of particles) app.stage.removeChild(p.g);
      app.stage.removeChild(label);
      app.stage.removeChild(line);
    }
  };
  app.ticker.add(tick);
}
