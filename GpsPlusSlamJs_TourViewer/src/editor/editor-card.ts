/**
 * The desktop editor's card beside the selected marker (M6 E1, the chosen
 * variant 1's popover), read-only until E2: what the object is, its text,
 * a photo from the zip, how precise its position is, and the arrow that
 * points at its marker; the "off the map view" chip when the marker
 * leaves the view. Every text is set with `textContent`; a photo is
 * checked by `image-cap.ts` before it is decoded on screen, and its
 * object URL is revoked when the card closes or shows something else
 * (M6 E1 plan review #2).
 *
 * @see editor-card.ts.md
 */

import { pictureProblem } from "../image-cap.js";
import type { EditorItem } from "./editor-model.js";
import { placePopover, type Box } from "./popover-place.js";

/** R7's precision, both figures (M6 E1 plan review #10). */
export const PRECISION_LINE =
  "Placed from GPS alignment: about 0.1-0.7 m near a code, 1-3 m further away.";

const CODE_LINE =
  "Measured on site by the phone. To move a printed code, measure it again there.";

const STATION_LINE =
  "A station of the story: visitors reach it here. Its steps are edited in a later version.";

const RECORDED_LINE =
  "Recorded on the walk and placed for visitors when the tour was finished.";

export interface EditorCardDom {
  readonly card: HTMLElement;
  readonly inner: HTMLElement;
  readonly arrow: HTMLElement;
  readonly chip: HTMLElement;
  readonly chipText: HTMLElement;
  readonly chipShow: HTMLButtonElement;
}

export interface EditorCard {
  show(item: EditorItem): void;
  hide(): void;
  /** Follow the marker: `anchor` its ground point in window pixels (null
   *  without one), `free` the window's free part. */
  place(anchor: { x: number; y: number } | null, free: Box): void;
  /** The item shown, or null. */
  shown(): EditorItem | null;
}

function kindLabel(item: EditorItem): string {
  if (item.kind === "code") return item.title;
  if (item.kind === "station") return "Station";
  if (item.recorded === true) return "Recorded photo";
  return item.kind === "photo" ? "Photo note" : "Pin note";
}

export function createEditorCard(
  dom: EditorCardDom,
  deps: {
    /** A photo's bytes from the open tour (`TourSession.loadContentEntry`
     *  for a placed photo, `loadEntry` for a recorded one). */
    readonly loadImage: (item: EditorItem) => Promise<Blob>;
    readonly onClose: () => void;
    readonly onReveal: () => void;
  },
): EditorCard {
  let current: EditorItem | null = null;
  let objectUrl: string | null = null;
  /** Bumped on every show and hide: a photo read that lands for an item
   *  no longer shown is dropped. */
  let generation = 0;

  function freeUrl(): void {
    if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }

  function line(text: string, error = false): HTMLElement {
    const p = document.createElement("p");
    p.className = error ? "note-line error" : "note-line";
    p.textContent = text;
    return p;
  }

  function loadPhoto(item: EditorItem, into: HTMLElement): void {
    const mine = generation;
    const status = line("Loading the photo…");
    into.append(status);
    deps
      .loadImage(item)
      .then(async (blob) => {
        const problem = await pictureProblem(blob);
        if (mine !== generation) return;
        if (problem !== null) {
          status.replaceWith(line(`This photo is not shown: ${problem}`, true));
          return;
        }
        freeUrl();
        objectUrl = URL.createObjectURL(blob);
        const img = document.createElement("img");
        img.className = "card-photo";
        img.alt = item.title;
        img.src = objectUrl;
        status.replaceWith(img);
      })
      .catch((err: unknown) => {
        if (mine !== generation) return;
        status.replaceWith(
          line(
            `This photo cannot be read: ${
              err instanceof Error ? err.message : String(err)
            }. If the file changed on disk, open it again.`,
            true,
          ),
        );
      });
  }

  dom.chipShow.addEventListener("click", () => {
    deps.onReveal();
  });

  return {
    show(item) {
      generation += 1;
      freeUrl();
      current = item;
      const head = document.createElement("div");
      head.className = "card-head";
      const chip = document.createElement("span");
      chip.className = "kind-chip";
      chip.textContent = kindLabel(item);
      const close = document.createElement("button");
      close.type = "button";
      close.className = "btn ghost icon-btn";
      close.setAttribute("aria-label", "Close");
      close.textContent = "×";
      close.addEventListener("click", () => {
        deps.onClose();
      });
      head.append(chip, close);
      const body: HTMLElement[] = [head];
      if (item.kind === "photo" && item.image !== undefined) {
        const holder = document.createElement("div");
        body.push(holder);
        loadPhoto(item, holder);
      }
      if (item.kind !== "code") {
        const text = document.createElement("p");
        text.className = "card-text";
        text.textContent = item.title;
        body.push(text);
      }
      body.push(
        line(
          item.kind === "code"
            ? CODE_LINE
            : item.kind === "station"
              ? STATION_LINE
              : item.recorded === true
                ? RECORDED_LINE
                : PRECISION_LINE,
        ),
        line(item.meta),
      );
      const foot = document.createElement("div");
      foot.className = "card-foot";
      const key = document.createElement("kbd");
      key.textContent = "Esc";
      foot.append(key, " close");
      body.push(foot);
      dom.inner.replaceChildren(...body);
      dom.card.hidden = false;
    },
    hide() {
      generation += 1;
      freeUrl();
      current = null;
      dom.card.hidden = true;
      dom.chip.hidden = true;
      dom.inner.replaceChildren();
    },
    place(anchor, free) {
      if (current === null) return;
      // Measured while shown: a hidden card has no size.
      dom.card.hidden = false;
      const placement =
        anchor === null
          ? ({ visible: false } as const)
          : placePopover({
              anchor,
              // A note's bubble centre sits 24 px above its tip (the
              // marker's 41 px anchor, `editor-map.ts`); a code is centred.
              lift:
                current.kind === "code" || current.kind === "station" ? 0 : 24,
              gap:
                current.kind === "code" || current.kind === "station" ? 26 : 30,
              size: {
                width: dom.card.offsetWidth,
                height: dom.card.offsetHeight,
              },
              free,
            });
      if (!placement.visible) {
        dom.card.hidden = true;
        const title = current.title;
        dom.chipText.textContent = `${
          title.length > 40 ? `${title.slice(0, 40)}…` : title
        } is off the map view`;
        dom.chip.hidden = false;
        return;
      }
      dom.chip.hidden = true;
      dom.card.hidden = false;
      dom.card.style.left = `${String(placement.x)}px`;
      dom.card.style.top = `${String(placement.y)}px`;
      dom.card.dataset["side"] = placement.side;
      if (placement.side === "below") {
        dom.arrow.style.top = "";
        dom.arrow.style.left = `${String(placement.arrow)}px`;
      } else {
        dom.arrow.style.left = "";
        dom.arrow.style.top = `${String(placement.arrow)}px`;
      }
    },
    shown() {
      return current;
    },
  };
}
