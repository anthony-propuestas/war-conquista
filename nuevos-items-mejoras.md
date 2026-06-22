# Guía: Agregar Nuevos Ítems de Mejora

## Resumen del sistema

Un ítem de mejora tiene ciclo de vida en 4 capas:

```
Blockchain (ItemShop.sol)
  → D1 (card_definitions + user_shop_items)
    → Motor de juego (js/game.js applyCardEffect)
      → UI en partida (js/ui.js) + Tienda (shop/index.html)
```

El contrato **no necesita redeploy** para nuevos ítems. Solo se configura via `addItem()`.

---

## Capa 1 — Blockchain: registrar el ítem en el contrato

El contrato `ItemShop.sol` es completamente genérico. Para activar un nuevo ítem, el admin llama:

```solidity
shop.addItem(
  itemId,    // uint256 — ID único, debe coincidir con card_definitions.id en D1
  wgtPrice,  // uint256 en wei (ej: 2e18 = 2 WGT)
  quantity   // uint256 — unidades que se entregan por compra
);
```

**No hay cambios al código del contrato.** El mecanismo de `burnFrom` + evento `ItemPurchased` funciona para cualquier ID.

---

## Capa 2 — D1: definir el ítem y su mecánica

### 2a. Nuevo archivo de migración

Crear `migrations/0004_new_items.sql` (o el siguiente número disponible):

```sql
INSERT INTO card_definitions (id, name, description, effect_type, effect_value, is_active)
VALUES (
  4,                        -- debe coincidir con itemId en el contrato
  'Nombre del ítem',
  'Descripción para el jugador',
  'NOMBRE_EFECTO',          -- string libre, se usa como clave en game.js y ui.js
  '5',                      -- valor numérico como string (se parsea con Number())
  1
);
```

Aplicar en staging:
```bash
wrangler d1 execute war-scores --file=migrations/0004_new_items.sql
```

### 2b. Schema de referencia (tablas ya existentes)

```
card_definitions: id, name, description, effect_type, effect_value, is_active, created_at
user_shop_items:  (user_id, card_def_id) PK, quantity, updated_at
delivered_txs:    tx_hash PK, user_id, delivered_at
```

`effect_type` es un string libre — no hay enum en D1, el contrato no lo conoce. La validación vive en `js/game.js`.

**`deliver-item.js` no necesita cambios** — ya maneja cualquier `card_def_id` activo.

---

## Capa 3 — Motor de juego: implementar la mecánica

Archivo: `js/game.js`, método `applyCardEffect` (~línea 298).

Agregar un bloque `if` antes del `return false` final:

```js
if (effectType === 'NOMBRE_EFECTO') {
  const value = Math.max(1, Math.floor(Number(effectValue)));
  // ... lógica de la mecánica ...
  this._log(`${this.current.name} activa [Nombre del efecto]!`);
  return true;
}
```

### Mecánicas disponibles como referencia

| effectType     | Qué modifica en el estado del juego       |
|----------------|-------------------------------------------|
| EXTRA_UNITS    | `this.reinforcements += units`            |
| DOUBLE_ATTACK  | `this._doubleAttack = true`               |
| SHIELD         | `this._shield = playerId`                 |

### Reglas para nuevas mecánicas

- **Flags booleanos** (`_doubleAttack`, `_shield`): el motor los resetea al final del turno o al consumirse. Antes de agregar un flag nuevo, buscar en `game.js` dónde se limpian `_doubleAttack` y `_shield` y seguir el mismo patrón.
- **Efecto inmediato** (como `EXTRA_UNITS`): aplica directamente al estado sin necesidad de limpiar nada.
- **Efectos que afectan al oponente**: usar `this._shield` como modelo — guarda el `playerId` objetivo y se verifica dentro del método `attack()`.
- `applyCardEffect` ya valida que `this.phase === 'play'` y que el jugador sea el actual. No repetir esa lógica en el nuevo bloque.

---

## Capa 4a — UI en partida: ícono y notificación

Archivo: `js/ui.js`

### 4a-1. Ícono en el panel de cartas

Buscar el mapa de iconos por `effect_type` (cerca de la construcción del panel `#items-list`). Agregar el nuevo tipo:

