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
