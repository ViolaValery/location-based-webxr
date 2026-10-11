# link-check.ts

## Purpose

Step 2's link check (polish round M2, the owner's A13/A16): the plain-language
line under the pasted link, which failures still go on to printing (marked
"not verified yet"), and the light re-check the print step runs before the
PDF. Plan:
`GpsPlusSlamJs_Docs/docs/2026-10-11-0049-tour-viewer-polish-round-plan.md`
(§2a M2).

## Public API

- `type LinkStatus` - `checking`, `found`, or `failed` with the open's cause
  (a `RangeProbeRejectCause` or `"other"`).
- `linkStatusText(status)` - the status line. A missing file and an offline
  device say "Not verified yet" and that printing can go ahead; a host that
  blocks browsers (`cors`, `unusable-link`) says a printed code would not open
  for visitors; anything else says the file is not a tour that opens here.
- `printsUnverified(cause)` - true for `missing` and `offline` only.
- `type LinkCheckResult`, `recheckNote(result)` - the line put in front of
  the PDF's result after the re-check.
- `type LinkOpener`, `checkLink(url, open)` - opens the archive with
  `{ skipCache: true, warm: false }` and disposes it at once; resolves
  `{ ok: true }` or `{ ok: false, cause }`, never rejects.

## Invariants & assumptions

- Why only `missing` and `offline` print unverified: they say nothing against
  the link itself (an own server's link can come before its file; an offline
  device could not ask). Every other cause would fail for every visitor too.
- The re-check never uses the saved copy: a link that stopped working (a
  shortener that opens for the author and not for visitors) would otherwise
  read as reachable. No background download either; the archive is released
  as soon as it opened.
- The check informs, it never blocks: the PDF is built whatever the result.
- The copy is provisional and lives here so the prototype verdict can
  restyle it in one place.

## Examples

```ts
const result = await checkLink(url, (link, options) =>
  openRemoteArchive(link, { ...options, corsProxyBaseUrl }),
);
info.textContent = `${recheckNote(result)} ${pdfResult}`;
```

## Tests

- `link-check.test.ts` - which causes print unverified, a distinct line per
  state, the own-server and blocked-host wording, the opener's options and
  the dispose, cause extraction, and the re-check notes.
- `archive-open-file.test.ts` ("step 2's link check") - the wiring: the
  hand-off on `missing`, none on `cors`, the auto-check on paste and change.
- `print-panel.test.ts` - the "not verified yet" display.
- `playwright-tests/setup-flow.spec.js` - auto-check on leaving the field,
  and an unuploaded link reaching the print step.