```js
// Iconos existentes:
// 'EXTRA_UNITS'   → '🪖'
// 'DOUBLE_ATTACK' → '⚔'
// 'SHIELD'        → '🛡'
'NOMBRE_EFECTO': '🔥',   // ← agregar
```

### 4a-2. Texto de notificación para enemigos

Cuando un rival usa una carta, los demás ven un modal vía `showEnemyCardNotification`. Agregar la descripción del efecto en el mismo mapa de textos donde están los efectos existentes.

---

## Capa 4b — Tienda: mostrar el ítem en el catálogo

Archivo: `shop/index.html`

**Cambio 1** — agregar metadata del ítem (~línea 126):

```js
const ITEM_META = {
  1: { icon: '⚔️', name: 'Refuerzos Extra',  desc: '...' },
  2: { icon: '💥', name: 'Doble Ataque',      desc: '...' },
  3: { icon: '🛡️', name: 'Escudo',             desc: '...' },
  4: { icon: '🔥', name: 'Nombre del ítem',   desc: 'Descripción para la tienda' }, // ← nuevo
};
```

**Cambio 2** — agregar el ID al array de consulta al contrato (~línea 246):

```js
const itemIds = [1, 2, 3, 4];  // ← agregar el nuevo ID
```

El resto del flujo (approve → buyItem → deliver-item → inventario) funciona automáticamente.

---

## Checklist completo

```
[ ] 1. Contrato       — llamar shop.addItem(newId, price, qty) desde wallet admin en Base
[ ] 2. D1             — nueva migración con INSERT en card_definitions
[ ] 3. game.js        — nuevo bloque if en applyCardEffect (+ limpiar flag si aplica)
[ ] 4. ui.js          — ícono en panel de cartas + texto en notificación enemiga
[ ] 5. shop/index.html — entrada en ITEM_META + ID en itemIds[]
[ ] 6. Tests          — ver sección de verificación
```

---

## Verificación y no-regresión

### Contratos (Foundry)

```bash
cd contracts && forge test
```

Los tests existentes en `contracts/test/ItemShop.t.sol` cubren el flujo genérico de compra para cualquier ID. Solo agregar un test nuevo si el ítem tiene lógica nueva en el contrato (actualmente no aplica).

### API / D1

```bash
npx vitest tests/api/shop/
```

`inventory.test.js` verifica que el endpoint devuelve los campos `effect_type` y `effect_value`. Si el nuevo ítem tiene lógica especial en algún endpoint, agregar un caso de prueba.

### Motor de juego

`js/game.js` es una clase pura sin dependencias. Se puede probar directamente en Node:

```js
const g = new WarGame([player0, player1]);
g.applyCardEffect(0, 'NOMBRE_EFECTO', '5');
// afirmar que el estado cambió correctamente
// afirmar que EXTRA_UNITS, DOUBLE_ATTACK y SHIELD siguen funcionando
```

### Prueba end-to-end manual

1. Admin llama `addItem()` en Base Sepolia (staging)
2. `wrangler d1 execute war-scores --file=migrations/0004_new_items.sql --env=staging`
3. Abrir la tienda → verificar que el nuevo ítem aparece en el catálogo
4. Comprar → verificar inventario en `GET /api/shop/inventory`
5. Iniciar partida → usar la carta → verificar que el efecto se aplica en el motor
6. Confirmar que los 3 ítems existentes (EXTRA_UNITS, DOUBLE_ATTACK, SHIELD) siguen funcionando

### Señales de regresión a vigilar

| Síntoma | Causa probable |
|---------|----------------|
| `applyCardEffect` devuelve `false` | Typo en `effect_type` entre D1 y `game.js` |
| Ítem en inventario pero no en tienda | ID faltante en `itemIds[]` de `shop/index.html` |
| Doble entrega del ítem | No tocar la lógica de `delivered_txs` — ya lo previene |
| Ícono ☐ (cuadrado roto) en la UI | Falta entrada en el mapa de iconos de `ui.js` |
| Flag de efecto no se limpia | No se reseteó el flag al final del turno en `game.js` |
