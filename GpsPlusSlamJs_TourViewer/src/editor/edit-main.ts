/**
 * The desktop editor's page (`/tour/edit.html`, M6 E1, E2a): the
 * composition root. Opens a tour (a file chosen or dropped, or the
 * sample), draws it in the chosen variant 1 layout (full map, the left
 * rail, the card beside the selected marker), and edits it: a pin's text,
 * Move and Delete with Undo, and a Save that downloads the tour to put in
 * place of the old file. Linked from nothing yet.
 *
 * @see edit-main.ts.md
 */

import "./editor.css";
import { downloadZip } from "gps-plus-slam-app-framework/storage";
import { FINISH_LABELS } from "../qr-author-mode.js";
import { createTourViewerStore } from "../tour-viewer-session.js";
import { describeIntegrityError } from "../open-errors.js";
import { scanEntryNames } from "../tour-read-set.js";
import type { TourSession } from "../tour-session.js";
import {
  CARD_RESIZED,
  createEditorCard,
  type CardView,
} from "./editor-card.js";
import { createEditorMap } from "./editor-map.js";
import {
  photoSource,
  type EditorItem,
  type EditorModel,
} from "./editor-model.js";
import { openTourForEditing } from "./editor-open.js";
import { createEditorRail } from "./editor-rail.js";
import {
  createEditorSession,
  type EditorSave,
  type EditorSession,
} from "./editor-session.js";
import { revealPadding, type Box } from "./popover-place.js";

/** The committed sample tour (`public/samples/`), beside this page. */
const SAMPLE_URL = "samples/marienplatz-tour.zip";
const SAMPLE_NAME = "marienplatz-tour.zip";

/** The gap between the panels and the window's edges (`--gap`). */
const EDGE_PX = 12;
/** Below this width the rail starts folded (the prototype's 760 px). */
const NARROW_PX = 760;
/** An undo tapped after a save already wrote the delete (E2b plan
 *  review #2). The page ends an undo when a save starts, so this is the
 *  defensive answer, not an expected path. */
const UNDO_TOO_LATE =
  "That delete is already in the saved file - it cannot be undone here.";

/** How long a delete can be undone - the phone's hold (`object-editing.ts`
 *  `OUTCOME_HOLD_MS`). A Save ends it sooner: the saved file no longer
 *  carries the object. */
const UNDO_MS = 8000;

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
const saveButton = element<HTMLButtonElement>("save-btn");
const saveStatus = element("save-status");
const keepWalk = element("keep-walk");
const keepWalkInput = element<HTMLInputElement>("keep-walk-input");

let session: TourSession | null = null;
let editor: EditorSession | null = null;
let model: EditorModel | null = null;
let selected: string | null = null;
let busy = false;
let saving = false;
/** A save the browser did not deliver (the picker dismissed, a failed
 *  download): Save offers it again before anything else. */
let undelivered: EditorSave | null = null;
/** The marker being dragged, and where it was dropped so far. */
let moving: { id: string; drop: { lat: number; lng: number } | null } | null =
  null;
/** Notes moved since the last save: their card says the height was kept. */
const moved = new Set<string>();
/** The card's last outcome line, for the item it was said about. */
let message: { id: string; text: string; refused?: true } | null = null;
/** The open delete's Undo, until it times out or a Save starts. */
let undoOffer: { run: () => void; toast: HTMLElement; timer: number } | null =
  null;

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

/**
 * A toast. `holdMs` is how long it stays; `null` keeps it until the
 * creator closes it - the save's result, an instruction they have to act
 * on, which an 8 s hold tuned for an Undo took away (PR #611 review).
 */
function toast(
  text: string,
  action?: { label: string; run: () => void },
  holdMs: number | null = UNDO_MS,
): HTMLElement {
  const t = document.createElement("div");
  t.className = "toast";
  const words = document.createElement("span");
  words.textContent = text;
  t.append(words);
  if (action !== undefined) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn small";
    b.textContent = action.label;
    b.addEventListener("click", action.run);
    t.append(b);
  }
  if (holdMs === null) {
    const close = document.createElement("button");
    close.type = "button";
    close.className = "btn small";
    close.textContent = "Close";
    close.addEventListener("click", () => {
      t.remove();
    });
    t.append(close);
  } else {
    setTimeout(() => {
      t.remove();
    }, holdMs);
  }
  toasts.append(t);
  return t;
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
  map.reveal(
    id,
    revealPadding(
      { width: window.innerWidth, height: window.innerHeight },
      freeArea(),
    ),
  );
}

function placeCard(): void {
  if (selected === null) return;
  card.place(map.anchorOf(selected), freeArea());
}

/** A pin or photo of the tour can be edited; codes, stations and the
 *  walk's recorded photos cannot (yet). */
function editable(item: EditorItem): boolean {
  return (
    (item.kind === "pin" || item.kind === "photo") && item.recorded !== true
  );
}

function viewOf(item: EditorItem): CardView {
  return {
    editable: editable(item),
    moving: moving?.id === item.id,
    moved: moved.has(item.id),
    message: message?.id === item.id ? message.text : "",
  };
}

