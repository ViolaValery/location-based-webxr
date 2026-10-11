# qr-print-pdf.ts

## Purpose

A printable PDF of one or more numbered QR codes, written by hand - no PDF
library, because production code here ships no third-party libraries.

## Why a PDF, when the page can already print itself

The browser's print dialog owns the paper size, the margins and a
"fit to page" toggle that silently rescales. A rescaled code is one whose
printed side no longer matches the number the pose solve was given, and
nothing about that fails loudly: the code still scans, the tour is just
placed wrong. A PDF declares its own `MediaBox` and draws at absolute
coordinates, so the only way to get the size wrong is to tell the printer
to scale it.

It is also what makes SEVERAL numbered codes in one file possible, which
is the actual request (second testing session, §4).

## Why writing it by hand costs less than it sounds

A QR code is a grid of black squares, so a page is a few hundred vector
rectangles - a content stream of `re f` operators. No image encoding, no
compression, no font embedding (the caption uses base-14 Helvetica). The
result prints at the printer's own resolution instead of a bitmap's, which
is the property that matters for something a camera has to measure.

## Public API

- `planPrintPdf(count, options): PrintPdfPlan` - the geometry, as a pure
  function. Returns the paper, the symbol side in mm, the quiet-zone block
  in mm, the grid a page holds (`columns`, `rows`, `perPage`), one list
  of placements per page, and the check bar (`checkBar`: its left end,
  the bottom of its band, its 100 mm length, the band's height).
  Placements are in mm from the page's BOTTOM-left, which is PDF's own
  origin, so the writer does no flipping.
  - **Throws `RangeError`** when the size does not fit the paper, naming
    the size that would - the largest whole millimetre the SAME fit test
    accepts, so the suggestion is never itself refused.
  - Throws for a non-whole or non-positive count, and for a non-finite or
    non-positive side.
- `buildQrPrintPdf(codes, options): Uint8Array` - the file. Each code is
  `{ size, modules, caption }`, `modules` being a row-major `size * size`
  array of dark flags (any non-zero is dark - `QRCode.create(...).modules`
  hands exactly this over).
- `PAPER_SIZES_MM` (`a4`, `letter`), `type PaperSize`.
- `PrintPdfOptions`: `paper`, `sideM` (required), `marginMm`,
  `quietFraction`, `captionMm`, `gapMm`.

## Invariants & assumptions

- **The side length is the SYMBOL**, not the printed block: the dark module
  area WITHOUT the quiet zone, exactly as `qr-print-plan.ts` defines it.
  The quiet zone is drawn around it as white space, so what a ruler
  measures across the dark modules is the number the author typed.
- **The quiet zone is `QR_QUIET_ZONE_FRACTION` of the side on each edge**,
  IMPORTED from `qr-quiet-zone.ts` rather than restated, and the same value
  a repo-config test holds the Tour Viewer's on-page print stylesheet to.
  Two printing paths that disagreed about the quiet zone would turn one
  declared size into two different physical artefacts - which was the state
  of the code until r665, prevented only by nobody having edited one copy.
- **The margin is 6 mm, for INK, and deliberately not zero.** Most
  consumer printers have an unprintable border of 3-5 mm, and content
  inside it is silently clipped - which for a QR code means it does not
  decode at all. The symbol, its caption (at the symbol's left edge) and the
  check bar stay inside it; the white quiet-zone box only has to be on the
  sheet, because it is blank paper (polish round M0b, the owner's "as large
  as possible, as little margin as possible"). That is what fits an 18 cm
  code on A4 (208.8 mm with its quiet zone, on a 210 mm sheet); the A4
  ceiling is 18.1 cm.
- **One fit test** (`gridFor`) decides the grid, the refusal and
  `maxPrintablePdfSideM`, so the three cannot disagree.
- **A grid per page** (A11): as many columns as fit across, as many rows
  as fit above the check bar, centred across and top-anchored; the last
  page holds the rest.
- **Every page carries a 10 cm check bar** (a bar with a tick per
  centimetre and a line saying to print again at 100 % if it measures
  anything else), and the catalog asks the viewer not to scale
  (`/ViewerPreferences << /PrintScaling /None >>`) - a request a print
  dialog may ignore, which is why the bar is there (A10).
- **Rows are drawn as merged horizontal RUNS.** A version-25 symbol is
  117x117, i.e. up to 13 689 separate rectangles per code; merging each
  row's consecutive dark modules typically cuts that several-fold.
- **Rectangles overlap by 2 % vertically.** An exact seam between rows can
  render as a white hairline on some rasterisers, and a hairline through a
  finder pattern is a scan failure.
- **The matrix's row 0 is the TOP row**, and PDF's y grows upward; the
  writer inverts. A mirrored code still looks like a QR code and decodes to
  nothing, so this is pinned directly.
- **xref offsets are measured from encoded BYTES**, not string lengths. The
  two agree only while every byte is ASCII, and relying on that silently is
  how the file breaks the first time a caption is not.
- **Captions are stripped to printable ASCII** and the three PDF-string
  characters are escaped. The base-14 fonts are single-byte WinAnsi, and a
  stray multi-byte character would render as mojibake rather than fail.
- At 16 cm a page holds one code; at 8 cm four; at 5 cm a dozen or more.

## Examples

```ts
import QRCode from 'qrcode';
const q = QRCode.create(launchUrl, { errorCorrectionLevel: 'Q' });
const pdf = buildQrPrintPdf(
  [{ size: q.modules.size, modules: q.modules.data, caption: 'Code 1' }],
  { sideM: 0.16, paper: 'a4' }
);
```

## Tests

`qr-print-pdf.test.ts`. The two that carry the file:

- **"keeps all ink inside the margin and every quiet zone on the paper"**
  (property, over counts, sizes up to 19 cm and both papers) - ink inside
  the unprintable border comes back clipped; the property also holds the
  captions above the check bar and keeps any two codes apart.
- **"reproduces a real QR matrix module for module"** (property) - the
  drawn content stream is re-sampled back onto the module grid and compared
  to the source matrix. Everything the drawing can get wrong (a transpose,
  a vertical mirror, an off-by-one in the run merge, a step that drifts
  across 117 modules) produces a file that still parses and still looks
  like a QR code. There is no PDF renderer in this suite, so the drawing is
  read back instead.

Plus: the xref offsets re-derived from the produced bytes, the MediaBox and
page count, a counted rectangle total (against "parses and is empty"), the
run merging, caption escaping, the matrix orientation, and the refusal
paths - including that the size the refusal SUGGESTS is itself accepted. Since M0b also: the grid packing (five 5 cm codes on one page, four 8 cm
codes), 18 cm on A4 and Letter, the byte-level grid page and odd last page,
the check bar on every page and the no-scaling flag.
