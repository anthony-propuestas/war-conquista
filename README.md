# 🌍 WAR · Conquista del Mundo

### ▶️ Jugar ahora: **https://war-conquista.pages.dev**

Juego de estrategia por turnos inspirado en el clásico juego de mesa **WAR** (estilo *Risk*).
Conquista territorios, domina continentes y elimina a tus rivales. **Multijugador local**
(hotseat) y **online en tiempo real** (salas WebSocket) directamente en el navegador, sin
instalar nada.

> Hecho con HTML, CSS y JavaScript puro (sin frameworks) y desplegado en **Cloudflare Pages**
> con un salón de la fama persistido en **Cloudflare D1**.

---

## ✨ Características

- 🗺️ **Mapa de 44 territorios** repartidos en 6 continentes.
- 🎲 **Combate con dados**: eliges con cuántas unidades atacar (1 hasta tus tropas − 1)
  = ese número de dados; el defensor tira con **todas** sus tropas. Al conquistar, los
  atacantes supervivientes ocupan la zona automáticamente.
- ♻️ **Turno libre**: en tu turno puedes reforzar, atacar y mover tropas en cualquier orden antes de pasar.
- 👥 **1 a 3 jugadores** en la misma máquina (hotseat), cada uno con su color.
- 🌐 **Multijugador online** en tiempo real: crea o únete a una sala (auto-listo al unirse) y el anfitrión arranca la partida cuando hay 2+ jugadores (WebSocket + Durable Object `GameRoom`). Si se cae la conexión, **reconecta sola** (heartbeat + reintentos con backoff) y recupera el estado de la partida en curso.
- 🏆 **Salón de la fama** global persistido en Cloudflare D1.
- 🔐 **Login con Google o wallet MetaMask** para vincular tus victorias a tu cuenta.
- 🃏 **Sistema de cartas**: recibe cartas como recompensa diaria del battle pass y úsalas en partida (Refuerzos Extra, Doble Ataque, Escudo).
- 📅 **Battle pass diario**: calendar mensual de recompensas; reclama la carta del día en `/battle-pass`.
- 🪙 **Tienda on-chain (WGT)**: gana tokens WGT por victorias en modo online y canjéalos por items en la tienda (`/shop`). Contratos en Base Sepolia.
- 📱 Interfaz responsive, sin librerías JS ni frameworks. Dependencias externas en
  runtime: las fuentes **Cinzel** y **Oswald** de Google Fonts, y **ethers**/**pixi.js**
  cargados desde esm.sh (CDN) vía `importmap`.

---

## 🎮 Cómo se juega

1. **Despliegue:** cada jugador coloca sus ejércitos iniciales en sus territorios.
2. **Refuerzo:** recibes tropas proporcionales a los territorios que controles (⌊territorios / 2⌋).
3. **Ataque:** elige un territorio propio con 2+ ejércitos, un vecino enemigo y con
   cuántas unidades atacar. Se comparan los dados más altos por pares; el empate
   favorece al defensor. Si vacías el territorio, tus supervivientes lo ocupan.
4. **Fortificación:** mueve tropas entre dos territorios propios conectados.
5. **Victoria:** gana quien conquiste **todos** los territorios o quede como **último jugador en pie** (rivales eliminados o rendidos). Desde la **ronda 7** puedes **rendirte** para abandonar la partida.

---

## 🚀 Desarrollo local

Requisitos: [Node.js](https://nodejs.org) 20+ (lo pide `wrangler ^4`). Los tests con
`node --test` usan un patrón glob que requiere **Node ≥21**.

```bash
npm install
npm run dev          # arranca Cloudflare Pages en local (incluye /api)
```

El juego es 100% estático: también puedes abrir `index.html` con cualquier servidor
estático; el salón de la fama simplemente no aparecerá sin el backend.

---

## ☁️ Despliegue en Cloudflare

### 1. Crear la base de datos D1

```bash
npm run db:create                 # crea la DB "war-scores"
# copia el database_id que imprime y pégalo en wrangler.toml
wrangler d1 execute war-scores --remote --file migrations/0001_users.sql
wrangler d1 execute war-scores --remote --file migrations/0002_items.sql
wrangler d1 execute war-scores --remote --file migrations/0003_onchain.sql
```

### 2. Configurar secrets

```bash
wrangler pages secret put GOOGLE_CLIENT_ID --project-name war-conquista
wrangler pages secret put GOOGLE_CLIENT_SECRET --project-name war-conquista
wrangler pages secret put SESSION_SECRET --project-name war-conquista
wrangler pages secret put ADMIN_EMAILS --project-name war-conquista
# On-chain (necesarios para /api/claim-wgt y /api/deliver-item)
wrangler pages secret put BASE_RPC_URL --project-name war-conquista
wrangler pages secret put WGT_CONTRACT --project-name war-conquista
wrangler pages secret put SHOP_CONTRACT --project-name war-conquista
```

`SESSION_SECRET`: cadena aleatoria de ≥32 bytes; firma la cookie `war_session` (HMAC-SHA256).
`ADMIN_EMAILS`: lista de emails separados por comas con acceso al panel `/admin`.

Obtén las credenciales en **Google Cloud Console → Credenciales → OAuth 2.0**.
URI de redirección autorizado: `https://war-conquista.pages.dev/api/auth/callback`
(y `http://localhost:8788/api/auth/callback` para desarrollo local en `.dev.vars`).

### 3. Publicar en Cloudflare Pages

**Opción A — desde la terminal:**

```bash
npx wrangler login
npm run deploy
```

**Opción B — CI/CD desde GitHub (recomendado):**

1. En el panel de Cloudflare → **Workers & Pages → Create → Pages → Connect to Git**.
2. Selecciona este repositorio.
3. Build command: *(vacío)* · Output directory: `/`
4. En **Settings → Functions → D1 database bindings** añade el binding
   `DB` → `war-scores`.
5. Cada `git push` a `main` despliega automáticamente a producción.

### 4. Desplegar el Worker del Durable Object

El Durable Object `GameRoom` vive en un Worker separado y tiene su propio pipeline:

```bash
npm run deploy:worker    # wrangler deploy --config worker/wrangler.toml
```

Ver [Docs/deployment.md](Docs/deployment.md) para configurar despliegue automático desde GitHub.

---

## 🧱 Arquitectura

```
WAR/
├── home/index.html         # landing page (/home) — primera pantalla pública
├── lobby/index.html        # hub de navegación (/lobby)
├── game/index.html         # pantalla de juego (/game)
├── login.html              # pantalla de login (Google OAuth o wallet)
├── register/index.html     # registro de usuario nuevo (/register)
├── gamers/index.html       # ranking de jugadores (/gamers)
├── my-profile/index.html   # perfil del jugador autenticado (/my-profile)
├── admin/index.html        # panel de administración (/admin) — gestión de cartas y battle pass
├── battle-pass/index.html  # battle pass del jugador (/battle-pass) — calendario y claim diario
├── shop/index.html         # tienda on-chain (/shop) — WGT balance, inventario, compra de items
├── css/style.css           # estilos
├── js/
│   ├── map-data.js         # territorios, continentes, adyacencias
│   ├── map-shapes.js       # formas SVG del mapa (generado, no editar a mano)
│   ├── game.js             # motor del juego (lógica pura)
│   ├── ui.js               # render del mapa SVG e interacción
│   ├── pixi-overlay.js     # animaciones de batalla (Pixi.js)
│   ├── multiplayer.js      # cliente WebSocket de la sala
│   ├── wallet.js           # wallet Web3 (ethers)
│   └── main.js             # arranque y orquestación
├── functions/api/win.js    # Pages Function: /api/win (victoria del usuario autenticado)
├── functions/api/gamers.js # Pages Function: /api/gamers (ranking)
├── functions/api/profile.js # Pages Function: /api/profile
├── functions/api/register.js # Pages Function: /api/register
├── functions/gamers/[username].js # Pages Function: /gamers/<username> (perfil HTML público)
├── functions/api/auth/
│   ├── google.js           # inicia OAuth con Google
│   ├── callback.js         # completa OAuth, guarda cookie de sesión
│   └── wallet.js           # login alterno con wallet
├── functions/api/wallet/link.js # vincula wallet a la cuenta de la sesión
├── functions/_lib/
│   └── session.js          # firma y verifica cookie war_session (HMAC-SHA256)
├── functions/api/cards/    # inventory.js · use.js · delete.js
├── functions/api/battle-pass/ # status.js · claim.js
├── functions/api/admin/    # cards.js · battle-pass.js (requieren ADMIN_EMAILS)
├── functions/api/game-room.js # Pages Function: routing de /api/game-room al Durable Object
├── worker/                 # Worker separado "war-game-room" que aloja el Durable Object
├── migrations/             # migraciones D1 (estado actual del esquema)
├── scripts/build-map-shapes.mjs # genera js/map-shapes.js (npm run build:map)
├── tests/                  # tests unitarios (node --test)
├── Docs/                   # documentación del proyecto
├── wrangler.toml           # configuración de Cloudflare
├── _headers                # cabeceras de seguridad/caché
├── _redirects              # redirige / → /home (Cloudflare Pages)
└── .assetsignore           # excluye tests/ del deploy de Pages
```

Ver [Docs/architecture.md](Docs/architecture.md) para el detalle completo de cada módulo.
Ver [Docs/style.md](Docs/style.md) para el sistema de diseño (tokens de color/tipografía y reglas de uso).

**Servicios de Cloudflare usados:** Pages (hosting), Pages Functions (API),
D1 (base de datos de usuarios/leaderboard), Durable Objects (sala multijugador
`GameRoom`, alojada en el Worker separado `war-game-room` — ver
[Docs/deployment.md](Docs/deployment.md) para su pipeline de despliegue independiente).

---

## 📄 Licencia

MIT.
