# Porting notes — building in something other than plain HTML

Only read this if the target is **not** a plain web page. Everything else in the package still applies. The rules, numbers, texts, colours and timings do not change.

## The rule that never changes

Keep `game-logic.js` as the single source of game rules.

- **JavaScript or TypeScript targets** (React, Vue, Svelte, React Native, Electron): import it as-is. For TypeScript, add a `.d.ts` file or rename to `.ts` and add types **without changing logic**. Re-run the 54 tests afterwards.
- **Other languages** (Swift, Kotlin, Dart/Flutter, C#): translate `game-logic.js` function by function, keeping the same names. Then translate `logic.test.js` and make all 54 tests pass **before** building any screens.

## Mapping the screen code

| Reference (app.js) | React | Vue / Svelte | Flutter / SwiftUI |
|---|---|---|---|
| `state` | `useReducer` or `useState` holding the logic state | a reactive store | a `ChangeNotifier` / `@Observable` model |
| `ui` (`mode`, `dark`, `flash[]`, `bad[]`, …) | separate `useState`s | reactive refs | model fields |
| `syncBoard()` keyed reuse | `cells.map(c => <Cell key={c.id} …/>)`. **The `key` must be `c.id`, never the array index.** | `{#each cells as c (c.id)}` / `v-for` with `:key="c.id"` | `ForEach(cells, id: \.id)` / keyed widgets |
| `later()` + `tok` | `setTimeout` in event handlers plus a `useRef` token; clear on unmount | same | `Timer` / `Task.sleep` plus a token |
| `spawnFx()` measured positions | a `ref` per cell and `getBoundingClientRect()`; render effects from an `fx` state array, removed after 1 s | same | `GlobalKey` / `GeometryReader` for positions; an overlay `Stack` |
| CSS keyframes | keep `styles.css` | keep it | rebuild each animation with the same durations, scales and delays from `03-DESIGN.md` §7 |
| `localStorage` + `try/catch` | same | same | `SharedPreferences` / `UserDefaults` |
| `prefers-color-scheme` | `matchMedia` | same | platform brightness |
| `prefers-reduced-motion` | CSS media query | same | `MediaQuery.disableAnimations` / `accessibilityReduceMotion` |

## React-specific traps

- Never generate cells with `key={index}`. Animations will attach to the wrong cells after a row collapses.
- Don't put the timers inside `useEffect` keyed on state; they'll re-fire on every render. Start them in the event handler, like the reference does.
- `React.StrictMode` double-runs effects in development. Don't do game actions in effects.

## Native-app specifics

- Board cells must stay square and fit 9 across. Compute the cell size from the available width: `(width − padding − 8 × gap) / 9`.
- Respect safe areas for the bottom bar (the home indicator on iOS, the gesture bar on Android).
- Haptics are a nice optional extra: light tap on select, success on match, warning on a bad pick. Don't add other features unless asked.
