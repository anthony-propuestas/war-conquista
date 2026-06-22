# Objetivo del Proyecto WAR

## Descripción General

WAR es un juego online multijugador con integración blockchain.

---

## Objetivos

### 1. Juego Online Multijugador ✅ (código listo)
- Partidas en tiempo real entre múltiples jugadores
- Infraestructura para conexiones concurrentes
- **Estado:** `js/multiplayer.js` + `functions/game-room.js` (Durable Object) implementados. Lógica de sala en `js/main.js`.

### 2. Juego 2D con Elementos Animados ✅ (código listo)
- Entorno 2D con gráficos estilizados
- Movimientos decorativos y animaciones visuales para enriquecer la experiencia
- **Estado:** PixiJS v8 integrado como overlay (`js/pixi-overlay.js`). Animaciones de partículas en cada batalla.

### 3. Conexión de Wallet Onchain con MetaMask ✅ (código listo)
- Integración con MetaMask para autenticación e identidad del jugador
- Soporte para wallets compatibles con EVM
- **Estado:** `js/wallet.js` con `connectWallet()`. Botón en `/game`, `/login`, `/home`.

### 4. Integración On-Chain ✅ (Base Sepolia desplegado)
- Tokens WGT (ERC-20) acumulados por victorias y reclamables a la wallet
- Tienda on-chain: compra de items de mejora quemando WGT
- Contratos `WGTToken` e `ItemShop` desplegados en Base Sepolia
- **Estado:** `WGTToken` en `0x6bc93daaa5e35dece8f1d676757cfc1d6616b535`, `ItemShop` en `0x197c835cc303088713c1ea3549ef1fb76a3786ca`. Endpoints `/api/claim-wgt` y `/api/deliver-item` implementados. UI de tienda (`/shop`) pendiente. Deploy en mainnet pendiente.

---

## ⚠️ Pendiente: Acciones que requiere el usuario

### A. Desplegar Durable Objects (multiplayer en producción)
El Durable Object `GameRoom` está escrito pero necesita desplegarse en Cloudflare Workers.

**Requiere:**
- Plan Workers Paid en Cloudflare (~$5/mes)
- Ejecutar en terminal: `npx wrangler deploy`
- Si pide crear el binding, confirmar con `Y`

**Sin esto:** El multijugador solo funciona en local con `npm run dev`.

---

### B. Credenciales Google OAuth (login con Google)
El flujo OAuth está implementado pero necesita credenciales reales.

**Pasos:**
1. Ir a https://console.cloud.google.com
2. Crear proyecto → APIs y servicios → Credenciales → Crear ID de cliente OAuth
3. Tipo: Aplicación web
4. URI de redireccionamiento autorizado: `https://TU-DOMINIO.pages.dev/api/auth/callback` (y `http://localhost:8788/api/auth/callback` para dev)
5. Copiar `Client ID` y `Client Secret`
6. Añadir a `.dev.vars` (desarrollo local):
   ```
   GOOGLE_CLIENT_ID=tu_client_id
   GOOGLE_CLIENT_SECRET=tu_client_secret
   SESSION_SECRET=<resultado de: openssl rand -hex 32>
   ```
7. Añadir también como secrets en Cloudflare Pages (Settings → Environment variables)

---

### C. ✅ Contratos on-chain (WGT + Tienda) — Base Sepolia desplegados

`WGTToken.sol` (ERC-20) e `ItemShop.sol` desplegados en Base Sepolia.
Endpoints `claim-wgt` y `deliver-item` implementados. Foundry en `contracts/`.

**Pendiente:**
- UI de tienda (`/shop`) — página HTML todavía no existe
- Deploy en Base mainnet (paso 9 de `planONCHAIN.md`)
- Tests end-to-end en Base Sepolia

**Sin esto:** El ciclo WGT ↔ items solo funciona vía API directa; sin UI de tienda el jugador no puede reclamar ni comprar desde el browser.

---

### D. MetaMask en el navegador
Para probar la integración wallet en el browser, necesitas la extensión MetaMask instalada:
- Chrome: https://metamask.io/download
- Configurar red Sepolia (testnet) para pruebas sin gas real

---

## Estado actual del código

| Módulo | Archivo | Estado |
|--------|---------|--------|
| Motor de juego | `js/game.js` | ✅ Completo |
| Interfaz SVG | `js/ui.js` | ✅ Completo |
| Animaciones PixiJS | `js/pixi-overlay.js` | ✅ Completo |
| Wallet / MetaMask | `js/wallet.js` | ✅ Completo |
| Multiplayer cliente | `js/multiplayer.js` | ✅ Completo |
| Multiplayer servidor | `worker/index.js` + `functions/api/game-room.js` | ✅ Completo |
| Auth Google | `functions/api/auth/google.js`, `callback.js` | ✅ Completo |
| Registro / Perfil / Ranking | `functions/api/register.js`, `profile.js`, `gamers.js` | ✅ Completo |
| Victorias | `functions/api/win.js` | ✅ Completo |
| Cartas & Battle Pass | `functions/api/cards/*`, `battle-pass/*`, `admin/*` | ✅ Completo |
| Reclamo WGT | `functions/api/claim-wgt.js` | ✅ Completo (Base Sepolia) |
| Entrega de items | `functions/api/deliver-item.js` | ✅ Completo (Base Sepolia) |
| Inventario tienda | `functions/api/shop/inventory.js` | ✅ Completo |
| WGT pendiente | `functions/api/shop/pending-wgt.js` | ✅ Completo |
| Contratos on-chain | `WGTToken.sol`, `ItemShop.sol` | ✅ Base Sepolia — mainnet pendiente |
| UI Tienda | `/shop` | ⚠️ Pendiente |
