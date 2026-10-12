/**
 * The print panel's wiring (`wirePrintPanel`) over stand-in elements: the
 * PDF button's cycle, the re-check of an unverified link before the PDF,
 * the poster text and the poster-count stepper.
 *
 * Why these tests matter: the rules here live only in the glue, and the
 * e2e never presses the PDF button with an unverified link (PRs #584 and
 * #585 reviews). A re-check that clears the wrong tour's "not verified
 * yet", a PDF built for the link of a tour opened during the re-check, or
 * poster text that never reaches the PDF would all look fine on screen.
 * The tiles need a real canvas, so their drawing fails quietly here and is
 * covered by the Playwright specs.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as PrintPlan from "gps-plus-slam-app-framework/utils/qr-payload/qr-print-plan";
import type * as PrintPdf from "gps-plus-slam-app-framework/utils/qr-payload/qr-print-pdf";

import { wirePrintPanel, type PrintPanelDom } from "./print-panel.js";
import type { LinkCheckResult } from "./link-check.js";

const spies = vi.hoisted(() => ({
  planned: [] as string[],
  indexes: [] as number[],
  pdfOptions: [] as unknown[],
  pdfCodes: [] as unknown[],
}));

vi.mock(
  "gps-plus-slam-app-framework/utils/qr-payload/qr-print-plan",
  async (importOriginal) => {
    const real = await importOriginal<typeof PrintPlan>();
    return {
      ...real,
      planPrintCode: (url: string, options?: { codeIndex?: number }) => {
        spies.planned.push(url);
        spies.indexes.push(options?.codeIndex ?? 1);
        return real.planPrintCode(url, options);
      },
    };
  },
);

vi.mock(
  "gps-plus-slam-app-framework/utils/qr-payload/qr-print-pdf",
  async (importOriginal) => {
    const real = await importOriginal<typeof PrintPdf>();
    return {
      ...real,
      buildQrPrintPdf: (
        ...args: Parameters<typeof real.buildQrPrintPdf>
      ): ReturnType<typeof real.buildQrPrintPdf> => {
        spies.pdfOptions.push(args[1]);
        spies.pdfCodes.push(args[0]);
        return real.buildQrPrintPdf(...args);
      },
    };
  },
);

/** A stand-in element: the fields the panel reads and writes, listeners. */
function el(value = "") {
  const handlers = new Map<string, (() => void)[]>();
  return {
    value,
    textContent: "",
    hidden: false,
    disabled: false,
    open: false,
    replaceChildren: () => undefined,
    removeAttribute: () => undefined,
    addEventListener: (type: string, handler: () => void) => {
      handlers.set(type, [...(handlers.get(type) ?? []), handler]);
    },
    fire: (type: string) => {
      for (const handler of handlers.get(type) ?? []) handler();
    },
  };
}

function memoryStore() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

function wire(
  options: {
    checkLink?: (url: string) => Promise<LinkCheckResult>;
    tourTitle?: () => string | null;
    store?: ReturnType<typeof memoryStore>;
    measuredCodeIds?: () => readonly string[];
  } = {},
) {
  const dom = {
    panel: el(),
    urlInput: el(),
    urlAsk: el(),
    urlShown: el(),
    sizeInput: el("18"),
    codeInput: el("1"),
    info: el(),
    tiles: el(),
    urlOut: el(),
    countInput: el("3"),
    countDown: el(),
    countUp: el(),
    paperSelect: el("a4"),
    pdfButton: el(),
    posterTitle: el(),
    posterExplanation: el(),
    posterCallToAction: el(),
  };
  const downloadPdf = vi.fn(() => Promise.resolve(true));
  const panel = wirePrintPanel({
    dom: dom as unknown as PrintPanelDom,
    mode: "creator",
    downloadPdf,
    ...(options.checkLink === undefined
      ? {}
      : { checkLink: options.checkLink }),
    ...(options.tourTitle === undefined
      ? {}
      : { tourTitle: options.tourTitle }),
    posterStore: options.store ?? memoryStore(),
    ...(options.measuredCodeIds === undefined
      ? {}
      : { measuredCodeIds: options.measuredCodeIds }),
  });
  return { dom, panel, downloadPdf };
}

