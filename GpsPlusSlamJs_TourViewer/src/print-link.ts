/**
 * Which spelling of the tour link a printed code carries (r820 feedback R4,
 * R5). A code's identity is a hash of its full text, so two spellings of
 * one Drive file make two different codes: new codes print the trimmed
 * address (fewer characters, one QR version smaller for a link shared from
 * the phone app), and a tour's own measured codes keep the spelling they
 * were printed in, so a re-print matches the posters already hanging.
 *
 * @see print-link.ts.md
 */

import { driveFileId } from "gps-plus-slam-app-framework/utils/drive-file-id";

/** The spelling a NEW code prints: a Drive file link trimmed to the file's
 *  address; any other link as it is. */
export function printableLink(url: string): string {
  const id = driveFileId(url);
  return id === null ? url : `https://drive.google.com/file/d/${id}`;
}

/**
 * The spellings a tour's measured codes may have been printed from: the
 * link as given first (a tour re-printed from the link it was printed from
 * is the common case, found in one round - M0c review), then the trimmed
 * address, Drive's own `/view` and its share tails - the desktop's
 * `sharing`, the phone app's `drivesdk`, the newer `drive_link` and
 * `share_link`. Each once; a link that is not a Drive file has one
 * spelling. A spelling outside the list stays a different code (follow-up
 * F2: store the printed spelling in the tour).
 */
export function linkSpellings(url: string): string[] {
  const printable = printableLink(url);
  const candidates =
    driveFileId(url) === null
      ? [url]
      : [
          url,
          printable,
          `${printable}/view`,
          ...["sharing", "drivesdk", "drive_link", "share_link"].map(
            (tail) => `${printable}/view?usp=${tail}`,
          ),
        ];
  return [...new Set(candidates)];
}

/**
 * The first free code number for a tour (polish round M0b): one more than
 * the highest number whose code the tour holds, 1 for a tour with none. A
 * tour files each code under a hash of its printed text (`qrCodeId`), so
 * the number cannot be read back - each number's id is computed
 * (`idOfCode`, a launch-URL build and a hash) and looked up, up to `limit`
 * (a gap below the highest is not reused). It stops once every id is
 * accounted for (PR #586 review): no higher number can match then, so the
 * common one-code tour costs one round.
 */
export async function nextCodeIndex(
  tourCodeIds: ReadonlySet<string>,
  idOfCode: (index: number) => Promise<string>,
  limit: number,
): Promise<number> {
  let highest = 0;
  let found = 0;
  for (let index = 1; index <= limit && found < tourCodeIds.size; index += 1) {
    // Sequential on purpose: a launch-URL build and a hash each, on the
    // main thread.
    // eslint-disable-next-line no-await-in-loop
    if (tourCodeIds.has(await idOfCode(index))) {
      highest = index;
      found += 1;
    }
  }
  return highest + 1;
}

/**
 * The spelling a tour's measured codes were printed from, and the next free
 * number in it: the first of `linkSpellings` with a code the tour holds.
 * None - a tour with no codes, or codes from another link altogether - is
 * the trimmed address from number 1 (the panel's orphan warning speaks for
 * the second case).
 */
export async function spellingOfRecord(
  url: string,
  measuredIds: ReadonlySet<string>,
  idOf: (link: string, index: number) => Promise<string>,
  limit: number,
): Promise<{ link: string; next: number }> {
  if (measuredIds.size > 0) {
    for (const link of linkSpellings(url)) {
      // eslint-disable-next-line no-await-in-loop
      const next = await nextCodeIndex(
        measuredIds,
        (index) => idOf(link, index),
        limit,
      );
      if (next > 1) return { link, next };
    }
  }
  return { link: printableLink(url), next: 1 };
}
