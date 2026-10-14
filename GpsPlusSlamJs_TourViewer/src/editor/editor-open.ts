/**
 * Opening a tour file in the desktop editor (M6 E1): the viewer's own
 * `openTourFile` (its caps and integrity checks), then the manifest and
 * the codes, or the reason it cannot be edited, in the page's words
 * (`open-errors.ts`). A zip that carries neither a tour manifest nor a
 * code - a Recorder or scan zip - is refused as "not a tour file" rather
 * than shown as an empty map (M6 E1 plan review #8).
 *
 * @see editor-open.ts.md
 */

import type { QrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";
import {
  createEmptyTourManifest,
  type TourManifest,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import type { TourIntegrityError } from "gps-plus-slam-app-framework/ar/tour-signed-manifest";
import { describeOpenError } from "../open-errors.js";
import { openTourFile, type TourSession } from "../tour-session.js";

export type EditorOpen =
  | {
      readonly kind: "opened";
      readonly session: TourSession;
      readonly manifest: TourManifest;
      readonly levels: ReadonlyMap<string, QrLevel>;
      readonly fileName: string;
    }
  | { readonly kind: "refused"; readonly reason: string };

/** Said for a zip that is not a tour. */
export const NOT_A_TOUR =
  "This file is not a tour: it carries no tour.json and no printed codes. Choose the .zip your phone's Finish saved.";

/** Said for a file that is not a zip at all. */
export const NOT_A_ZIP = "This file is not a .zip file.";

export async function openTourForEditing(
  file: File,
  options: {
    /** A late integrity failure (an entry read or the background whole-file
     *  check): the page tears the tour down (tour-session.ts). */
    readonly onIntegrityFailure?: (
      err: TourIntegrityError,
      session: TourSession,
    ) => void;
    /** The opener, replaceable in tests. */
    readonly open?: typeof openTourFile;
  } = {},
): Promise<EditorOpen> {
  if (!/\.zip$/i.test(file.name) && file.type !== "application/zip") {
    return { kind: "refused", reason: NOT_A_ZIP };
  }
  let session: TourSession;
  try {
    session = await (options.open ?? openTourFile)(
      file,
      options.onIntegrityFailure === undefined
        ? {}
        : { onIntegrityFailure: options.onIntegrityFailure },
    );
  } catch (err) {
    return { kind: "refused", reason: describeOpenError(err) };
  }
  try {
    const [manifest, levels] = await Promise.all([
      session.loadTourManifest(),
      session.loadQrLevels(),
    ]);
    if (manifest === null && levels.size === 0) {
      await session.close();
      return { kind: "refused", reason: NOT_A_TOUR };
    }
    return {
      kind: "opened",
      session,
      manifest: manifest ?? createEmptyTourManifest(),
      levels,
      fileName: file.name,
    };
  } catch (err) {
    // A broken tour.json or level file rejects after the open succeeded.
    await session.close().catch(() => undefined);
    return {
      kind: "refused",
      reason: `This tour cannot be read: ${describeOpenError(err)}`,
    };
  }
}
