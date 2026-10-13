/**
 * A HUD chip whose label folds to its icon after its first use (polish
 * round M3, the owner's D-P4 on the H1 strip): remembered per device, and
 * a long press shows the label again.
 *
 * @see folding-label.ts.md
 */

/** A press at least this long unfolds the label instead of acting. */
export const LONG_PRESS_MS = 500;

const KEY_PREFIX = "tour-viewer.hud.folded.";

/** The storage it remembers in (`localStorage`); null: none. */
export interface FoldStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** The chip, structurally (the unit tests pass a plain object). */
export interface FoldingButton {
  dataset: Record<string, string | undefined>;
  setAttribute(name: string, value: string): void;
  addEventListener(
    type: string,
    handler: (event: {
      preventDefault(): void;
      stopImmediatePropagation(): void;
    }) => void,
    options?: { capture?: boolean },
  ): void;
}

/** Storage that throws (a private window, blocked site data) is no
 *  storage: the chip keeps working, unfolded. */
function safely<T>(run: () => T, fallback: T): T {
  try {
    return run();
  } catch {
    return fallback;
  }
}

/**
 * Wire `button` (it carries its icon and a `.chip-label`; CSS hides the
 * label while `data-folded` is set). Must be wired BEFORE the chip's own
 * click handler is bound: the long press's click is swallowed in the
 * capture phase.
 */
export function wireFoldingLabel(deps: {
  button: FoldingButton;
  key: string;
  label: string;
  store: FoldStore | null;
  now: () => number;
}): void {
  const { button, store } = deps;
  const key = KEY_PREFIX + deps.key;
  button.setAttribute("aria-label", deps.label);

  function show(folded: boolean): void {
    if (folded) button.dataset["folded"] = "true";
    else delete button.dataset["folded"];
  }
  show(safely(() => store?.getItem(key) === "1", false));

  let pressedAt: number | null = null;
  let longPress = false;
  button.addEventListener("pointerdown", () => {
    pressedAt = deps.now();
  });
  button.addEventListener("pointerup", () => {
    longPress = pressedAt !== null && deps.now() - pressedAt >= LONG_PRESS_MS;
    pressedAt = null;
  });
  button.addEventListener(
    "click",
    (event) => {
      if (longPress) {
        // The long press unfolds; it is not also a tap on the chip.
        longPress = false;
        event.preventDefault();
        event.stopImmediatePropagation();
        safely(() => store?.removeItem(key), undefined);
        show(false);
        return;
      }
      safely(() => store?.setItem(key, "1"), undefined);
      show(true);
    },
    { capture: true },
  );
}
