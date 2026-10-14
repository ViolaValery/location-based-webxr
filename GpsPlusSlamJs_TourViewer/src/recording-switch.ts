/**
 * The hidden recording switch on the visitor's start page (QR-first plan
 * §8, M1c): five taps on the tour's title within three seconds reload the
 * page with the debug readout (`debug=1`) and the troubleshooting recording
 * asked for (`record=1`), so a field test can be recorded after a scan with
 * any QR app. Page-free; `main.ts` wires it.
 *
 * @see recording-switch.ts.md
 */

/** The parameter that asks for the recording box to start ticked. */
export const RECORD_PARAM = "record";

/**
 * A counter of taps: `tap()` is true on the `taps`-th tap within
 * `windowMs`, and starts again after answering. Older taps are forgotten,
 * so slow tapping never answers.
 */
export function createTapCounter(options: {
  readonly taps: number;
  readonly windowMs: number;
  readonly now: () => number;
}): () => boolean {
  let times: number[] = [];
  return () => {
    const at = options.now();
    times = [...times.filter((t) => at - t < options.windowMs), at];
    if (times.length < options.taps) return false;
    times = [];
    return true;
  };
}

/** `href` with `debug=1` and `record=1` added, everything else kept. */
export function withRecordingFlags(href: string): string {
  const url = new URL(href);
  if (
    url.searchParams.get("debug") === "1" &&
    url.searchParams.get(RECORD_PARAM) === "1"
  ) {
    return href;
  }
  url.searchParams.set("debug", "1");
  url.searchParams.set(RECORD_PARAM, "1");
  return url.toString();
}

/** The page was opened to record: `record=1`, with the debug readout on
 *  (the recording's controls exist only then). */
export function wantsRecording(search: string, debug: boolean): boolean {
  return debug && new URLSearchParams(search).get(RECORD_PARAM) === "1";
}