function showCard(): void {
  const item = model?.items.find((i) => i.id === selected) ?? null;
  if (item === null) {
    card.hide();
    return;
  }
  card.show(item, viewOf(item));
  placeCard();
}

function select(id: string | null, pan = false): void {
  // Typing in the card's field is committed before it shows something else.
  if (id !== selected) {
    card.commit();
    // What was typed was refused, and the card is about to show something
    // else: the refusal goes to a toast, never silently away (PR #611
    // review).
    if (message?.refused === true && message.id === selected) {
      toast(message.text);
    }
  }
  if (moving !== null && moving.id !== id) cancelMove();
  selected = id;
  message = null;
  map.select(id);
  rail.select(id);
  showCard();
  if (pan && id !== null) {
    reveal(id);
    placeCard();
  }
}

function renderSaveState(): void {
  const count = editor?.changeCount() ?? 0;
  if (saving) {
    saveStatus.dataset["state"] = "saving";
    saveStatus.textContent = "Saving…";
    saveButton.disabled = true;
    return;
  }
  // On whenever a tour is open: a click commits the card's typing first,
  // so a disabled button would swallow the first edit (E2a review #3).
  saveButton.disabled = editor === null;
  if (undelivered !== null && count === 0) {
    saveStatus.dataset["state"] = "error";
    saveStatus.textContent = "Not saved yet - tap Save again";
    return;
  }
  if (count === 0) {
    saveStatus.dataset["state"] = "clean";
    saveStatus.textContent = saveStatus.dataset["saved"] ?? "No changes";
    return;
  }
  saveStatus.dataset["state"] = "pending";
  saveStatus.textContent = `${String(count)} ${count === 1 ? "change" : "changes"} not saved`;
}

/** After an edit: the rail, the markers, the card and the status follow. */
function refresh(): void {
  if (editor === null) return;
  model = editor.model();
  rail.update(model);
  map.update(model);
  if (selected !== null && !model.items.some((i) => i.id === selected)) {
    selected = null;
  }
  map.select(selected);
  rail.select(selected);
  showCard();
  renderSaveState();
}

function endUndo(): void {
  if (undoOffer === null) return;
  clearTimeout(undoOffer.timer);
  undoOffer.toast.remove();
  undoOffer = null;
}

function startMove(id: string): void {
  moving = { id, drop: null };
  map.drag(id, (lat, lng) => {
    if (moving?.id === id) moving.drop = { lat, lng };
  });
  showCard();
}

