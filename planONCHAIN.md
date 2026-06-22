# Plan On-Chain — WAR

---

## Decisiones finales (sin preguntas pendientes)

| Decisión | Valor |
|---|---|
| Red | **Base mainnet** + Base Sepolia para tests |
| Token WGT | **ERC-20 estándar** — transferible, vendible, sin supply cap |
| WGT por victoria | **1 WGT** por batalla ganada |
| Wins no reclamados | Se acumulan indefinidamente — nunca expiran |
| Disponibilidad de reclamo | Solo wins de meses **ya cerrados** (year_month < mes actual) |
| Cooldown entre reclamos | Ninguno — el jugador reclama cuando quiera |
| Precio de item | **1 WGT**, entrega **5 unidades** — ambos configurables por item |
| Items al lanzar | 3 (ver abajo), el contrato soporta más sin modificarse |
| Almacenamiento de items | **Horizontal en D1** — `user_shop_items(user_id, card_def_id, quantity)` |
| Fuente de verdad de wins | **D1** — el Worker calcula y mintea al reclamar |
| Admin de tienda | Solo el dueño del contrato (tú) |

---

## Los 3 items del lanzamiento

Vienen de `applyCardEffect` en `js/game.js`. El `card_def_id` en D1 y el `itemId` en el contrato son el mismo número.

| itemId / card_def_id | Nombre | effect_type | effect_value |
|---|---|---|---|
| 1 | Refuerzos Extra | `EXTRA_UNITS` | `3` (unidades extra) |
| 2 | Doble Ataque | `DOUBLE_ATTACK` | `0` (toggle, sin valor) |
| 3 | Escudo | `SHIELD` | `0` (toggle, sin valor) |

> Estos deben insertarse en `card_definitions` en la migración `0003_onchain.sql`.

---

## Arquitectura final

```
┌──────────────────────────────────────────────────────────────┐
│                       FRONTEND (Pages)                        │
│   js/wallet.js  ──►  MetaMask / ethers.js                    │
│                                                               │
│   1. Firma mensaje para reclamar WGT                          │
│   2. approve() + buyItem() para comprar en la tienda          │
│   3. Envía txHash al Worker para recibir items en D1          │
└───────────┬──────────────────────────────┬────────────────────┘
            │ HTTP                         │ HTTP
            ▼                             ▼
┌───────────────────────┐    ┌────────────────────────────────┐
│   Cloudflare Worker   │    │        Base (EVM)              │
│   + D1 (SQLite)       │    │                                │
│                       │    │  ┌────────────────────────┐   │
│  POST /api/claim-wgt  │    │  │   WGTToken.sol (ERC-20) │   │
│    lee D1, mintea ────┼────┼─►│   mint(address, amount) │   │
│    marca claimed_at   │    │  │   MINTER_ROLE: Worker   │   │
│                       │    │  └───────────┬────────────┘   │
│  POST /api/deliver    │    │              │ burnFrom        │
│  -item                │    │  ┌───────────▼────────────┐   │
│    verifica txHash ◄──┼────┼──│   ItemShop.sol          │   │
│    upsert quantity    │    │  │   buyItem(itemId)        │   │
│    en user_shop_items │    │  │   emite ItemPurchased   │   │
│                       │    │  │   ADMIN_ROLE: tú         │   │
└───────────────────────┘    │  └────────────────────────┘   │
                             └────────────────────────────────┘
```

> **Contratos desplegados en Base Sepolia (chain 84532):**
> - WGTToken: `0x6bc93daaa5e35dece8f1d676757cfc1d6616b535`
> - ItemShop: `0x197c835cc303088713c1ea3549ef1fb76a3786ca`
> - Minter (wallet del Worker): `0x966C7f05D8415f00e33d68825A2d37F52e086246`

---

## Contrato 1 — `WGTToken.sol`

### Responsabilidades
- ERC-20 transferible y vendible (OpenZeppelin ERC20 + ERC20Burnable + AccessControl)
- `MINTER_ROLE`: solo el Worker puede llamar `mint()`
- `burnFrom()`: permite a `ItemShop.sol` quemar tokens del comprador

### Funciones del contrato
```solidity
// Solo MINTER_ROLE
function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE)

// Heredado de ERC20Burnable — llamado por ItemShop
function burnFrom(address account, uint256 amount) public override
```

### Flujo de acumulación de wins (sin blockchain)
```
Jugador gana batalla
       │
       ▼
Worker: INSERT INTO user_monthly_wins ...  (ya existía users.wins, se adapta)
(cero transacciones blockchain en este paso)
```

