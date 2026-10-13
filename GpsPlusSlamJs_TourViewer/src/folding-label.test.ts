/**
 * A HUD chip's label folds to its icon after its first use (polish round
 * M3, the owner's D-P4 on the H1 strip), remembered per device; a long
 * press shows it again.
 *
 * Why these tests matter: a folded chip is an icon only, so its accessible
 * name must stay the full label; the long press that unfolds it must not
 * ALSO run the chip's action (a pin would be placed); and storage that
 * throws (a private window) must leave the chip working, unfolded.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { LONG_PRESS_MS, wireFoldingLabel } from "./folding-label.js";

type Handler = (event: FakeEvent) => void;
interface FakeEvent {
  defaultPrevented: boolean;
  stopped: boolean;
  preventDefault(): void;
  stopImmediatePropagation(): void;
}

/** A button with capture-first click dispatch, as a browser at the target. */
function fakeButton() {
  const capture: Handler[] = [];
  const bubble: Handler[] = [];
  const other = new Map<string, Handler[]>();
  const attributes = new Map<string, string>();
  return {
    dataset: {} as Record<string, string>,
    attributes,
    setAttribute(name: string, value: string) {
      attributes.set(name, value);
    },
    addEventListener(
      type: string,
      handler: Handler,
      options?: { capture?: boolean },
    ) {
      if (type === "click") (options?.capture ? capture : bubble).push(handler);
      else other.set(type, [...(other.get(type) ?? []), handler]);
    },
    fire(type: string) {
      const event: FakeEvent = {
        defaultPrevented: false,
        stopped: false,
        preventDefault() {
          this.defaultPrevented = true;
        },
        stopImmediatePropagation() {
          this.stopped = true;
        },
      };
      const handlers =
        type === "click" ? [...capture, ...bubble] : (other.get(type) ?? []);
      for (const handler of handlers) {
        if (event.stopped) break;
        handler(event);
      }
    },
  };
}

function memory() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
    removeItem: (k: string) => {
      data.delete(k);
    },
  };
}

function setup(store: ReturnType<typeof memory> | null = memory()) {
  let now = 0;
  const button = fakeButton();
  let actions = 0;
  wireFoldingLabel({
    button,
    key: "pin",
    label: "Place a pin",
    store,
    now: () => now,
  });
  // The chip's own action, bound after the fold (as the page does).
  button.addEventListener("click", () => (actions += 1));
  return {
    button,
    store,
    actions: () => actions,
    tap(heldMs = 50) {
      button.fire("pointerdown");
      now += heldMs;
      button.fire("pointerup");
      button.fire("click");
    },
  };
}

describe("wireFoldingLabel", () => {
  it("shows the label until the chip is first used, then folds it, remembered", () => {
    const s = setup();
    expect(s.button.dataset["folded"]).toBeUndefined();
    s.tap();
    expect(s.actions()).toBe(1);
    expect(s.button.dataset["folded"]).toBe("true");
    // The next page load (a new wiring over the same store) starts folded.
    const again = fakeButton();
    wireFoldingLabel({
      button: again,
      key: "pin",
      label: "Place a pin",
      store: s.store,
      now: () => 0,
    });
    expect(again.dataset["folded"]).toBe("true");
  });

  it("keeps the full label as the accessible name, folded or not", () => {
    const s = setup();
    expect(s.button.attributes.get("aria-label")).toBe("Place a pin");
    s.tap();
    expect(s.button.attributes.get("aria-label")).toBe("Place a pin");
  });

  it("unfolds on a long press, which does not also run the chip's action", () => {
    const s = setup();
    s.tap();
    expect(s.actions()).toBe(1);
    s.tap(LONG_PRESS_MS);
    expect(s.button.dataset["folded"]).toBeUndefined();
    expect(s.actions()).toBe(1);
    // A tap after that runs the action again (and folds it again).
    s.tap();
    expect(s.actions()).toBe(2);
    expect(s.button.dataset["folded"]).toBe("true");
  });

  it("works without storage, and with storage that throws", () => {
    const none = setup(null);
    none.tap();
    expect(none.actions()).toBe(1);
    expect(none.button.dataset["folded"]).toBe("true");
    const throwing = {
      data: new Map<string, string>(),
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    const s = setup(throwing);
    expect(s.button.dataset["folded"]).toBeUndefined();
    s.tap();
    expect(s.actions()).toBe(1);
  });

  // A press shorter than the threshold is a tap, whatever its length.
  it("treats every press shorter than the long press as a tap (property)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: LONG_PRESS_MS - 1 }), (held) => {
        const s = setup();
        s.tap(held);
        expect(s.actions()).toBe(1);
      }),
    );
  });
});
