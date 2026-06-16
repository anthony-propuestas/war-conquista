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

### 4. Firma de Transacciones Onchain ⚠️ (requiere contrato desplegado)
- Minteo de NFTs desde el juego
- Recepción de recompensas directamente en la billetera del jugador
- Soporte para múltiples tipos de transacciones onchain
- **Estado:** `mintNFT()` y `claimReward()` en `js/wallet.js` listos — necesitan dirección de contrato ERC-721.

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

### C. Contrato NFT (minteo de recompensas)
El código de firma (`mintNFT`, `claimReward`) está en `js/wallet.js` pero necesita un contrato ERC-721 desplegado.

**Pasos:**
1. Instalar Foundry: https://getfoundry.sh
2. Claude puede escribir el contrato ERC-721 cuando lo pidas
3. Desplegar en testnet Sepolia primero (gratis):
   ```
   forge create --rpc-url https://rpc.sepolia.org --private-key TU_CLAVE src/WarNFT.sol:WarNFT
   ```
4. Pegar la dirección del contrato en `js/wallet.js` y el ABI en `js/abi/war-nft.json`

**Sin esto:** El juego funciona completo pero sin minteo de NFTs.

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
| Multiplayer servidor | `functions/game-room.js` | ✅ Código listo, pendiente deploy |
| Leaderboard | `functions/api/scores.js` | ✅ Completo (D1) |
| Auth Google init | `functions/api/auth/google.js` | ✅ Completo |
| Auth Google callback | `functions/api/auth/callback.js` | ✅ Completo |
| Contrato NFT | — | ⚠️ Por escribir y desplegar |