### Flujo de reclamo de WGT
```
Jugador hace clic "Reclamar WGT"
       │
       ▼
Frontend: firma mensaje "claim-wgt:{userId}:{timestamp}" con MetaMask
       │
       ▼
POST /api/claim-wgt  { signature, timestamp }
       │
       ▼
Worker:
  1. Verifica firma con ethers.verifyMessage → compara con wallet_address en D1
  2. Consulta user_monthly_wins WHERE claimed_at IS NULL AND year_month < mes_actual
  3. Suma total de wins reclamables
  4. Si total == 0 → 400 "nada pendiente o mes aún activo"
  5. Marca esas filas claimed_at = now() en D1  ← PRIMERO (evita doble mint si falla el paso 6)
  6. Llama WGTToken.mint(walletAddress, total * 1e18)
  7. Si el mint falla → revierte el claimed_at a NULL en D1
       │
       ▼
Jugador recibe WGT en su wallet de Base
```

---

## Contrato 2 — `ItemShop.sol`

### Responsabilidades
- Catálogo on-chain de items: `itemId → { wgtPrice, quantity, active }`
- Quemar WGT del comprador al comprar
- Emitir evento que el Worker usa para entregar el item en D1
- `ADMIN_ROLE`: solo tú puedes agregar/modificar items

### Estructura de datos
```solidity
struct ShopItem {
    uint256 wgtPrice;   // en wei (1 WGT = 1e18)
    uint256 quantity;   // unidades entregadas en D1
    bool    active;
}
mapping(uint256 => ShopItem) public items;

event ItemPurchased(address indexed buyer, uint256 indexed itemId, uint256 quantity, uint256 timestamp);
```

### Funciones del contrato
```solidity
// Jugador compra — requiere approve previo
function buyItem(uint256 itemId) external

// Admin gestiona catálogo
function addItem(uint256 itemId, uint256 wgtPrice, uint256 quantity) external onlyRole(ADMIN_ROLE)
function updateItem(uint256 itemId, uint256 wgtPrice, uint256 quantity) external onlyRole(ADMIN_ROLE)
function setItemActive(uint256 itemId, bool active) external onlyRole(ADMIN_ROLE)
```

### Flujo de compra (2 transacciones — estándar ERC-20)
```
Jugador selecciona item
       │
       ▼
TX 1: WGTToken.approve(shopAddress, wgtPrice)   ← jugador paga gas
       │
       ▼
TX 2: ItemShop.buyItem(itemId)                  ← jugador paga gas
       │ contrato quema WGT del jugador y emite ItemPurchased
       ▼
Frontend envía POST /api/deliver-item { txHash }
       │
       ▼
Worker:
  1. Verifica tx_hash no está en delivered_txs (anti-doble entrega)
  2. Verifica txHash en Base RPC: emisor == SHOP_CONTRACT, buyer == wallet autenticada
  3. Lee itemId y quantity del evento
  4. Busca user_id por wallet_address en D1
  5. Upsert en user_shop_items: quantity += N
  6. Inserta tx_hash en delivered_txs
       │
       ▼
Item aparece en inventario del jugador
```

### Agregar un item nuevo en el futuro
```
1. Admin inserta en card_definitions en D1 (obtiene un nuevo id)
2. Admin llama ItemShop.addItem(ese_id, precio, cantidad)
→ el flujo de compra funciona automáticamente sin tocar el contrato
```

---

## Migración D1 — `0003_onchain.sql`

```sql
-- Wins por mes (fuente de verdad para el reclamo mensual de WGT)
CREATE TABLE IF NOT EXISTS user_monthly_wins (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  year_month  TEXT    NOT NULL,    -- formato "2026-06"
  wins        INTEGER NOT NULL DEFAULT 0,
  claimed_at  INTEGER,             -- NULL = aún no reclamado
  UNIQUE(user_id, year_month)
);
CREATE INDEX IF NOT EXISTS idx_monthly_wins_user ON user_monthly_wins(user_id);

-- Items de tienda: almacenamiento horizontal (una fila por tipo por jugador)
CREATE TABLE IF NOT EXISTS user_shop_items (
  user_id     INTEGER NOT NULL REFERENCES users(id),
  card_def_id INTEGER NOT NULL REFERENCES card_definitions(id),
  quantity    INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, card_def_id)
);

-- Evitar que el Worker entregue dos veces el mismo txHash
CREATE TABLE IF NOT EXISTS delivered_txs (
  tx_hash      TEXT    PRIMARY KEY,
  user_id      INTEGER NOT NULL,
  delivered_at INTEGER NOT NULL
);

-- Items iniciales de la tienda en card_definitions
INSERT OR IGNORE INTO card_definitions (id, name, description, effect_type, effect_value, is_active, created_at)
VALUES
  (1, 'Refuerzos Extra', 'Añade 3 unidades extra al refuerzo de este turno', 'EXTRA_UNITS',   3, 1, unixepoch()),
  (2, 'Doble Ataque',    'El ataque de este turno cuenta doble',              'DOUBLE_ATTACK', 0, 1, unixepoch()),
  (3, 'Escudo',          'Bloquea el próximo ataque que recibas',             'SHIELD',        0, 1, unixepoch());
```