function finishMove(): void {
  const done = moving;
  if (done === null || editor === null) return;
  map.drag(done.id, null);
  moving = null;
  if (done.drop !== null) {
    try {
      editor.move(done.id, done.drop.lat, done.drop.lng);
      moved.add(done.id);
      message = { id: done.id, text: "Moved - not saved yet." };
    } catch (err) {
      message = {
        id: done.id,
        text: `It cannot go there: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
  refresh();
}

function cancelMove(): void {
  const done = moving;
  if (done === null) return;
  map.drag(done.id, null);
  moving = null;
  // Redrawn from the model: the marker goes back to where it was.
  refresh();
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
    if (moving === null) select(null);
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
    onText: (id, text) => {
      if (editor === null) return;
      const outcome = editor.editText(id, text);
      message =
        outcome.kind === "refused"
          ? { id, text: outcome.reason, refused: true }
          : outcome.kind === "edited"
            ? { id, text: "Changed - not saved yet." }
            : null;
      // In place: the click that blurred the field must still land on the
      // button or row under the pointer (E2a review #3).
      model = editor.model();
      rail.update(model);
      map.update(model);
      card.note(message?.text ?? "");
      renderSaveState();
    },
    onMove: startMove,
    onMoveDone: finishMove,
    onMoveCancel: cancelMove,
    onDelete: (id) => {
      if (editor === null) return;
      const item = model?.items.find((i) => i.id === id);
      const undo = editor.remove(id);
      endUndo();
      select(null);
      refresh();
      const t = toast(`Deleted ${item?.title ?? "the note"}`, {
        label: "Undo",
        run: () => {
          endUndo();
          // Refused once a save wrote the delete: said, never a dead tap.
          if (!undo()) toast(UNDO_TOO_LATE);
          refresh();
        },
      });
      undoOffer = {
        run: undo,
        toast: t,
        timer: window.setTimeout(endUndo, UNDO_MS),
      };
    },
  },
);

function showModal(on: boolean): void {
  modal.hidden = !on;
  // Cancel returns to the open tour; with none there is nothing to return to.
  cancelButton.hidden = session === null;
  if (on) openError.hidden = true;
}

/** Leaving would lose edits: changes not saved, or a save not delivered. */
function unsavedWork(): boolean {
  return (
    saving ||
    undelivered !== null ||
    card.dirty() ||
    (editor?.changeCount() ?? 0) > 0
  );
}

window.addEventListener("resize", placeCard);
element("card").addEventListener(CARD_RESIZED, placeCard);
window.addEventListener("beforeunload", (event) => {
  if (unsavedWork()) event.preventDefault();
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (moving !== null) {
    cancelMove();
    return;
  }
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

function resetEditing(): void {
  endUndo();
  moving = null;
  moved.clear();
  message = null;
  undelivered = null;
  delete saveStatus.dataset["saved"];
}

/** The tour is gone (a late integrity failure): nothing of it stays on
 *  screen, and the dialog says why. */
function dropTour(reason: string): void {
  select(null);
  const open = session;
  session = null;
  editor = null;
  model = null;
  resetEditing();
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
  resetEditing();
  editor = createEditorSession({
    session: outcome.session,
    manifest: outcome.manifest,
    levels: outcome.levels,
    fileName: outcome.fileName,
  });
  model = editor.model();
  // The walk-recording switch only for a tour that carries one (S-D10:
  // the saved copy leaves it out unless asked, E2 plan review #4).
  keepWalkInput.checked = false;
  keepWalk.hidden =
    scanEntryNames(
      outcome.session.entries.map((e) => e.filename),
      outcome.manifest,
      outcome.session.manifestWrap,
    ).length === 0;
  element("tour-name").textContent = model.title;
  element("tour-file").textContent = outcome.fileName;
  topbar.hidden = false;
  showModal(false);
  rail.render(model);
  // A narrow window starts with the rail folded, as the prototype does.
  if (window.innerWidth < NARROW_PX) rail.collapse(true);
  const free = freeArea();
  map.show(model, { left: free.left, top: free.top });
  renderSaveState();
  toast(`Opened ${outcome.fileName}: ${openedSummary(model)}`);
}

/** Hand `save` to the browser; whether it arrived. */
async function deliver(save: EditorSave): Promise<boolean> {
  try {
    return await downloadZip(save.blob, save.filename);
  } catch {
    return false;
  }
}

/** A save whose tour was closed meanwhile ends quietly; the open tour's
 *  page shows its own state. */
function abandon(): void {
  saving = false;
  renderSaveState();
}

async function runSave(): Promise<void> {
  if (editor === null || saving) return;
  card.commit();
  if (moving !== null) finishMove();
  if (editor.changeCount() === 0 && undelivered === null) {
    saveStatus.dataset["state"] = "clean";
    saveStatus.textContent = "Nothing to save";
    return;
  }
  // A save belongs to the tour it started on: one opened meanwhile must not
  // receive it (E2a review #5).
  const mine = editor;
  // The saved file will not carry a deleted object any more: its Undo ends.
  endUndo();
  saving = true;
  renderSaveState();
  try {
    const save =
      undelivered !== null && mine.changeCount() === 0
        ? undelivered
        : await mine.save({ keepScan: keepWalkInput.checked });
    if (editor !== mine) {
      abandon();
      return;
    }
    // A later save rebuilds from this one's bytes, so the walk switch can
    // no longer change anything (the phone's rule, E2a review #1).
    keepWalk.hidden = true;
    const arrived = await deliver(save);
    if (editor !== mine) {
      abandon();
      return;
    }
    undelivered = arrived ? null : save;
    if (arrived) {
      // A move made during the save is still pending: its line stays.
      const pending = new Set(mine.pendingIds());
      for (const id of [...moved]) if (!pending.has(id)) moved.delete(id);
      message = null;
      saveStatus.dataset["saved"] = `Saved as ${save.filename}`;
      // The Finish's own result sentences (E2a review #2).
      toast(
        [
          `Saved as ${save.filename}. Put it in place of the old file, under the same name, so the printed codes keep opening it.`,
          ...(save.scanLeftOut.length === 0
            ? []
            : [FINISH_LABELS.scanLeftOut(save.scanLeftOut.length)]),
          ...(save.notPlaced === undefined
            ? []
            : [FINISH_LABELS.photosNotPlaced(save.notPlaced)]),
        ].join(" "),
        undefined,
        null,
      );
    }
  } catch (err) {
    if (editor !== mine) {
      abandon();
      return;
    }
    saving = false;
    renderSaveState();
    saveStatus.dataset["state"] = "error";
    saveStatus.textContent = `Not saved: ${err instanceof Error ? err.message : String(err)}`;
    saveButton.disabled = false;
    return;
  }
  saving = false;
  refresh();
}

saveButton.addEventListener("click", () => {
  void runSave();
});
zipInput.addEventListener("change", () => {
  const file = zipInput.files?.[0];
  zipInput.value = "";
  if (file !== undefined) void openFile(file);
});
// A file dropped anywhere else on the page would make the browser open
// it, and the open tour would be gone (PR #609 review): only #drop opens.
for (const type of ["dragover", "drop"] as const) {
  document.addEventListener(type, (event) => {
    event.preventDefault();
  });
}
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
  // The same guard as leaving the page (`main.ts`'s rule for switching
  // tours, E2 plan review #12).
  if (
    unsavedWork() &&
    !window.confirm(
      "Your changes are not saved yet. Open another tour anyway? They will be lost.",
    )
  ) {
    return;
  }
  showModal(true);
});
