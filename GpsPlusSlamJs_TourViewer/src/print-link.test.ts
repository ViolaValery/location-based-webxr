/**
 * Which spelling of the tour link a printed code carries (r820 feedback R4,
 * R5).
 *
 * Why these tests matter: a code's identity is a hash of its full text,
 * and the measured pose is filed under it. Google Drive hands out the same
 * file under several spellings - the desktop's "copy link" ends in
 * `?usp=sharing`, the phone app's share in `?usp=drivesdk` - so a tour
 * measured from one and re-printed from the other got codes that matched
 * nothing it held, and the owner was told the link "must have changed"
 * while holding the very link they had used (r820 test). New codes print
 * the trimmed address (one QR version smaller for a phone-shared link);
 * a tour's own measured codes keep the spelling they were printed in, so a
 * re-print matches the posters on the wall.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { planPrintCode } from "gps-plus-slam-app-framework/utils/qr-payload/qr-print-plan";
import { qrCodeId } from "gps-plus-slam-app-framework/utils/qr-payload/qr-code-id";

import {
  driveFileId,
  linkSpellings,
  printableLink,
  spellingOfRecord,
} from "./print-link.js";

const ID = "1A4mU8eV16aaIvy6Msd76RC3_cbbftRkX";
const BARE = `https://drive.google.com/file/d/${ID}`;
const DESKTOP = `${BARE}/view?usp=sharing`;
const PHONE = `${BARE}/view?usp=drivesdk`;

/** The id a code would carry: the real launch-URL builder and hash. */
async function idOf(link: string, index: number): Promise<string> {
  return qrCodeId((await planPrintCode(link, { codeIndex: index })).url);
}

describe("driveFileId", () => {
  it("reads the id from every spelling Drive hands out", () => {
    for (const link of [
      DESKTOP,
      PHONE,
      BARE,
      `${BARE}/edit`,
      `https://drive.google.com/open?id=${ID}`,
      `https://drive.google.com/uc?id=${ID}&export=download`,
      `https://drive.usercontent.google.com/download?id=${ID}&confirm=t`,
    ]) {
      expect(driveFileId(link), link).toBe(ID);
    }
  });

  it("is null for anything that is not a Drive file", () => {
    for (const link of [
      "https://example.com/file/d/abc",
      "https://drive.google.com/drive/folders/abc",
      "not a link",
      `https://drive.google.com/file/d/${ID}%20x/view`,
    ]) {
      expect(driveFileId(link), link).toBeNull();
    }
  });
});

describe("printableLink", () => {
  it("trims a Drive link to the file's address, and leaves others alone", () => {
    expect(printableLink(DESKTOP)).toBe(BARE);
    expect(printableLink(PHONE)).toBe(BARE);
    expect(
      printableLink("https://www.dropbox.com/scl/fi/a/t.zip?rlkey=k&dl=0"),
    ).toBe("https://www.dropbox.com/scl/fi/a/t.zip?rlkey=k&dl=0");
  });

  // The measured gain (R5): a phone-shared link drops a QR version.
  it("prints a phone-shared Drive link one QR version smaller", async () => {
    const full = await planPrintCode(PHONE);
    const trimmed = await planPrintCode(printableLink(PHONE));
    expect(trimmed.qrVersion).toBeLessThan(full.qrVersion);
  });
});

describe("linkSpellings", () => {
  it("tries the trimmed address first, Drive's spellings next, the link as given last", () => {
    expect(linkSpellings(PHONE)).toEqual([
      BARE,
      `${BARE}/view`,
      DESKTOP,
      PHONE,
    ]);
    expect(linkSpellings(`${BARE}/edit?usp=x`).at(-1)).toBe(
      `${BARE}/edit?usp=x`,
    );
    expect(linkSpellings("https://h.example/t.zip")).toEqual([
      "https://h.example/t.zip",
    ]);
  });

  it("always starts with the printable link and holds each spelling once (property)", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(DESKTOP, PHONE, BARE, "https://h.example/t.zip"),
        fc.string({ maxLength: 8 }),
        (base, tail) => {
          const link = base + tail.replace(/\s/g, "");
          const spellings = linkSpellings(link);
          expect(spellings[0]).toBe(printableLink(link));
          expect(new Set(spellings).size).toBe(spellings.length);
        },
      ),
    );
  });
});

describe("spellingOfRecord", () => {
  // The owner's r820 case: measured from the phone's link, re-printed from
  // the desktop's copy of the same file.
  it("finds the spelling a tour's codes were printed from, and continues its numbering", async () => {
    const measured = new Set([await idOf(PHONE, 1), await idOf(PHONE, 2)]);
    await expect(
      spellingOfRecord(DESKTOP, measured, idOf, 50),
    ).resolves.toEqual({
      link: PHONE,
      next: 3,
    });
  });

  it("prints the trimmed address for a tour with no codes, from number 1", async () => {
    await expect(spellingOfRecord(PHONE, new Set(), idOf, 50)).resolves.toEqual(
      {
        link: BARE,
        next: 1,
      },
    );
  });

  // A different FILE is a different link: nothing matches, the new codes
  // print trimmed from 1, and the orphan warning is the panel's to give.
  it("falls back to the trimmed address when no spelling matches", async () => {
    const other = new Set([await idOf("https://h.example/other.zip", 1)]);
    await expect(spellingOfRecord(PHONE, other, idOf, 50)).resolves.toEqual({
      link: BARE,
      next: 1,
    });
  });

  it("stops at the first spelling that matches", async () => {
    const measured = new Set([await idOf(BARE, 1)]);
    const asked: string[] = [];
    const counting = (link: string, index: number) => {
      asked.push(link);
      return idOf(link, index);
    };
    await expect(
      spellingOfRecord(PHONE, measured, counting, 50),
    ).resolves.toEqual({
      link: BARE,
      next: 2,
    });
    expect(new Set(asked)).toEqual(new Set([BARE]));
    // ...and, with its one code found at number 1, asks once (PR #586).
    expect(asked).toHaveLength(1);
  });
});