/** Resolves when the PDF button has come back to idle. */
async function settled(dom: { pdfButton: { disabled: boolean } }) {
  await vi.waitFor(() => {
    expect(dom.pdfButton.disabled).toBe(false);
  });
}

beforeEach(() => {
  spies.planned.length = 0;
  spies.pdfOptions.length = 0;
});

describe("the re-check before the PDF (polish round M2)", () => {
  it("checks an unverified link, then drops its 'not verified yet' and says so", async () => {
    const checkLink = vi.fn(() => Promise.resolve({ ok: true } as const));
    const { dom, panel, downloadPdf } = wire({ checkLink });
    panel.presentTour("https://h.example/t.zip", { verified: false });
    expect(dom.urlShown.textContent).toMatch(/not verified yet/);
    dom.pdfButton.fire("click");
    expect(dom.pdfButton.disabled).toBe(true);
    await settled(dom);
    expect(checkLink).toHaveBeenCalledWith("https://h.example/t.zip");
    expect(dom.urlShown.textContent).toBe("https://h.example/t.zip");
    expect(dom.info.textContent).toMatch(/^Link checked/);
    expect(dom.info.textContent).toMatch(/Saved/);
    expect(downloadPdf).toHaveBeenCalledTimes(1);
  });

  // The check informs, it never blocks: a link whose file is still not
  // there gets its PDF, with the warning in front of the result.
  it("still builds the PDF when the re-check fails", async () => {
    const { dom, panel, downloadPdf } = wire({
      checkLink: () => Promise.resolve({ ok: false, cause: "missing" }),
    });
    panel.presentTour("https://h.example/t.zip", { verified: false });
    dom.pdfButton.fire("click");
    await settled(dom);
    expect(downloadPdf).toHaveBeenCalledTimes(1);
    expect(dom.info.textContent).toMatch(/still not reachable/);
    expect(dom.urlShown.textContent).toMatch(/not verified yet/);
  });

  it("does not check a link step 2 already confirmed", async () => {
    const checkLink = vi.fn(() => Promise.resolve({ ok: true } as const));
    const { dom, panel } = wire({ checkLink });
    panel.presentTour("https://h.example/t.zip");
    dom.pdfButton.fire("click");
    await settled(dom);
    expect(checkLink).not.toHaveBeenCalled();
    expect(dom.info.textContent).toMatch(/^Saved/);
  });

  // A tour opened while the re-check runs: its link must keep its own
  // "not verified yet", and the PDF is the one the creator asked for -
  // the link at the tap, not the link at the end of the check (PR #585).
  it("leaves a tour opened during the re-check alone, and prints the link of the tap", async () => {
    let finish: (result: LinkCheckResult) => void = () => undefined;
    const { dom, panel } = wire({
      checkLink: () =>
        new Promise<LinkCheckResult>((resolve) => {
          finish = resolve;
        }),
    });
    panel.presentTour("https://a.example/t.zip", { verified: false });
    dom.pdfButton.fire("click");
    panel.presentTour("https://b.example/t.zip", { verified: false });
    spies.planned.length = 0;
    finish({ ok: true });
    await settled(dom);
    expect(dom.urlShown.textContent).toBe(
      "https://b.example/t.zip - not verified yet",
    );
    expect(spies.planned.length).toBeGreaterThan(0);
    expect(new Set(spies.planned)).toEqual(
      new Set(["https://a.example/t.zip"]),
    );
  });
});

