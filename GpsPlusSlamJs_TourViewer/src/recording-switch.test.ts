/**
 * Why these tests matter: a visitor who scanned a printed code with a QR
 * app has no way to turn on the troubleshooting recording - the owner's
 * field test could not be recorded for exactly that reason (QR-first plan
 * §8, M1c). Five taps on the tour's title, within three seconds, reload the
 * page with the debug readout and the recording asked for; fewer taps, or
 * slower ones, never do - nobody should land in debug mode by accident.
 */
import { describe, expect, it } from "vitest";
import {
  createTapCounter,
  RECORD_PARAM,
  wantsRecording,
  withRecordingFlags,
} from "./recording-switch.js";

describe("createTapCounter", () => {
  it("answers on the fifth tap within three seconds, and not before", () => {
    let now = 0;
    const tap = createTapCounter({ taps: 5, windowMs: 3000, now: () => now });
    for (let i = 0; i < 4; i += 1) {
      expect(tap()).toBe(false);
      now += 500;
    }
    expect(tap()).toBe(true);
  });

  it("forgets taps older than the window, so slow tapping never answers", () => {
    let now = 0;
    const tap = createTapCounter({ taps: 5, windowMs: 3000, now: () => now });
    for (let i = 0; i < 20; i += 1) {
      expect(tap()).toBe(false);
      now += 800;
    }
  });

  it("starts again after it answered", () => {
    const now = 0;
    const tap = createTapCounter({ taps: 5, windowMs: 3000, now: () => now });
    for (let i = 0; i < 4; i += 1) tap();
    expect(tap()).toBe(true);
    expect(tap()).toBe(false);
  });
});

describe("withRecordingFlags", () => {
  it("adds debug and record, keeping the code and every other parameter", () => {
    const next = new URL(
      withRecordingFlags("https://gps.csutil.com/tour/?qr=abc&n=2#x"),
    );
    expect(next.searchParams.get("qr")).toBe("abc");
    expect(next.searchParams.get("n")).toBe("2");
    expect(next.searchParams.get("debug")).toBe("1");
    expect(next.searchParams.get(RECORD_PARAM)).toBe("1");
    expect(next.pathname).toBe("/tour/");
    expect(next.hash).toBe("#x");
  });

  it("is unchanged when both are already there", () => {
    const href = "https://gps.csutil.com/tour/?qr=abc&debug=1&record=1";
    expect(withRecordingFlags(href)).toBe(href);
  });
});

describe("wantsRecording", () => {
  it("is true only with the debug readout AND record asked for", () => {
    expect(wantsRecording("?qr=a&debug=1&record=1", true)).toBe(true);
    expect(wantsRecording("?qr=a&record=1", false)).toBe(false);
    expect(wantsRecording("?qr=a&debug=1", true)).toBe(false);
    expect(wantsRecording("?qr=a&debug=1&record=0", true)).toBe(false);
  });
});
