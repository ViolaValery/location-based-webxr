# tour-host.ts

## Purpose

Where the tour lives (polish round M2, the owner's A6/A7): the host a
creator picks in step 1 (Google Drive, Dropbox, OneDrive, GitHub, their own
server), that host's own upload-and-link steps, and the stored choice the
later steps read (the replace steps after Finish, whether the starter zip is
offered). Plan:
`GpsPlusSlamJs_Docs/docs/2026-10-11-0049-tour-viewer-polish-round-plan.md`
(§2a M2).

## Public API

- `TOUR_HOSTS` - `{ id, label }` in display order; `type TourHost` is the id.
- `isTourHost(value)` - a type guard for stored or external values.
- `hostSteps(host)` - the host's numbered steps, the last one pointing at the
  link step. The own server's names the two headers a browser needs
  (`Access-Control-Allow-Origin: *`, `Accept-Ranges: bytes`; the site's
  `/api` proxy fronts Google Drive only) and that its link can be pasted
  before the file exists.
- `needsStarterZip(host)` - every cloud host needs a file before it gives a
  link; an own server does not.
- `readTourHost(store)` / `writeTourHost(store, host)` - the choice under
  `tour-viewer.wizard.host`.

## Invariants & assumptions

- The copy is provisional and kept in this module on purpose: the owner's
  verdict on the design prototypes (M1) may restyle it, and one place to
  change it is the point.
- Defensive: a missing store, one that throws (site data blocked) or an
  unknown stored value reads as no choice; a throwing write is ignored (the
  choice then lasts the page).

## Tests

`tour-host.test.ts` - the host list and order, the steps of each, the own
server's headers, the starter-zip rule, the stored round trip, unknown
values and throwing stores.