describe("the poster text (polish round D-P7, r820 feedback R8)", () => {
  it("starts filled in, takes the tour's name, and goes into the PDF", async () => {
    const { dom, panel } = wire({ tourTitle: () => "Harbour Lights" });
    panel.presentTour("https://h.example/t.zip");
    expect(dom.posterTitle.value).toBe("Harbour Lights");
    expect(dom.posterExplanation.value).toBe("AR tour starts here");
    expect(dom.posterCallToAction.value).toBe("Scan with your phone camera");
    dom.posterExplanation.value = "";
    dom.posterExplanation.fire("input");
    dom.pdfButton.fire("click");
    await settled(dom);
    expect(spies.pdfOptions.at(-1)).toMatchObject({
      poster: {
        title: "Harbour Lights",
        explanation: "",
        callToAction: "Scan with your phone camera",
      },
    });
  });

  // Printing before hosting (flows plan DEC-F2): no tour opens, the link
  // is typed into step 3 - the posters still carry the owner's wording
  // (found by the e2e, r821).
  it("starts with the default wording before any tour opens", () => {
    const { dom } = wire();
    expect(dom.posterExplanation.value).toBe("AR tour starts here");
    expect(dom.posterCallToAction.value).toBe("Scan with your phone camera");
    expect(dom.posterTitle.value).toBe("");
  });

  // The tour's name arrives with its manifest, after the open: it fills
  // the title then - unless the creator has typed one meanwhile.
  it("takes the tour's name when it arrives later, never over typed text", () => {
    let title: string | null = null;
    const { dom, panel } = wire({ tourTitle: () => title });
    panel.presentTour("https://h.example/t.zip");
    expect(dom.posterTitle.value).toBe("");
    title = "Harbour Lights";
    panel.presentCodes();
    expect(dom.posterTitle.value).toBe("Harbour Lights");

    const second = wire({ tourTitle: () => title });
    title = null;
    second.panel.presentTour("https://h.example/u.zip");
    second.dom.posterTitle.value = "Mine";
    second.dom.posterTitle.fire("input");
    title = "From the manifest";
    second.panel.presentCodes();
    expect(second.dom.posterTitle.value).toBe("Mine");
  });

  it("remembers what was typed for a tour and brings it back for that tour", () => {
    const store = memoryStore();
    const first = wire({ store, tourTitle: () => "Name" });
    first.panel.presentTour("https://h.example/t.zip");
    first.dom.posterTitle.value = "Hafenführung";
    first.dom.posterTitle.fire("input");

    const again = wire({ store, tourTitle: () => "Name" });
    again.panel.presentTour("https://h.example/t.zip");
    expect(again.dom.posterTitle.value).toBe("Hafenführung");
    again.panel.presentTour("https://h.example/other.zip");
    expect(again.dom.posterTitle.value).toBe("Name");
  });
});

