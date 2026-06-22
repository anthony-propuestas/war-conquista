# Web3 — Wallet (ethers)

WAR integra una wallet Ethereum (MetaMask) para identificar al jugador y, de forma
experimental, acuñar/recompensar con contratos. Toda la lógica vive en `js/wallet.js` y
usa **ethers v6**.

La wallet cumple dos roles: **identidad de jugador** en el multijugador, y **método
de autenticación** (firma + verificación server-side, ver "Login y vinculación"). Desde
2026-06, WAR tiene contratos vivos en **Base Sepolia** (testnet) para el ciclo
WGT ↔ tienda de items.

## Contratos desplegados — Base Sepolia (chain 84532)

| Contrato | Dirección |
|---|---|
| `WGTToken.sol` (ERC-20) | `0x6bc93daaa5e35dece8f1d676757cfc1d6616b535` |
| `ItemShop.sol` | `0x197c835cc303088713c1ea3549ef1fb76a3786ca` |
| Minter role (wallet del Worker) | `0x966C7f05D8415f00e33d68825A2d37F52e086246` |

Deploy en mainnet pendiente (paso 9 de `planONCHAIN.md`).

## Carga de `ethers`

No hay bundler. `ethers` se carga en el navegador vía **`importmap`** desde
**esm.sh** (`https://esm.sh/ethers@6.16.0`), declarado en `game/index.html`, `login.html` y
`home/index.html` (ver [stack.md](stack.md)). No depende de `node_modules` en los assets
desplegados — eso solo aplica al uso server-side de `ethers` en Pages Functions (ver
[deployment.md](deployment.md)).

## API — `js/wallet.js`

El módulo guarda `provider`/`signer` en estado de módulo.

| Función | Qué hace |
|---|---|
| `connectWallet()` | Exige `window.ethereum` (lanza `'MetaMask no está instalado'` si falta). Crea `BrowserProvider`, pide cuentas (`eth_requestAccounts`), obtiene el `signer` y devuelve su dirección. |
| `getAddress()` | Dirección del `signer` actual, o `null` si no hay wallet conectada. |
| `signMessage(message)` | Firma un mensaje arbitrario con el `signer` conectado; lanza `'Wallet no conectada'` si no hay signer. Usado para autenticarse (ver abajo). |
| `mintNFT(contractAddress, abi, tokenURI)` | Crea un `Contract` y llama `mint(address, tokenURI)`; espera la confirmación (`tx.wait()`). |
| `claimReward(contractAddress, abi)` | Llama `claimReward()` del contrato; espera confirmación. |
| `getWGTBalance(contractAddress)` | Lee el balance WGT del signer actual (`ERC20.balanceOf(address)`). Devuelve bigint en wei. |
| `approveWGT(contractAddress, spender, amount)` | Llama `ERC20.approve(spender, amount)` para autorizar al `ItemShop` a quemar WGT. Espera confirmación. |
| `buyShopItem(shopAddress, itemId)` | Llama `ItemShop.buyItem(itemId)`. Requiere `approve()` previo. Espera confirmación y devuelve el receipt. |

Todas las funciones lanzan `'Wallet no conectada'` si no hay `signer`.

## Uso en la app — `js/main.js`

- El botón `#btn-wallet` dispara `connectWallet()`; la dirección se muestra abreviada
  (`0x1234…abcd`) en la topbar y se guarda en `sessionStorage` (`walletAddress`) para
  conservarla al pasar a la pantalla de juego.
- En multijugador, la dirección es el **`playerId`** que se envía a la sala; si no hay
  wallet, se usa un id anónimo (ver [realtime.md](realtime.md)).

## Login y vinculación

`login.html` y `my-profile/index.html` usan `connectWallet()` + `signMessage()` para
autenticarse contra el backend, sin enviar la clave privada en ningún momento — solo
la firma:

- `/my-profile` → "Conectar wallet": firma `Vincular esta wallet a mi cuenta WAR (${sub})`
  y llama `POST /api/wallet/link` para guardar la dirección en `users.wallet_address`.
- `/login` → "Conectar MetaMask": firma `Iniciar sesión en WAR con esta wallet (${address})`
  y llama `POST /api/auth/wallet`, que verifica la firma con `verifyMessage` (ethers) y,
  si la wallet ya está vinculada, emite la cookie `war_session`.

Ver el flujo completo en [auth.md](auth.md), los endpoints en [api.md](api.md) y la
columna `wallet_address` (índice único parcial) en [database.md](database.md).

## Flujo de reclamo de WGT

```
Jugador hace clic "Reclamar WGT"
       │
       ▼
Frontend: firma mensaje "claim-wgt:{userId}:{timestamp}" con MetaMask (signMessage)
       │
       ▼
POST /api/claim-wgt  { signature, timestamp }
       │
       ▼
Worker: verifica firma ECDSA → suma wins de meses cerrados → marca claimed_at en D1
        → WGTToken.mint(walletAddress, total × 1e18) en Base Sepolia
        → si falla el mint: revierte claimed_at a NULL
       │
       ▼
Jugador recibe WGT en su wallet de Base
```

## Flujo de compra de items (2 transacciones ERC-20)

```
Jugador elige item en la tienda
       │
       ▼
TX 1: approveWGT(WGT_CONTRACT, SHOP_CONTRACT, wgtPrice)   — jugador paga gas
       │
       ▼
TX 2: buyShopItem(SHOP_CONTRACT, itemId)
       │  ItemShop quema WGT del jugador y emite evento ItemPurchased
       ▼
Frontend envía POST /api/deliver-item { txHash }
       │
       ▼
Worker: verifica receipt en Base → parsea ItemPurchased → upsert en user_shop_items
        → registra en delivered_txs (idempotente: rechaza re-entregas del mismo txHash)
       │
       ▼
Item aparece en inventario: GET /api/shop/inventory
```

## Sin tests (cliente) / cubierto (backend)

Los endpoints `functions/api/auth/wallet.js`, `functions/api/wallet/link.js`,
`functions/api/shop/inventory.js` y `functions/api/shop/pending-wgt.js` sí tienen tests
(firman con `ethers.Wallet` real o usan mocks de DB) — ver [testing.md](testing.md).
`functions/api/claim-wgt.js` y `functions/api/deliver-item.js` están diferidos: dependen de
firma ECDSA real + mint/receipt on-chain que requieren mockear ethers y un nodo Base, no
estables bajo `node --test`. `js/wallet.js` tampoco está cubierto: depende de `window.ethereum`.
Ver [testing.md](testing.md).

Ver también: [architecture.md](architecture.md), [realtime.md](realtime.md),
[stack.md](stack.md).
