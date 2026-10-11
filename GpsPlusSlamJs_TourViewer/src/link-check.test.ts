/**
 * Step 2's link check (polish round M2, A13/A16).
 *
 * Why these tests matter: the owner asked for the link to be given once
 * and checked by itself, without blocking. A link whose file is not there
 * YET (an own server, or a cloud file not uploaded) or that cannot be
 * checked offline still goes on to printing, marked "not verified yet";
 * a link that can never work for a visitor (a host that blocks browsers,
 * a file that is not a tour) must not, because a printed code would then
 * fail for every visitor. The re-check before the PDF must not reuse a
 * saved copy, or a link that stopped working would read as reachable.
 */
import { describe, expect, it } from "vitest";

import {
  checkLink,
  linkStatusText,
  printsUnverified,
  recheckNote,
  type LinkStatus,
} from "./link-check.js";

describe("printsUnverified", () => {
  it("lets a missing file and an offline check go on to printing", () => {
    expect(printsUnverified("missing")).toBe(true);
    expect(printsUnverified("offline")).toBe(true);
  });

  it("stops a link that can never work for a visitor", () => {
    for (const cause of [
      "cors",
      "unusable-link",
      "corrupt",
      "too-large",
      "other",
    ]) {
      expect(printsUnverified(cause)).toBe(false);
    }
  });
});

describe("linkStatusText", () => {
  it("says what is happening, in plain words, for every state", () => {
    const states: LinkStatus[] = [
      { kind: "checking" },
      { kind: "found" },
      { kind: "failed", cause: "missing" },
      { kind: "failed", cause: "offline" },
      { kind: "failed", cause: "cors" },
      { kind: "failed", cause: "other" },
    ];
    const texts = states.map(linkStatusText);
    for (const text of texts) expect(text.length).toBeGreaterThan(10);
    expect(new Set(texts).size).toBe(texts.length);
  });

  it("tells the own-server creator that a missing file is fine for now", () => {
    expect(linkStatusText({ kind: "failed", cause: "missing" })).toMatch(
      /not verified yet/i,
    );
    expect(linkStatusText({ kind: "failed", cause: "missing" })).toMatch(
      /upload/i,
    );
  });

  it("tells a blocked link it cannot be printed as it is", () => {
    expect(linkStatusText({ kind: "failed", cause: "cors" })).toMatch(
      /visitors/i,
    );
  });
});

describe("checkLink", () => {
  it("opens without the saved copy and without a background download, and releases the archive", async () => {
    const calls: { url: string; options: unknown }[] = [];
    let disposed = 0;
    const result = await checkLink("https://h/t.zip", (url, options) => {
      calls.push({ url, options });
      return Promise.resolve({
        dispose: () => {
          disposed += 1;
        },
      });
    });
    expect(result).toEqual({ ok: true });
    expect(calls).toEqual([
      { url: "https://h/t.zip", options: { skipCache: true, warm: false } },
    ]);
    expect(disposed).toBe(1);
  });

  it("returns the probe's cause, and 'other' for anything else", async () => {
    const withCause = Object.assign(new Error("404"), {
      rejectCause: "missing",
    });
    expect(
      await checkLink("https://h/t.zip", () => Promise.reject(withCause)),
    ).toEqual({ ok: false, cause: "missing" });
    expect(
      await checkLink("https://h/t.zip", () =>
        Promise.reject(new Error("boom")),
      ),
    ).toEqual({ ok: false, cause: "other" });
  });
});

describe("recheckNote", () => {
  // Why: the PDF is built either way (the check never blocks), so the note
  // in front of its result is the only place the creator learns whether
  // the codes they are about to print will open.
  it("confirms a link that works now", () => {
    expect(recheckNote({ ok: true })).toMatch(/reachable/i);
  });

  it("warns when the link still does not work, naming the visitors", () => {
    expect(recheckNote({ ok: false, cause: "missing" })).toMatch(
      /still not reachable/i,
    );
    expect(recheckNote({ ok: false, cause: "missing" })).toMatch(/visitors/i);
  });
});