describe("the link the codes carry (r820 feedback R4, R5)", () => {
  const ID = "1A4mU8eV16aaIvy6Msd76RC3_cbbftRkX";
  const BARE = `https://drive.google.com/file/d/${ID}`;
  const PHONE = `${BARE}/view?usp=drivesdk`;
  const DESKTOP = `${BARE}/view?usp=sharing`;

  it("prints a new tour's Drive link trimmed", async () => {
    const { dom, panel } = wire();
    panel.presentTour(PHONE);
    spies.planned.length = 0;
    dom.pdfButton.fire("click");
    await settled(dom);
    expect(new Set(spies.planned)).toEqual(new Set([BARE]));
  });

  // The owner's r820 case: the tour was measured from the phone's link and
  // is re-printed from the desktop's - the codes must match the posters on
  // the wall, numbered after them, with no warning.
  it("prints a measured tour in the spelling its codes were printed from", async () => {
    const plan =
      await import("gps-plus-slam-app-framework/utils/qr-payload/qr-print-plan");
    const { qrCodeId } =
      await import("gps-plus-slam-app-framework/utils/qr-payload/qr-code-id");
    const measured = [
      await qrCodeId((await plan.planPrintCode(PHONE, { codeIndex: 1 })).url),
    ];
    const { dom, panel } = wire({ measuredCodeIds: () => measured });
    panel.presentTour(DESKTOP);
    panel.presentCodes();
    await vi.waitFor(() => {
      expect(dom.codeInput.value).toBe("2");
    });
    // ...with no warning: the codes match (M0c review, finding 6c).
    await vi.waitFor(() => {
      expect(dom.info.textContent).not.toMatch(/Note:/);
    });
    spies.planned.length = 0;
    dom.pdfButton.fire("click");
    await settled(dom);
    expect(new Set(spies.planned)).toEqual(new Set([PHONE]));
  });

  // M0c review, finding 2: while the tour's codes are matched, the warning
  // would name the very problem R4 reported, and the PDF would print new
  // codes from 1. Both wait, and the button says why.
  it("holds the PDF while the tour's codes are being matched", async () => {
    const plan =
      await import("gps-plus-slam-app-framework/utils/qr-payload/qr-print-plan");
    const { qrCodeId } =
      await import("gps-plus-slam-app-framework/utils/qr-payload/qr-code-id");
    const measured = [
      await qrCodeId((await plan.planPrintCode(PHONE, { codeIndex: 1 })).url),
    ];
    const { dom, panel } = wire({ measuredCodeIds: () => measured });
    panel.presentTour(DESKTOP);
    panel.presentCodes();
    expect(dom.pdfButton.disabled).toBe(true);
    expect(dom.pdfButton.textContent).toMatch(/matching/i);
    await vi.waitFor(() => {
      expect(dom.pdfButton.disabled).toBe(false);
    });
    expect(dom.pdfButton.textContent).toBe("Download PDF to print");
    expect(dom.codeInput.value).toBe("2");
  });

  // M0c review, finding 1: after a tour from a FILE (no link), the print
  // step asks for a link again; the previous tour's spelling must not ride
  // along into the codes of the link the creator types.
  it("prints the typed link after a tour without one, never the previous tour's", async () => {
    const { dom, panel } = wire({ measuredCodeIds: () => ["some-id"] });
    panel.presentTour(PHONE);
    panel.presentNoTour();
    panel.presentCodes();
    dom.urlInput.value = "https://h.example/other.zip";
    dom.urlInput.fire("change");
    await new Promise((resolve) => setTimeout(resolve, 50));
    spies.planned.length = 0;
    dom.pdfButton.fire("click");
    await settled(dom);
    expect(new Set(spies.planned)).toEqual(
      new Set(["https://h.example/other.zip"]),
    );
  });
});

describe("no caption line under the codes (owner, on r821)", () => {
  // Why: the owner did not want "Code 2 - 18cm - print at 100%" on the
  // poster; the 10 cm bar carries the 100 % instruction and the file name
  // the code range. The band is given back to the layout.
  // The caption used to be where a test could read a poster's number;
  // the numbers now live only inside the codes, so the PDF's code numbers
  // are pinned here: a second run continues where the field says.
  it("builds the codes the code-number field and the count say", async () => {
    const { dom, panel } = wire();
    panel.presentTour("https://h.example/t.zip");
    dom.codeInput.value = "4";
    dom.countInput.value = "2";
    spies.indexes.length = 0;
    dom.pdfButton.fire("click");
    await settled(dom);
    expect(spies.indexes).toEqual([4, 5]);
  });

  it("builds the PDF with empty captions and no caption band", async () => {
    const { dom, panel } = wire();
    panel.presentTour("https://h.example/t.zip");
    spies.pdfCodes.length = 0;
    dom.pdfButton.fire("click");
    await settled(dom);
    expect(spies.pdfOptions.at(-1)).toMatchObject({ captionMm: 0 });
    const codes = spies.pdfCodes.at(-1) as { caption: string }[];
    expect(codes.length).toBe(3);
    expect(codes.every((code) => code.caption === "")).toBe(true);
  });
});

describe("the poster-count stepper (r820 feedback R7)", () => {
  it("counts up and down between 1 and 50", () => {
    const { dom } = wire();
    dom.countUp.fire("click");
    expect(dom.countInput.value).toBe("4");
    dom.countInput.value = "1";
    dom.countDown.fire("click");
    expect(dom.countInput.value).toBe("1");
    dom.countInput.value = "50";
    dom.countUp.fire("click");
    expect(dom.countInput.value).toBe("50");
    dom.countInput.value = "junk";
    dom.countUp.fire("click");
    expect(dom.countInput.value).toBe("2");
  });
});
