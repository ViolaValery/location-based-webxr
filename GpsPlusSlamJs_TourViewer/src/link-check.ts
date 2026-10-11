/**
 * Step 2's link check (polish round M2, A13/A16): the line the creator
 * reads under the pasted link, which failures still go on to printing
 * ("not verified yet"), and the light re-check the print step runs before
 * the PDF. The copy is provisional and lives here for that reason.
 *
 * @see link-check.ts.md
 */

export type LinkStatus =
  { kind: "checking" } | { kind: "found" } | { kind: "failed"; cause: string };

/** Failures that say nothing against the link itself: the file is not
 *  there YET (an own server's link can come before its file), or this
 *  device could not ask. Every other cause would fail for every visitor
 *  too, so a code printed from it would be a code nobody can open. */
export function printsUnverified(cause: string): boolean {
  return cause === "missing" || cause === "offline";
}

export function linkStatusText(status: LinkStatus): string {
  switch (status.kind) {
    case "checking":
      return "Checking the link…";
    case "found":
      return "Tour found - the link works.";
    case "failed":
      return failedText(status.cause);
  }
}

function failedText(cause: string): string {
  if (cause === "missing") {
    return "Not verified yet: there is no file at this link yet. That is fine if you upload it later - you can print the code now, and the link is checked again before the PDF.";
  }
  if (cause === "offline") {
    return "Not verified yet: this device is offline. You can print the code now; the link is checked again before the PDF.";
  }
  if (cause === "cors" || cause === "unusable-link") {
    return "This link does not let browsers read the file, so a printed code would not open for visitors. Share the file publicly, or pick another host in step 1.";
  }
  return "The file at this link is not a tour that opens here. Check the link, or start from the empty starter tour in step 1.";
}

export type LinkCheckResult = { ok: true } | { ok: false; cause: string };

/** The line in front of the PDF's result after the re-check of an
 *  unverified link. The PDF is built either way: the check informs, it
 *  never blocks. */
export function recheckNote(result: LinkCheckResult): string {
  return result.ok
    ? "Link checked: the tour is reachable now."
    : "The link is still not reachable - visitors' scans will not open the tour until the file is there.";
}

/** The archive opener `checkLink` needs: `openRemoteArchive` with the
 *  page's transport options bound. */
export type LinkOpener = (
  url: string,
  options: { skipCache: true; warm: false },
) => Promise<{ dispose(): void }>;

/**
 * Whether a link opens now, without opening the tour: the archive is
 * probed and released. Never from the saved copy (a link that stopped
 * working would read as reachable) and with no background download.
 */
export async function checkLink(
  url: string,
  open: LinkOpener,
): Promise<LinkCheckResult> {
  try {
    const opened = await open(url, { skipCache: true, warm: false });
    opened.dispose();
    return { ok: true };
  } catch (err) {
    const cause =
      err instanceof Error && "rejectCause" in err
        ? String(err.rejectCause)
        : "other";
    return { ok: false, cause };
  }
}
