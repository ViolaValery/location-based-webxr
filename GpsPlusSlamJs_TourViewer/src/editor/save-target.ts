/**
 * The desktop editor's in-place save (M6 E2b-1): a tour file opened through
 * the browser's file picker with write permission, written back where it
 * came from. Page-free: the page passes the window and the lock manager.
 *
 * @see save-target.ts.md
 */

import { writeFileOrAbort } from "gps-plus-slam-app-framework/storage";

/** The tail of the file a sync client's touch leaves alone: compared when
 *  only the modified time differs, so a touched file is not "changed". */
const TAIL_BYTES = 64 * 1024;

/** The lock names' family: a sibling of the recordings'
 *  (`gps-plus-slam/tour-viewer/`), so their housekeeping never lists it. */
const LOCK_PREFIX = "gps-plus-slam/tour-viewer-editor/";

/** A picked file's handle, with the permission calls Chromium has and the
 *  DOM typings do not carry yet. */
export type WritableFileHandle = FileSystemFileHandle & {
  requestPermission?: (descriptor: {
    mode: "read" | "readwrite";
  }) => Promise<PermissionState>;
};

/** The part of `window` the picker needs. */
export interface PickerWindow {
  showOpenFilePicker?: (options: {
    types: { description: string; accept: Record<string, string[]> }[];
    multiple: false;
  }) => Promise<WritableFileHandle[]>;
}

export type PickOutcome =
  | { readonly kind: "unavailable" }
  | { readonly kind: "cancelled" }
  | {
      readonly kind: "picked";
      readonly file: File;
      readonly handle: WritableFileHandle;
      /** Write permission was granted: the file can be saved in place. */
      readonly writable: boolean;
    };

/**
 * Let the creator pick a tour zip, and ask to write it on the same gesture.
 * The permission is asked FIRST, before any read of the file, while the
 * picker's activation still holds (E2b plan review #8). `unavailable` is a
 * browser without the picker, or one that refuses it (an iframe): the page
 * then uses its file input.
 */
export async function pickTourFile(win: PickerWindow): Promise<PickOutcome> {
  const picker = win.showOpenFilePicker;
  if (typeof picker !== "function") return { kind: "unavailable" };
  let handles: WritableFileHandle[];
  try {
    handles = await picker.call(win, {
      types: [
        {
          description: "Tour file",
          accept: { "application/zip": [".zip"] },
        },
      ],
      multiple: false,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return { kind: "cancelled" };
    }
    return { kind: "unavailable" };
  }
  const handle = handles[0];
  if (handle === undefined) return { kind: "cancelled" };
  const writable = await askToWrite(handle);
  return { kind: "picked", file: await handle.getFile(), handle, writable };
}

async function askToWrite(handle: WritableFileHandle): Promise<boolean> {
  if (typeof handle.requestPermission !== "function") return false;
  try {
    return (
      (await handle.requestPermission({ mode: "readwrite" })) === "granted"
    );
  } catch {
    return false;
  }
}

/** Why an in-place write was refused: the file on disk is not the one this
 *  page last opened or wrote. */
export class TargetChangedError extends Error {
  constructor(readonly kind: "changed" | "gone") {
    super(
      kind === "gone"
        ? "The file was moved, renamed or deleted since it was opened."
        : "The file changed on disk since it was opened.",
    );
    this.name = "TargetChangedError";
  }
}

export interface SaveTarget {
  /** The file's name, as the picker gave it. */
  readonly name: string;
  /** Whether the file on disk is still the one opened or last written. */
  check(): Promise<"same" | "changed" | "gone">;
  /**
   * Write `blob` over the file - unless it changed meanwhile, which throws
   * `TargetChangedError` and writes nothing. Returns the file as written
   * (disk-backed, so the page need not keep its own copy of the bytes).
   */
  write(blob: Blob): Promise<File>;
}

interface Baseline {
  readonly size: number;
  readonly lastModified: number;
  readonly tail: Uint8Array;
}

async function tailOf(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(
    await blob.slice(Math.max(0, blob.size - TAIL_BYTES)).arrayBuffer(),
  );
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * The in-place target for a file opened through `pickTourFile` with write
 * permission. `opened` is the file as read at the open: its size, time and
 * tail are the baseline, read NOW - a `File` from disk becomes unreadable
 * once the file changes.
 */
export async function createSaveTarget(
  handle: WritableFileHandle,
  opened: File,
): Promise<SaveTarget> {
  let base: Baseline = {
    size: opened.size,
    lastModified: opened.lastModified,
    tail: await tailOf(opened),
  };
  async function check(): Promise<"same" | "changed" | "gone"> {
    let now: File;
    try {
      now = await handle.getFile();
    } catch (err) {
      if (err instanceof DOMException && err.name === "NotFoundError") {
        return "gone";
      }
      throw err;
    }
    if (now.size !== base.size) return "changed";
    if (now.lastModified === base.lastModified) return "same";
    // Only the time differs: a sync client may touch a file it uploaded.
    // The same end of the zip (its central directory) is the same file.
    if (!sameBytes(await tailOf(now), base.tail)) return "changed";
    base = { ...base, lastModified: now.lastModified };
    return "same";
  }
  return {
    name: handle.name,
    check,
    async write(blob) {
      // Checked again right before the write: the build may have taken
      // seconds. Another program writing DURING our write is not caught;
      // the check and the write are not one step.
      const state = await check();
      if (state !== "same") throw new TargetChangedError(state);
      await writeFileOrAbort(handle, blob);
      const written = await handle.getFile();
      // The baseline moves only once the write landed.
      base = {
        size: written.size,
        lastModified: written.lastModified,
        tail: await tailOf(blob),
      };
      return written;
    },
  };
}

/**
 * One editing tab per file name (E2b plan review #6): an exclusive Web Lock
 * held until `release` (another tour opened) or until the page goes.
 * `granted: false` when another tab holds it. Without Web Locks, or when
 * the request fails, it grants: there is nothing to coordinate with, and
 * refusing would only stop this tab from saving.
 */
export function holdEditorLock(
  locks: LockManager | undefined,
  fileName: string,
): Promise<{ readonly granted: boolean; release(): void }> {
  const none = { granted: true, release: () => undefined };
  if (locks === undefined) return Promise.resolve(none);
  return new Promise((resolve) => {
    locks
      .request(`${LOCK_PREFIX}${fileName}`, { ifAvailable: true }, (lock) => {
        if (lock === null) {
          resolve({ granted: false, release: () => undefined });
          return undefined;
        }
        return new Promise<void>((done) => {
          resolve({ granted: true, release: () => done() });
        });
      })
      .catch(() => {
        resolve(none);
      });
  });
}
