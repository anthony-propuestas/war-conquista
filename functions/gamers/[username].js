export async function onRequestGet({ params, env }) {
  const username = params.username;

  const user = await env.DB.prepare(
    "SELECT username, wins FROM users WHERE username = ? COLLATE NOCASE"
  ).bind(username).first();

  if (!user) {
    return new Response(
      `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Jugador no encontrado</title>
      <style>body{background:#0a0a0f;color:#fff;font-family:monospace;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;gap:1rem;}
      a{color:#e63946;}</style></head>
      <body><h1>404</h1><p>Jugador no encontrado</p><a href="/gamers">← Volver al ranking</a></body></html>`,
      { status: 404, headers: { "Content-Type": "text/html;charset=UTF-8" } }
    );
  }

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${user.username} — WAR</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #0a0a0f;
      color: #e8e8e8;
      font-family: 'Courier New', monospace;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 2rem;
      padding: 2rem;
    }
    .card {
      background: #12121a;
      border: 1px solid #e63946;
      border-radius: 8px;
      padding: 3rem 4rem;
      text-align: center;
      max-width: 400px;
      width: 100%;
    }
    .label {
      font-size: 0.75rem;
      color: #888;
      text-transform: uppercase;
      letter-spacing: 2px;
      margin-bottom: 0.5rem;
    }
    .username {
      font-size: 2rem;
      font-weight: bold;
      color: #e63946;
      margin-bottom: 2rem;
    }
    .wins-label { margin-bottom: 0.25rem; }
    .wins {
      font-size: 3rem;
      font-weight: bold;
      color: #fff;
    }
    .back {
      color: #e63946;
      text-decoration: none;
      font-size: 0.9rem;
      letter-spacing: 1px;
    }
    .back:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="card">
    <p class="label">Jugador</p>
    <h1 class="username">${user.username}</h1>
    <p class="label wins-label">Victorias</p>
    <p class="wins">${user.wins}</p>
  </div>
  <a class="back" href="/gamers">← Volver al ranking</a>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html;charset=UTF-8" },
  });
}
