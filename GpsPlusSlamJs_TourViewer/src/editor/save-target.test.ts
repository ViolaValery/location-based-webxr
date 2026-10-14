/**
 * Why these tests matter: saving IN PLACE writes over the creator's only
 * copy of the tour (M6 E2b-1). The page must ask for write permission on
 * the open's own gesture (E2b plan review #8), must never overwrite a file
 * something else changed meanwhile (#4) - and must not refuse a file a sync
 * client only touched - and must say a moved or deleted file apart from a
 * changed one. One tab per file is a lock that lets go again (#6).
 */
import { describe, expect, it } from "vitest";
import {
  createSaveTarget,
  holdEditorLock,
  pickTourFile,
  TargetChangedError,
  type WritableFileHandle,
} from "./save-target.js";

/** A file on a fake disk: its bytes and modified time, and the calls. */
function fakeHandle(initial: string, name = "tour.zip") {
  const state = {
    bytes: initial,
    modified: 1000,
    gone: false,
    failWrite: false,
    calls: [] as string[],
    permission: "granted" as PermissionState | "throws",
  };
  const handle: WritableFileHandle = {
    kind: "file",
    name,
    getFile: () => {
      state.calls.push("getFile");
      if (state.gone) {
        return Promise.reject(new DOMException("gone", "NotFoundError"));
      }
      return Promise.resolve(
        new File([state.bytes], name, { lastModified: state.modified }),
      );
    },
    createWritable: () => {
      state.calls.push("createWritable");
      let pending = "";
      return Promise.resolve({
        write: async (data: unknown) => {
          if (state.failWrite) throw new Error("the disk is full");
          pending += await (data as Blob).text();
        },
        close: () => {
          state.bytes = pending;
          state.modified += 1;
          return Promise.resolve();
        },
        abort: () => Promise.resolve(),
      } as unknown as FileSystemWritableFileStream);
    },
    requestPermission: () => {
      state.calls.push("requestPermission");
      return state.permission === "throws"
        ? Promise.reject(new Error("no"))
        : Promise.resolve(state.permission);
    },
  } as unknown as WritableFileHandle;
  return { handle, state };
}

describe("pickTourFile", () => {
  it("is unavailable without the picker, so the page uses its file input", async () => {
    expect(await pickTourFile({})).toEqual({ kind: "unavailable" });
  });

  it("treats a dismissed picker as a cancel, never an error", async () => {
    const outcome = await pickTourFile({
      showOpenFilePicker: () =>
        Promise.reject(new DOMException("dismissed", "AbortError")),
    });
    expect(outcome).toEqual({ kind: "cancelled" });
  });

  it("asks for write permission before it reads the file (review #8)", async () => {
    const { handle, state } = fakeHandle("zip bytes");
    const outcome = await pickTourFile({
      showOpenFilePicker: () => Promise.resolve([handle]),
    });
    expect(state.calls.slice(0, 2)).toEqual(["requestPermission", "getFile"]);
    expect(outcome).toMatchObject({ kind: "picked", writable: true });
    if (outcome.kind !== "picked") return;
    expect(await outcome.file.text()).toBe("zip bytes");
  });

  it("opens a file it may not write, to be saved as a download", async () => {
    for (const permission of ["denied", "prompt", "throws"] as const) {
      const { handle, state } = fakeHandle("zip bytes");
      state.permission = permission;
      const outcome = await pickTourFile({
        showOpenFilePicker: () => Promise.resolve([handle]),
      });
      expect(outcome).toMatchObject({ kind: "picked", writable: false });
    }
  });
});

describe("createSaveTarget", () => {
  it("writes the file in place and checks against what it wrote", async () => {
    const { handle, state } = fakeHandle("version one");
    const target = await createSaveTarget(handle, await handle.getFile());
    expect(await target.check()).toBe("same");
    const written = await target.write(new Blob(["version two"]));
    expect(state.bytes).toBe("version two");
    expect(await written.text()).toBe("version two");
    // Its own write is not "changed by something else".
    expect(await target.check()).toBe("same");
  });

  it("refuses to write over a file something else changed (review #4)", async () => {
    const { handle, state } = fakeHandle("version one");
    const target = await createSaveTarget(handle, await handle.getFile());
    state.bytes = "another program";
    state.modified += 5;
    expect(await target.check()).toBe("changed");
    await expect(target.write(new Blob(["mine"]))).rejects.toMatchObject({
      kind: "changed",
    });
    expect(state.bytes).toBe("another program");
  });

  it("does not refuse a file a sync client only touched: same size, same end", async () => {
    const { handle, state } = fakeHandle("version one");
    const target = await createSaveTarget(handle, await handle.getFile());
    state.modified += 60_000;
    expect(await target.check()).toBe("same");
    // The same size with other bytes at the end is a change.
    state.bytes = "version ONE";
    state.modified += 1;
    expect(await target.check()).toBe("changed");
  });

  it("says a moved, renamed or deleted file apart from a changed one", async () => {
    const { handle, state } = fakeHandle("version one");
    const target = await createSaveTarget(handle, await handle.getFile());
    state.gone = true;
    expect(await target.check()).toBe("gone");
    const err = await target.write(new Blob(["mine"])).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TargetChangedError);
    expect((err as TargetChangedError).kind).toBe("gone");
  });

  it("keeps its baseline when a write fails, so the next check is honest", async () => {
    const { handle, state } = fakeHandle("version one");
    const target = await createSaveTarget(handle, await handle.getFile());
    state.failWrite = true;
    await expect(target.write(new Blob(["version two"]))).rejects.toThrow(
      /disk is full/,
    );
    expect(state.bytes).toBe("version one");
    expect(await target.check()).toBe("same");
  });
});

describe("holdEditorLock", () => {
  /** A Web Locks stand-in: exclusive, `ifAvailable`, released on demand. */
  function fakeLocks() {
    const held = new Set<string>();
    return {
      held,
      locks: {
        request: (
          name: string,
          _options: LockOptions,
          callback: (lock: Lock | null) => unknown,
        ) => {
          if (held.has(name)) return Promise.resolve(callback(null));
          held.add(name);
          return Promise.resolve(callback({ name, mode: "exclusive" })).finally(
            () => held.delete(name),
          );
        },
      } as unknown as LockManager,
    };
  }

  it("grants one tab a file's name, refuses a second, and lets go on release", async () => {
    const { locks, held } = fakeLocks();
    const first = await holdEditorLock(locks, "tour.zip");
    expect(first.granted).toBe(true);
    expect((await holdEditorLock(locks, "tour.zip")).granted).toBe(false);
    expect((await holdEditorLock(locks, "other.zip")).granted).toBe(true);
    first.release();
    await Promise.resolve();
    await Promise.resolve();
    expect(held.has("gps-plus-slam/tour-viewer-editor/tour.zip")).toBe(false);
    expect((await holdEditorLock(locks, "tour.zip")).granted).toBe(true);
  });

  it("grants without Web Locks, or when the request fails: nothing to coordinate", async () => {
    expect((await holdEditorLock(undefined, "tour.zip")).granted).toBe(true);
    const failing = {
      request: () => Promise.reject(new Error("no locks here")),
    } as unknown as LockManager;
    expect((await holdEditorLock(failing, "tour.zip")).granted).toBe(true);
  });
});
