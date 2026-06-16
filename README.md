# 🌍 WAR · Conquista del Mundo

### ▶️ Jugar ahora: **https://war-conquista.pages.dev**

Juego de estrategia por turnos inspirado en el clásico juego de mesa **WAR** (estilo *Risk*).
Conquista territorios, domina continentes y elimina a tus rivales. **Multijugador local**
(hotseat) directamente en el navegador, sin instalar nada.

> Hecho con HTML, CSS y JavaScript puro (sin frameworks) y desplegado en **Cloudflare Pages**
> con un salón de la fama persistido en **Cloudflare D1**.

---

## ✨ Características

- 🗺️ **Mapa de 44 territorios** repartidos en 6 continentes con bonus por dominio.
- 🎲 **Combate con dados** fiel al original (hasta 3 dados de ataque, 2 de defensa).
- ♻️ **Fases de turno**: despliegue → refuerzo → ataque → fortificación.
- 👥 **1 a 3 jugadores** en la misma máquina, cada uno con su color.
- 🏆 **Salón de la fama** global persistido en Cloudflare D1.
- 🔐 **Login con Google o wallet MetaMask** para vincular tus victorias a tu cuenta.
- 📱 Interfaz responsive, sin librerías JS ni frameworks (única dependencia externa en
  runtime: las fuentes **Cinzel** y **Oswald** de Google Fonts).

---

## 🎮 Cómo se juega

1. **Despliegue:** cada jugador coloca sus ejércitos iniciales en sus territorios.
2. **Refuerzo:** recibes tropas según los territorios y continentes que domines.
3. **Ataque:** elige un territorio propio con 2+ ejércitos y ataca a un vecino enemigo.
   Se comparan los dados más altos; el empate favorece al defensor.
4. **Fortificación:** mueve tropas entre dos territorios propios conectados.
5. **Victoria:** gana quien conquiste **todos** los territorios o quede como **único jugador con territorios** (todos los rivales eliminados).

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
npm run db:init:remote            # crea la tabla en la DB remota
```

### 2. Configurar secrets de Google OAuth

```bash
wrangler pages secret put GOOGLE_CLIENT_ID --project-name war-conquista
wrangler pages secret put GOOGLE_CLIENT_SECRET --project-name war-conquista
```

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

---

## 🧱 Arquitectura

```
WAR/
├── home/index.html         # landing page (/home) — primera pantalla pública
├── index.html              # estructura (pantalla inicio + juego)
├── login.html              # pantalla de login con Google OAuth
├── css/style.css           # estilos
├── js/
│   ├── map-data.js         # territorios, continentes, adyacencias
│   ├── map-shapes.js       # formas SVG del mapa (generado, no editar a mano)
│   ├── game.js             # motor del juego (lógica pura)
│   ├── ui.js               # render del mapa SVG e interacción
│   └── main.js             # arranque y leaderboard
├── functions/api/scores.js # Pages Function: /api/scores (D1)
├── functions/api/auth/
│   ├── google.js           # inicia OAuth con Google
│   └── callback.js         # completa OAuth, guarda cookie de sesión
├── scripts/build-map-shapes.mjs # genera js/map-shapes.js (npm run build:map)
├── tests/                  # tests unitarios (node --test)
├── Docs/                   # documentación del proyecto
├── schema.sql              # esquema de la base de datos
├── wrangler.toml           # configuración de Cloudflare
├── _headers                # cabeceras de seguridad/caché
├── _redirects              # redirige / → /home (Cloudflare Pages)
└── .assetsignore           # excluye tests/ del deploy de Pages
```

**Servicios de Cloudflare usados:** Pages (hosting), Pages Functions (API),
D1 (base de datos del salón de la fama).

---

## 📄 Licencia

MIT.