### Cómo registrar una victoria (cambio en Worker existente)
```sql
-- Reemplaza o complementa el UPDATE de users.wins actual
INSERT INTO user_monthly_wins (user_id, year_month, wins)
VALUES (?, strftime('%Y-%m', 'now'), 1)
ON CONFLICT(user_id, year_month) DO UPDATE SET wins = wins + 1;
```

---

## Secretos del Worker (Cloudflare Secrets)

```
MINTER_PRIVATE_KEY   — clave privada de la wallet con MINTER_ROLE
BASE_RPC_URL         — RPC de Base (Alchemy / Infura / Cloudflare Web3)
WGT_CONTRACT         — dirección de WGTToken.sol
SHOP_CONTRACT        — dirección de ItemShop.sol
```

> La wallet del Worker solo necesita ETH en Base para pagar el gas de `mint()`.  
> El jugador paga el gas de `approve()` y `buyItem()`.

---

## Módulo 4 — Tienda UI (página `/shop`)

Contenido mínimo:
- Balance WGT del jugador (lee desde `WGTToken.balanceOf`)
- WGT reclamables: suma de `user_monthly_wins WHERE claimed_at IS NULL AND year_month < mes_actual`
- Botón "Reclamar WGT" (firma + POST /api/claim-wgt)
- Catálogo de items (lee desde `ItemShop.items` on-chain o caché en D1)
- Por cada item: nombre, descripción, precio, stock propio (`user_shop_items.quantity`)
- Botón "Comprar" → flujo approve + buyItem + POST /api/deliver-item
- Feedback del estado de cada transacción en tiempo real

---

## Orden de implementación

| Paso | Estado | Tarea |
|---|---|---|
| 1 | ✅ | Migración `0003_onchain.sql` en D1 |
| 2 | ✅ | Adaptar el Worker para escribir en `user_monthly_wins` al registrar victorias |
| 3 | ✅ | Escribir y testear `WGTToken.sol` en Base Sepolia |
| 4 | ✅ | Escribir y testear `ItemShop.sol` en Base Sepolia |
| 5 | ✅ | Endpoint Worker `/api/claim-wgt` |
| 6 | ✅ | Endpoint Worker `/api/deliver-item` |
| 7 | ⚠️ | UI de la tienda (`/shop`) — sin página HTML dedicada aún |
| 8 | ⬜ | Tests end-to-end en Base Sepolia |
| 9 | ⬜ | Deploy en Base mainnet — actualizar ABI + addresses en frontend |

---

## Herramientas

- **Foundry** (forge) para compilar, testear y deployar los contratos
- **OpenZeppelin** — ERC20, ERC20Burnable, AccessControl
- **Base Sepolia faucet** para ETH de test (faucet.quicknode.com/drip/base-sepolia)
- **ethers.js** ya instalado en el frontend
- **Alchemy o Infura** como RPC endpoint en Base para el Worker

---

## Alertas de implementación

### 1. ETH en Base ≠ ETH en Ethereum mainnet
Tienes ETH en Ethereum mainnet. Para usarlo en Base necesitas bridgearlo en **bridge.base.org**. Para Base Sepolia usa un faucet, tu ETH de Ethereum Sepolia no sirve directamente en Base Sepolia.

### 2. Race condition en el reclamo
El Worker marca `claimed_at` en D1 **antes** de enviar el mint on-chain. Si el mint falla, el Worker revierte el `claimed_at` a NULL. Esto evita que el jugador quede sin reclamar si hay un error de red en medio.

### 3. Dos transacciones para comprar (UX)
`approve()` + `buyItem()` son 2 transacciones separadas — estándar del ERC-20. El jugador verá 2 pop-ups en MetaMask. La UI debe explicarlo claramente.

### 4. Seguridad de MINTER_PRIVATE_KEY
Si esta clave se compromete, un atacante puede mintear WGT ilimitado. Usar Cloudflare Secrets (nunca en código). Rotar la clave si hay sospecha de exposición.

### 5. Sincronía itemId entre contrato y D1
Cuando agregues un item nuevo en el futuro: primero crear en `card_definitions` (D1), luego `addItem()` en el contrato con el mismo ID. Si se hacen en orden inverso o con IDs distintos, el Worker entrega el item equivocado.
