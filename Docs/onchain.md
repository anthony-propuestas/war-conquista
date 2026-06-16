# Web3 — Wallet (ethers)

WAR integra una wallet Ethereum (MetaMask) para identificar al jugador y, de forma
experimental, acuñar/recompensar con contratos. Toda la lógica vive en `js/wallet.js` y
usa **ethers v6**.

> **Estado: MVP/experimental.** La wallet cumple dos roles: **identidad de jugador** en
> el multijugador, y desde esta sesión también **método real de autenticación**
> (firma + verificación server-side, ver "Login y vinculación" abajo). `mintNFT`/`claimReward`
> existen pero **no hay contratos desplegados ni direcciones en el repo**: el llamador
> debe pasar `contractAddress` y `abi`.

## Carga de `ethers`

No hay bundler. `ethers` se carga en el navegador vía **`importmap`** desde
`/node_modules/ethers/lib.esm/index.js`, declarado en `game/index.html`, `login.html` y
`home/index.html` (ver [stack.md](stack.md)). Implica que `node_modules` debe estar en los
assets desplegados (ver [deployment.md](deployment.md)).

## API — `js/wallet.js`

El módulo guarda `provider`/`signer` en estado de módulo.

| Función | Qué hace |
|---|---|
| `connectWallet()` | Exige `window.ethereum` (lanza `'MetaMask no está instalado'` si falta). Crea `BrowserProvider`, pide cuentas (`eth_requestAccounts`), obtiene el `signer` y devuelve su dirección. |
| `getAddress()` | Dirección del `signer` actual, o `null` si no hay wallet conectada. |
| `signMessage(message)` | Firma un mensaje arbitrario con el `signer` conectado; lanza `'Wallet no conectada'` si no hay signer. Usado para autenticarse (ver abajo). |
| `mintNFT(contractAddress, abi, tokenURI)` | Requiere wallet conectada. Crea un `Contract` y llama `mint(address, tokenURI)`; espera la confirmación (`tx.wait()`). |
| `claimReward(contractAddress, abi)` | Igual, llama `claimReward()` del contrato. |

`mintNFT`/`claimReward` lanzan `'Wallet no conectada'` si no hay `signer`.

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

## Sin tests (cliente) / cubierto (backend)

Los endpoints `functions/api/auth/wallet.js` y `functions/api/wallet/link.js` sí tienen
tests (firman con `ethers.Wallet` real, sin mockear la verificación) — ver [testing.md](testing.md).
`js/wallet.js` no está cubierto: depende de `ethers` y de `window.ethereum` (cadena Web3),
no estables bajo `node --test`. Diferido — ver [testing.md](testing.md).

Ver también: [architecture.md](architecture.md), [realtime.md](realtime.md),
[stack.md](stack.md).
