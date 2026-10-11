# host-picker.ts

## Purpose

Step 1's host tiles (polish round M2, the owner's A6/A7): one radio tile per
host from `tour-host.ts`, the chosen host's own steps listed below them, the
starter zip shown only for a host that needs a file before it gives a link,
and a Continue that hands over to step 2 (the link). Plan:
`GpsPlusSlamJs_Docs/docs/2026-10-11-0049-tour-viewer-polish-round-plan.md`
(§2a M2).

## Public API

- `wireHostPicker<T>({ dom, store, createElement, onContinue })`
  - `dom.tiles` - the `role="radiogroup"` the tiles are rendered into. A
    second tap on the chosen tile deselects it and clears the stored choice
    (prototype verdict P6).
  - `dom.steps` - the `<ol>` for the chosen host's steps; hidden until a
    choice.
  - `dom.starter` - the starter zip button. Only its visibility is this
    module's; its click (pack and hand over the zip) is the wizard's.
  - `dom.continueButton` - hidden until a choice; a click calls
    `onContinue(host)`.
  - `store` - the `localStorage` slice (`tour-host.ts`), or undefined.
  - `createElement` - `document.createElement`, injected so the tests run in
    node; `T` is the element type it returns.

## Invariants & assumptions

- Each tile is a `<button role="radio">` carrying `data-host` and
  `aria-checked`; exactly one is checked once a host is chosen, none before.
- A stored choice is read once at wiring and shown checked, with its steps:
  a returning creator sees what they picked.
- The choice is held in the module as well as in the store, so a store that
  throws (site data blocked) still carries the choice for the page.
- Continue without a choice does nothing (it is hidden then anyway).
- Tiles use the atoms `btn btn--prose`; the pressed look of the checked tile
  is page CSS in `index.html` (`.host-tile[aria-checked="true"]`).

## Examples

```ts
wireHostPicker<HTMLButtonElement | HTMLLIElement>({
  dom: { tiles, steps, starter, continueButton },
  store: localStorage,
  createElement: (tag) => document.createElement(tag),
  onContinue: () => wizard.openStep("link"),
});
```

## Tests

- `host-picker.test.ts` - order and labels, nothing checked on a first visit,
  a tap stores and checks one tile and lists its steps, the starter zip for a
  cloud host and not an own server, a stored choice back after a reload,
  Continue with and without a choice, and missing or throwing stores.
- `playwright-tests/setup-flow.spec.js` - the first visit end to end
  (storage cleared), the reload, and the own server's headers.
