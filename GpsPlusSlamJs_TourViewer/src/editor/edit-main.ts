/**
 * The desktop editor's page (`/tour/edit.html`, M6 E1): the composition
 * root. Opens a tour (a file chosen or dropped, or the sample), draws it
 * in the chosen variant 1 layout (full map, the left rail, the card beside
 * the selected marker), read-only until E2. Linked from nothing yet.
 *
 * @see edit-main.ts.md
 */

import "./editor.css";
import { createTourViewerStore } from "../tour-viewer-session.js";
import { describeIntegrityError } from "../open-errors.js";
import type { TourSession } from "../tour-session.js";
import { createEditorCard } from "./editor-card.js";
import { createEditorMap } from "./editor-map.js";
import {
  buildEditorModel,
  photoSource,
  type EditorModel,
} from "./editor-model.js";
import { openTourForEditing } from "./editor-open.js";
import { createEditorRail } from "./editor-rail.js";
import { revealPadding, type Box } from "./popover-place.js";

/** The committed sample tour (`public/samples/`), beside this page. */
const SAMPLE_URL = "samples/marienplatz-tour.zip";
const SAMPLE_NAME = "marienplatz-tour.zip";

/** The gap between the panels and the window's edges (`--gap`). */
const EDGE_PX = 12;
/** Below this width the rail starts folded (the prototype's 760 px). */
const NARROW_PX = 760;

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`edit.html lacks #${id}`);
  return found as T;
}

// The library's licence: its geo maths runs once a store exists.
createTourViewerStore();

const modal = element("open-modal");
const drop = element("drop");
const zipInput = element<HTMLInputElement>("zip-input");
const openStatus = element("open-status");
const openError = element("open-error");
const sampleButton = element<HTMLButtonElement>("sample-btn");
const cancelButton = element<HTMLButtonElement>("open-cancel");
const topbar = element("topbar");
const toasts = element("toasts");

let session: TourSession | null = null;
let model: EditorModel | null = null;
let selected: string | null = null;
let busy = false;

/** "2 codes, 3 notes" - and the stations when the story has any. */
function openedSummary(opened: EditorModel): string {
  const n = (count: number, one: string, many: string): string =>
    `${String(count)} ${count === 1 ? one : many}`;
  const { code, pin, photo, station } = opened.counts;
  return [
    n(code, "code", "codes"),
    n(pin + photo, "note", "notes"),
    ...(station === 0 ? [] : [n(station, "station", "stations")]),
  ].join(", ");
}

function toast(text: string): void {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = text;
  toasts.append(t);
  setTimeout(() => {
    t.remove();
  }, 4000);
}

/** The free part of the window: right of the rail, under the top bar
 *  (read from the bar itself, so the CSS stays the one source). */
function freeArea(): Box {
  const bar = topbar.hidden ? 0 : topbar.getBoundingClientRect().bottom;
  return {
    left: rail.right() + EDGE_PX,
    top: bar + EDGE_PX,
    right: window.innerWidth - EDGE_PX,
    bottom: window.innerHeight - EDGE_PX,
  };
}

function reveal(id: string): void {
  const free = freeArea();
  map.reveal(
    id,
    revealPadding(
      { width: window.innerWidth, height: window.innerHeight },
      free,
    ),
  );
}

function placeCard(): void {
  if (selected === null) return;
  card.place(map.anchorOf(selected), freeArea());
}

function select(id: string | null, pan = false): void {
  selected = id;
  map.select(id);
  rail.select(id);
  const item = model?.items.find((i) => i.id === id) ?? null;
  if (item === null) {
    card.hide();
    return;
  }
  card.show(item);
  if (pan) reveal(item.id);
  placeCard();
}

const map = createEditorMap(element("map"), {
  onSelect: (id) => {
    select(id);
  },
  onHover: (id, on) => {
    map.hover(id, on);
    rail.hover(id, on);
  },
  onBackground: () => {
    select(null);
  },
  onView: placeCard,
});

const rail = createEditorRail(
  {
    rail: element("rail"),
    body: element("rail-body"),
    mini: element("rail-mini"),
    filter: element<HTMLInputElement>("filter"),
    collapse: element<HTMLButtonElement>("collapse-btn"),
    collapseIcon: document.getElementById(
      "collapse-icon",
    ) as unknown as SVGPathElement,
  },
  {
    onSelect: (id) => {
      select(id, true);
    },
    onHover: (id, on) => {
      map.hover(id, on);
      rail.hover(id, on);
    },
    onResize: placeCard,
  },
);

