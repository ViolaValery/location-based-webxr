/**
 * Where the tour lives (polish round M2, A6/A7): the creator picks a host
 * first, and every later step speaks that host's language.
 *
 * Why these tests matter: the owner found step 1 confusing ("Host your
 * tour", a test link and a starter zip, all at once). The host choice is
 * the context the rest of the flow uses - its own upload and link steps,
 * whether the starter zip is needed, and how the zip is replaced later so
 * the printed link keeps working. A stored choice must survive a reload,
 * and an unreadable store must never break the page.
 */
import { describe, expect, it } from "vitest";

import {
  TOUR_HOSTS,
  hostReplaceText,
  hostSteps,
  isTourHost,
  needsStarterZip,
  readTourHost,
  writeTourHost,
} from "./tour-host.js";

function memoryStore() {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value);
    },
  };
}

describe("tour hosts", () => {
  it("offers Google Drive, Dropbox, OneDrive, GitHub and your own server, in that order", () => {
    expect(TOUR_HOSTS.map((h) => h.id)).toEqual([
      "drive",
      "dropbox",
      "onedrive",
      "github",
      "own",
    ]);
    for (const h of TOUR_HOSTS) expect(h.label.length).toBeGreaterThan(0);
  });

  it("gives each host its own steps, ending at the link", () => {
    for (const h of TOUR_HOSTS) {
      const steps = hostSteps(h.id);
      expect(steps.length, h.id).toBeGreaterThanOrEqual(2);
      expect(steps.at(-1), h.id).toMatch(/link/i);
    }
  });

  // Why: an own server is reached by any browser only with cross-origin
  // reads and byte ranges (the Drive proxy fronts Drive only); without
  // saying so the creator's first check fails for no visible reason.
  it("tells an own server what it must allow, and that the link can come first", () => {
    const steps = hostSteps("own").join(" ");
    expect(steps).toContain("Access-Control-Allow-Origin");
    expect(steps).toContain("Accept-Ranges");
    expect(steps).toMatch(/before the file exists/i);
  });

  it("asks for the starter zip only where the host needs a file to give a link", () => {
    expect(needsStarterZip("drive")).toBe(true);
    expect(needsStarterZip("dropbox")).toBe(true);
    expect(needsStarterZip("onedrive")).toBe(true);
    expect(needsStarterZip("github")).toBe(true);
    expect(needsStarterZip("own")).toBe(false);
  });

  it("keeps the choice across a reload, and ignores anything it did not write", () => {
    const store = memoryStore();
    expect(readTourHost(store)).toBeNull();
    writeTourHost(store, "dropbox");
    expect(readTourHost(store)).toBe("dropbox");
    store.items.set([...store.items.keys()][0]!, "ftp");
    expect(readTourHost(store)).toBeNull();
    expect(isTourHost("ftp")).toBe(false);
  });

  it("never throws on a store that throws, or with no store at all", () => {
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readTourHost(throwing)).toBeNull();
    expect(() => writeTourHost(throwing, "drive")).not.toThrow();
    expect(readTourHost(undefined)).toBeNull();
  });
});

describe("hostReplaceText (polish round M2, step 6)", () => {
  // Why: the completion step tells the creator how to put the saved zip in
  // place of the hosted one so the printed link keeps working. The page
  // used to list every host in one paragraph; the chosen host is known
  // now, so it gets its own words. Drive's steps come from the link
  // itself (they need the file's name), so it has none here.
  it("names the host's own way to replace the file under the same link", () => {
    expect(hostReplaceText("dropbox")).toMatch(/Dropbox/);
    expect(hostReplaceText("dropbox")).toMatch(/same name/);
    expect(hostReplaceText("onedrive")).toMatch(/"Replace"/);
    expect(hostReplaceText("github")).toMatch(/same path/);
    expect(hostReplaceText("own")).toMatch(/server/);
  });

  it("leaves Drive to the link's own steps", () => {
    expect(hostReplaceText("drive")).toBeNull();
  });

  it("speaks of one host only, never the others", () => {
    for (const { id } of TOUR_HOSTS) {
      const text = hostReplaceText(id);
      if (text === null) continue;
      const others = TOUR_HOSTS.filter((h) => h.id !== id && h.id !== "own");
      for (const other of others) expect(text).not.toContain(other.label);
    }
  });
});

describe("clearing the stored host", () => {
  // Why: a deselected host (P6) must not come back after a reload.
  it("writeTourHost(store, null) leaves no choice", () => {
    const store = memoryStore();
    writeTourHost(store, "drive");
    writeTourHost(store, null);
    expect(readTourHost(store)).toBeNull();
  });
});
