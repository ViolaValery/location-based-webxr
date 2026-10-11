# print-panel.ts

## Purpose

Step 3, "Print your posters": the tour's launch URL as numbered QR codes,
printed by PDF only (polish round M0b). The panel shows one preview tile per
poster, redraws whenever an input changes, continues the open tour's code
numbering, and builds the PDF through the framework's `qr-print-pdf.ts`. On
the page for everyone since the flows plan M3 (DEC-F2); its own module since
M6. Plan: `GpsPlusSlamJs_Docs/docs/2026-10-11-0049-tour-viewer-polish-round-plan.md`
(M0b).

## Why PDF only

The page used to print a code itself (print CSS at 100 % scale), next to
the PDF. The browser's print dialog owns a "fit to page" toggle that
silently rescales, and a rescaled code measures the world wrong without ever
failing - the owner's 16 cm code measured 15.3-15.5 cm (A10). The PDF
declares its own page, packs a grid of codes, carries a 10 cm check bar and
asks the viewer not to scale (`/PrintScaling /None`). So the print button,
the print stylesheet, `--print-side`, the `beforeprint` listener and the
"Generate QR" button are gone; `page-contracts.test.ts` and
`tests/repo-config/qr-quiet-zone-copies.test.js` pin their absence.

## Public API

- `wirePrintPanel({ dom, mode, onLaunchUrl?, downloadPdf?, openPdfTab?, measuredCodeIds?, checkLink? }): PrintPanel`
  - `openPdfTab` (`seams.openPdfTab`) - where the browser shows PDFs
    itself, a tab opened inside the tap, BEFORE any await (a pop-up blocker
    refuses one opened later), filled with the built PDF; the info line
    then says "Opened ...". Null or absent: the PDF is downloaded
    (`downloadPdf`). A failed build closes the empty tab.
  - `PrintPanelDom { panel; urlInput; urlAsk; urlShown; sizeInput; codeInput; info; tiles; urlOut; countInput; paperSelect; pdfButton }`
    - `sizeInput` is SHARED with author mode's mint (one field, two
      consumers): the size a code is printed at is the size it is minted
      with. It is in centimetres, read through `printed-side.ts`.
    - `tiles` - one `<figure class="print-tile">` per poster (up to 12; the
      PDF carries all of them), each a canvas and "Code n". The first tile's
      canvas keeps `data-testid="print-canvas"`, which the e2e decodes.
  - `PrintPanel.presentTour(url, { verified? })` - take the open tour's
    link, swap the field for that link as TEXT, reset the code number to 1
    for the new tour, open the panel and draw. `verified: false` (polish
    round M2, A16) is step 2's hand-off of a link whose file is not there
    yet or that could not be checked offline: the link reads
    "<url> - not verified yet" until a check confirms it.
  - `PrintPanel.presentCodes()` - the open tour's codes arrived
    (`archive-open.ts`, through the `presentTourCodes` hook): the code
    number becomes `nextCodeIndex` of the tour's code ids, unless the
    creator typed a number for this tour meanwhile.
  - `PrintPanel.presentNoTour()` - back to asking for the link, the tiles
    cleared.
  - The optional `checkLink` dep runs before the PDF while the link is
    unverified. The PDF is built either way; `recheckNote` goes in front of
    its info line, and a link that now opens drops its "not verified yet".
- `nextCodeIndex(tourCodeIds, idOfCode, limit?)` - one past the highest
  number whose code the tour holds, 1 for none. A tour files each code under
  a hash of its printed text, so each number's id is computed and looked up,
  every number up to the limit (50); a gap below the highest is not reused.
- `printCountFromInput(raw)` - how many posters the PDF carries:
  `{ count, coerced, clamped }`; caps at `MAX_PRINTED_CODES` (50).
- `printPdfFilename(start, count, sideM)`, `printedCodeCaption(index, sideM)`
  - the file's name and the line under each code (plain ASCII: a PDF
    base-14 font is single-byte).
- `MAX_PRINTED_CODES`; `highestPrintedCode(codeIndex, count)` (a SUM, PR
  #443 review); `orphanScanCovers(codeIndex, count)` (exported because it is
  the claim; when false the orphaning check says nothing, PR #445 review).
- `printUrlDisplay(tourUrl, { verified? })` - which of the two spellings of
  the link shows: `{ askVisible, shownVisible, shownText }`, exactly one
  live.

## Invariants & assumptions

- **A tile canvas is sized by the stylesheet, not by the QR library.** The
  library writes an inline pixel width onto the canvas; inline beats CSS, so
  the canvas set its column's width and step 3 grew past the card on a
  phone (the owner's r819 screenshot). The inline size is removed after
  drawing; `setup-flow.spec.js` checks nothing in step 3 reaches past the
  card at 412 px.
- **Nothing a render rewrites sits above the PDF button.** The info line
  and the tiles come after it: a count typed and the button then tapped
  redraws both, and when they sat above the button they pushed it down
  under the finger (found by the PDF e2e, M0b).
- **Every input redraws** (`change`: the size, the code number, the count,
  the paper, the typed link); nothing is drawn while there is no link.
  Async-UI rule: the info line says "Drawing the codes…" until the tiles
  and the line are written; a failure writes the error there and hides the
  tiles. A render generation keeps a slower, older render from painting
  over a newer one.
- **The info line carries every warning about the artifact**: the range and
  size, the 100 % instruction with the check bar, "too large for A4/Letter:
  up to X fits" (the PDF's ceiling, `maxPrintablePdfSideM`), and the
  measurement-orphaning warning.
- **Each poster gets its OWN payload** - `planPrintCode` with that code's
  index. Two posters carrying the same printed text are ONE code to the
  level lookup, which is also why the numbering continues the tour's.
- **`measuredCodeIds` is read when needed, not captured**: the open tour's
  levels arrive asynchronously after an open. `main.ts` passes the tour's
  codes together with every code this page measured, so a code measured but
  not yet finished counts for the orphaning warning and the numbering.
- **The OPEN TOUR'S link always wins.** `presentTour` assigns it
  unconditionally (since F7 the field is replaced by the link as text while
  a tour is open; typed text is only for the no-tour case).
- The numbering needs Web Crypto (`qrCodeId`); where it is missing (a
  plain-http preview) the number stays where it is.

## Examples

```ts
const print = wirePrintPanel({ dom, mode: "creator", downloadPdf });
print.presentTour("https://www.dropbox.com/.../tour.zip?dl=0");
print.presentCodes(); // when the tour's codes have arrived
```

## Tests

- `print-panel.test.ts` - `printUrlDisplay` (with the unverified spelling),
  the PDF's inputs, the poster range, and `nextCodeIndex` (gaps, no codes,
  the limit).
- `playwright-tests/ar-mode.spec.js` - "the print panel draws one tile per
  poster at the declared size, and prints by PDF only" (the default 18 cm
  and three posters, the too-large line, no print route, the failure path),
  "opening a tour shows the code and the link it carries", and the PDF
  build's async states and numbering; `launch-and-errors.spec.js` - the
  `?qr=` boot; `setup-flow.spec.js` - an unuploaded link reaching the panel
  unverified.