const card = createEditorCard(
  {
    card: element("card"),
    inner: element("card-inner"),
    arrow:
      element("card").querySelector<HTMLElement>(".arrow") ?? element("card"),
    chip: element("offscreen-chip"),
    chipText: element("offscreen-text"),
    chipShow: element<HTMLButtonElement>("offscreen-show"),
  },
  {
    loadImage: (item) => {
      const open = session;
      const source = photoSource(item);
      if (open === null || source === null) {
        return Promise.reject(new Error("no tour is open"));
      }
      return source.kind === "content"
        ? open.loadContentEntry(source.path)
        : open.loadEntry(source.path);
    },
    onClose: () => {
      select(null);
    },
    onReveal: () => {
      if (selected !== null) reveal(selected);
    },
  },
);

function showModal(on: boolean): void {
  modal.hidden = !on;
  // Cancel returns to the open tour; with none there is nothing to return to.
  cancelButton.hidden = session === null;
  if (on) openError.hidden = true;
}

window.addEventListener("resize", placeCard);
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (!modal.hidden && session !== null && !busy) showModal(false);
  else select(null);
});

function setBusy(on: boolean, text: string): void {
  busy = on;
  sampleButton.disabled = on;
  zipInput.disabled = on;
  cancelButton.disabled = on;
  openStatus.textContent = text;
}

/** The tour is gone (a late integrity failure): nothing of it stays on
 *  screen, and the dialog says why. */
function dropTour(reason: string): void {
  select(null);
  const open = session;
  session = null;
  model = null;
  void open?.close().catch(() => undefined);
  topbar.hidden = true;
  element("rail").hidden = true;
  showModal(true);
  openError.textContent = reason;
  openError.hidden = false;
}

async function openFile(file: File): Promise<void> {
  if (busy) return;
  openError.hidden = true;
  setBusy(true, `Opening ${file.name}…`);
  // The open tour stays until the new one has opened: a refused file must
  // not cost the creator the tour they had (E1 review #4).
  const outcome = await openTourForEditing(file, {
    onIntegrityFailure: (err, failed) => {
      if (failed === session) dropTour(describeIntegrityError(err));
    },
  });
  setBusy(false, "");
  if (outcome.kind === "refused") {
    openError.textContent = outcome.reason;
    openError.hidden = false;
    return;
  }
  // A failure the background check latched before the tour was ours
  // (E1 review #6).
  const latched = outcome.session.integrityFailure();
  if (latched !== null) {
    await outcome.session.close().catch(() => undefined);
    openError.textContent = describeIntegrityError(latched);
    openError.hidden = false;
    return;
  }
  select(null);
  const previous = session;
  session = outcome.session;
  void previous?.close().catch(() => undefined);
  model = buildEditorModel({
    manifest: outcome.manifest,
    levels: outcome.levels,
    fileName: outcome.fileName,
  });
  element("tour-name").textContent = model.title;
  element("tour-file").textContent = outcome.fileName;
  topbar.hidden = false;
  showModal(false);
  rail.render(model);
  // A narrow window starts with the rail folded, as the prototype does.
  if (window.innerWidth < NARROW_PX) rail.collapse(true);
  const free = freeArea();
  map.show(model, { left: free.left, top: free.top });
  toast(`Opened ${outcome.fileName}: ${openedSummary(model)}`);
}

zipInput.addEventListener("change", () => {
  const file = zipInput.files?.[0];
  zipInput.value = "";
  if (file !== undefined) void openFile(file);
});
drop.addEventListener("dragover", (event) => {
  event.preventDefault();
  drop.classList.add("over");
});
drop.addEventListener("dragleave", () => {
  drop.classList.remove("over");
});
drop.addEventListener("drop", (event) => {
  event.preventDefault();
  drop.classList.remove("over");
  const file = event.dataTransfer?.files[0];
  if (file !== undefined) void openFile(file);
});
sampleButton.addEventListener("click", () => {
  if (busy) return;
  openError.hidden = true;
  setBusy(true, "Fetching the sample tour…");
  fetch(SAMPLE_URL)
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`the sample answered ${String(response.status)}`);
      }
      const blob = await response.blob();
      setBusy(false, "");
      await openFile(
        new File([blob], SAMPLE_NAME, { type: "application/zip" }),
      );
    })
    .catch((err: unknown) => {
      setBusy(false, "");
      openError.textContent = `The sample tour could not be fetched: ${
        err instanceof Error ? err.message : String(err)
      }`;
      openError.hidden = false;
    });
});
cancelButton.addEventListener("click", () => {
  showModal(false);
});
element<HTMLButtonElement>("open-another").addEventListener("click", () => {
  showModal(true);
});
