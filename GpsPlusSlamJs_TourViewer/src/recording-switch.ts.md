# recording-switch.ts

## Purpose

The hidden recording switch on the visitor's start page (QR-first plan
§8, M1c, `GpsPlusSlamJs_Docs/docs/2026-10-14-0445-qr-first-alignment-field-study-plan.md`):
five taps on the tour's name within three seconds reload the page with the
debug readout (`debug=1`) and the troubleshooting recording asked for
(`record=1`), so a field test can be recorded after a scan with any QR app.
Page-free; `main.ts` wires it for a visitor.

## Public API

- `createTapCounter({ taps, windowMs, now }): () => boolean` - true on the
  `taps`-th tap within `windowMs`; older taps are forgotten (slow tapping
  never answers) and it starts again after answering.
- `withRecordingFlags(href): string` - `href` with `debug=1` and `record=1`,
  every other parameter, the path and the hash kept; unchanged when both
  are there.
- `wantsRecording(search, debug): boolean` - `record=1` with the debug
  readout on (the recording's controls exist only then): `main.ts` ticks
  the box at load.
- `RECORD_PARAM` (`"record"`).

## Invariants & assumptions

- Nothing visible changes until the fifth tap; the reload happens only
  when the URL would change (no reload loop on a page already recording).
- The switch only asks: the recording itself starts at the AR entry, as a
  ticked box does, and saves through its own panel.

## Tests

`recording-switch.test.ts` (the count in and out of the window, the URL's
flags kept and added, the record request); the wiring by
`playwright-tests/visitor-start.spec.js` ("five taps on the tour's name").
