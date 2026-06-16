# Estilo visual — matte navy + gold

## Origen

El sistema viene del proyecto de diseño **"WAR Design System"** en
claude.ai/design (`40709d42-9a07-4f58-8610-b330d333d696`, propiedad de
Anthony Asuaje). Ese proyecto recreó la interfaz de este repo (`css/style.css`,
`home/index.html`, `login.html`) y la "aplanó": mismo identidad navy + dorado,
pero sin gradientes, glows ni brillos. El brief original pedía un look único
para todas las pantallas (antes cada una usaba colores distintos), **opaco y
mate**, negro + azul oscuro, bordes redondeados, fuente fácil de leer.

`css/style.css` es la fuente de verdad de los tokens en este repo — si se
vuelve a sincronizar con el proyecto de diseño, los valores deben copiarse ahí
primero.

## Filosofía

- **Opaco y mate.** Relleno sólido + borde de 1px + sombra neutra. Nada de
  `linear-gradient` en botones, texto o tarjetas, y nada de `box-shadow`
  coloreado tipo glow.
- **Un solo dorado de acento**, plano (`--accent`), no un gradiente
  dorado→naranja.
- **Bordes redondeados** en todo (`--radius: 12px` por defecto).
- **Excepción permitida:** washes radiales ambientales muy sutiles detrás del
  hero/login (`body` en `css/style.css` tiene uno) y el radial del mar del
  tablero. No se usan en botones, tarjetas ni texto.
- **El tablero del juego queda fuera de alcance** — el mapa SVG
  (`.map-wrap`, `.terr`, colores de continente/jugador, `--sea`/`--sea-2`,
  los dados) nunca se restylea con este sistema. Es intencionalmente la única
  zona donde aparecen varios colores saturados a la vez.

## Tokens (`css/style.css :root`)

| Variable | Valor | Uso |
|---|---|---|
| `--bg` | `#0a1626` | Fondo de página |
| `--bg-2` | `#0f1f30` | Fondo secundario / wells |
| `--panel` | `#16273b` | Tarjetas, paneles |
| `--panel-2` | `#1d3047` | Paneles elevados, inputs sobre panel |
| `--panel-3` | `#243a54` | Hover de superficie |
| `--ink` | `#e8edf3` | Texto principal |
| `--ink-dim` | `#9fb2c6` | Texto secundario, labels |
| `--ink-faint` | `#647b92` | Texto terciario / deshabilitado |
| `--line` | `#284866` | Borde por defecto |
| `--line-soft` | `#1c344c` | Divisor sutil |
| `--line-strong` | `#3a5d80` | Borde enfatizado / focus |
| `--accent` | `#e0b65c` | Dorado de marca (plano) |
| `--accent-2` | `#ecc674` | Hover del dorado |
| `--accent-press` | `#a9863b` | Press del dorado |
| `--accent-ink` | `#241a02` | Texto sobre relleno dorado |
| `--danger` | `#d8434f` | Ataque / destructivo / derrota |
| `--ok` | `#2f9d8d` | Confirmar / victoria / online |
| `--info` | `#3a7ca5` | Informativo / mar |
| `--warn` | `#d98a3d` | Precaución |
| `--radius` | `12px` | Radio por defecto (tarjetas, botones, inputs) |
| `--shadow` | `0 16px 40px rgba(0,0,0,.5)` | Sombra neutra estándar |
| `--font-display` | `"Cinzel", Georgia, serif` | Wordmark / hero |
| `--font-heading` | `"Oswald", sans-serif` | Headings, labels, botones |
| `--sea` / `--sea-2` | `#3a7ca5` / `#1f5478` | Solo tablero — no usar en chrome |

## Tipografía

- **Cinzel** — solo wordmark `WAR·` y títulos hero/sección. Nada más.
- **Oswald** — botones, labels, eyebrows, headings de UI. Casi siempre en
  `UPPERCASE` con `letter-spacing`.
- **Sans del sistema** (`system-ui, -apple-system, "Segoe UI", Roboto...`) —
  body, párrafos, texto de formularios.

Las fuentes se cargan vía `<link>` a Google Fonts en cada página (no hay un
`tokens/fonts.css` separado en este repo, a diferencia del proyecto de
diseño):

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@600;800&family=Oswald:wght@400;500;600&display=swap" rel="stylesheet">
```

## Reglas para páginas nuevas

1. Enlazar `css/style.css` con la ruta relativa correcta según la
   profundidad de la página (`href="css/style.css"` en la raíz,
   `href="../css/style.css"` en subcarpetas como `register/`, `lobby/`).
2. Incluir el `<link>` de Google Fonts de arriba.
3. Reusar las clases compartidas en vez de reinventar estilos: `.btn`,
   `.btn-primary`, `.btn-ghost`, `.field`, paneles con
   `background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow);`.
4. Cualquier `<style>` inline en la página debe limitarse a layout específico
   de esa pantalla — los colores, radios y sombras siempre deben venir de las
   variables, nunca de hex hardcodeados.
5. Botones y tarjetas: relleno sólido + borde 1px + sombra neutra. Nunca
   `linear-gradient` ni `box-shadow` de color (glow).

## Páginas que siguen este sistema

`home/index.html`, `login.html`, `register/index.html`, `lobby/index.html`,
`my-profile/index.html`, `gamers/index.html` y `game/index.html`.

`register/`, `lobby/`, `my-profile/` y `gamers/` antes usaban un tema
monoespaciado (`Courier New`) negro/rojo sin relación con el resto del juego;
fueron migradas a este sistema.

## Fuera de alcance

El lienzo del mapa SVG del juego (`.map-wrap`, `.terr`, colores de continente
y de jugador, `--sea`/`--sea-2`, los dados) se mantiene intacto a propósito —
es la única parte de la interfaz que no sigue esta paleta.
