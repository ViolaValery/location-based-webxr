// @ts-check
import { expect, test } from "@playwright/test";
import {
  TextReader,
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipWriter,
} from "@zip.js/zip.js";
import {
  createEmptyTourManifest,
  serializeTourManifest,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { qrCodeId } from "gps-plus-slam-app-framework/utils/qr-payload/qr-code-id";

/**
 * Why these tests matter (Tour Viewer M6 E1): the desktop editor opens a
 * file anyone can make and draws it on a map. These drive the REAL file
 * chooser and check what a creator sees: every code and note listed and on
 * the map, the card beside the selected marker and inside the free part of
 * the window, a photo shown from the zip and an oversized one refused, a
 * label carrying markup shown as text (never run), a zip that is not a tour
 * refused in words, and the chosen layout (variant 1: the rail on the left
 * under the top bar) at a phone, a phone sideways and a desktop.
 */

/** 1x1 red PNG, a real decodable image. */
const TINY_PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  ),
  (c) => /** @type {number} */ (c.codePointAt(0)),
);

/** The same PNG whose header claims 5000 x 5000 px: over the tour cap,
 *  refused by its header before any decode. */
function oversizedPng() {
  const bytes = TINY_PNG.slice();
  const view = new DataView(bytes.buffer);
  view.setUint32(16, 5000);
  view.setUint32(20, 5000);
  return bytes;
}

const AT = { lat: 48.5203, lon: 9.0536, alt: 340 };
const MARKUP = '<img src=x onerror="window.__xss=1">Town hall';

/** @param {number} north @param {number} east */
function geo(north, east) {
  return {
    lat: AT.lat + north / 111_320,
    lon: AT.lon + east / 73_800,
    alt: AT.alt,
  };
}

/** @param {{path: string, data: string | Uint8Array}[]} entries */
async function zip(entries) {
  const writer = new ZipWriter(new Uint8ArrayWriter());
  for (const e of entries) {
    await writer.add(
      e.path,
      typeof e.data === "string"
        ? new TextReader(e.data)
        : new Uint8ArrayReader(e.data),
    );
  }
  return Buffer.from(await writer.close());
}

async function editorTour() {
  const codes = [];
  for (const [i, place] of [geo(0, 0), geo(30, 40)].entries()) {
    const id = await qrCodeId(
      `https://gps.csutil.com/tour/?qr=editor&n=${i + 1}`,
    );
    codes.push({
      path: `qr/${id}.json`,
      data: JSON.stringify({
        version: 1,
        qr: { physicalSizeM: 0.2, geo: { ...place, headingDeg: 90 } },
      }),
    });
  }
  // Through the serializer: a title needs tour.json version 2.
  const manifest = {
    ...createEmptyTourManifest(),
    title: "Editor fixture",
    objects: [
      {
        id: "pin-markup",
        kind: "pin",
        label: MARKUP,
        createdAtIso: "2026-10-13T00:00:00.000Z",
        geo: { ...geo(10, 10), headingDeg: 0 },
      },
      {
        id: "photo-ok",
        kind: "photo",
        label: "Fountain",
        image: "content/photo-ok.png",
        imageWidth: 1,
        imageHeight: 1,
        createdAtIso: "2026-10-13T00:00:00.000Z",
        geo: { ...geo(-10, 20), rotation: [0, 0, 0, 1] },
      },
      {
        id: "photo-big",
        kind: "photo",
        label: "Too big",
        image: "content/photo-big.png",
        imageWidth: 1,
        imageHeight: 1,
        createdAtIso: "2026-10-13T00:00:00.000Z",
        geo: { ...geo(20, -20), rotation: [0, 0, 0, 1] },
      },
    ],
  };
  return zip([
    { path: "tour.json", data: serializeTourManifest(manifest) },
    ...codes,
    { path: "content/photo-ok.png", data: TINY_PNG },
    { path: "content/photo-big.png", data: oversizedPng() },
  ]);
}

/** @param {import("@playwright/test").Page} page */
async function answerTiles(page) {
  await page.route("https://tile.openstreetmap.org/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/png",
      body: Buffer.from(TINY_PNG),
    }),
  );
}

/**
 * Open `buffer` through the real file chooser.
 * @param {import("@playwright/test").Page} page
 * @param {Buffer} buffer
 * @param {string} name
 */
async function openThroughChooser(page, buffer, name) {
  const chooser = page.waitForEvent("filechooser");
  await page.locator("#drop").click();
  await (await chooser).setFiles({ name, mimeType: "application/zip", buffer });
}

/** @param {import("@playwright/test").Locator} locator */
async function box(locator) {
  const b = await locator.boundingBox();
  if (b === null) throw new Error("not laid out");
  return b;
}

test.beforeEach(async ({ page }) => {
  await answerTiles(page);
});

test("opens a tour through the file chooser and lists every code and note, labels as text", async ({
  page,
}) => {
  await page.goto("/edit.html");
  await expect(page.locator("#open-modal")).toBeVisible();
  await openThroughChooser(page, await editorTour(), "editor-fixture.zip");
  await expect(page.locator(".toast")).toHaveText(
    "Opened editor-fixture.zip: 2 codes, 3 notes",
  );
  await expect(page.locator("#open-modal")).toBeHidden();
  await expect(page.locator("#tour-name")).toHaveText("Editor fixture");
  const titles = page.locator("#rail .row-title");
  await expect(titles).toHaveText([
    "Code 1",
    "Code 2",
    MARKUP,
    "Fountain",
    "Too big",
  ]);
  await expect(page.locator(".mk-wrap")).toHaveCount(5);
  // The markup is text: no element was made from it, nothing ran.
  await expect(page.locator("#rail img")).toHaveCount(0);
  expect(await page.evaluate(() => "__xss" in window)).toBe(false);
});

test("a row opens the card beside its marker, with the photo from the zip, and Esc closes it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/edit.html");
  await openThroughChooser(page, await editorTour(), "editor-fixture.zip");
  await page.locator("#rail .row", { hasText: "Fountain" }).click();
  const card = page.locator("#card");
  await expect(card).toBeVisible();
  await expect(card.locator("img.card-photo")).toBeVisible();
  await expect(card).toContainText("0.1-0.7 m near a code");
  const rail = await box(page.locator("#rail"));
  const cardBox = await box(card);
  const marker = await box(page.locator(".mk-wrap.sel"));
  // Inside the free part: right of the rail, under the top bar.
  expect(cardBox.x).toBeGreaterThanOrEqual(rail.x + rail.width);
  expect(cardBox.y).toBeGreaterThanOrEqual(80);
  // Beside its marker: the card's near edge within 40 px of the marker.
  const nearEdge =
    cardBox.x > marker.x
      ? cardBox.x - (marker.x + marker.width)
      : marker.x - (cardBox.x + cardBox.width);
  expect(Math.abs(nearEdge)).toBeLessThan(40);
  await page.keyboard.press("Escape");
  await expect(card).toBeHidden();
  await expect(page.locator(".mk-wrap.sel")).toHaveCount(0);
});

test("refuses a photo over the tour's size cap with a line, not a decode", async ({
  page,
}) => {
  await page.goto("/edit.html");
  await openThroughChooser(page, await editorTour(), "editor-fixture.zip");
  await page.locator("#rail .row", { hasText: "Too big" }).click();
  await expect(page.locator("#card .note-line.error")).toContainText(
    "This photo is not shown",
  );
  await expect(page.locator("#card img")).toHaveCount(0);
});

test("refuses a zip that is not a tour in words, and stays on the open dialog", async ({
  page,
}) => {
  await page.goto("/edit.html");
  await openThroughChooser(
    page,
    await zip([{ path: "session.json", data: "{}" }]),
    "recording.zip",
  );
  await expect(page.locator("#open-error")).toHaveText(
    /This file is not a tour/,
  );
  await expect(page.locator("#open-modal")).toBeVisible();
  await expect(page.locator("#rail")).toBeHidden();
});

for (const viewport of [
  { width: 1280, height: 800, collapsed: false },
  { width: 844, height: 390, collapsed: false },
  { width: 390, height: 844, collapsed: true },
]) {
  test(`keeps the chosen layout at ${viewport.width}x${viewport.height}: the rail on the left under the top bar`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/edit.html");
    await openThroughChooser(page, await editorTour(), "editor-fixture.zip");
    // The open is async ("Opening…"): measure once the tour is drawn.
    await expect(page.locator("#rail")).toBeVisible();
    const top = await box(page.locator("#topbar"));
    const rail = await box(page.locator("#rail"));
    expect(top.x).toBe(12);
    expect(top.y).toBe(12);
    expect(top.width).toBe(viewport.width - 24);
    expect(rail.x).toBe(12);
    expect(rail.y).toBe(top.y + top.height + 12);
    // The prototype collapses the rail on a narrow window.
    expect(rail.width).toBe(
      viewport.collapsed ? 58 : viewport.width <= 980 ? 252 : 304,
    );
    // Nothing wider than the window.
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(viewport.width);
  });
}

test("the sample tour opens with its story's stations on the map", async ({
  page,
}) => {
  // Why: "Use the sample tour" is the first thing a visitor of the page
  // tries; the sample is a story tour with stations only, and an editor
  // that listed only codes and notes opened it as an empty world map.
  await page.goto("/edit.html");
  await page.locator("#sample-btn").click();
  await expect(page.locator(".toast")).toHaveText(
    "Opened marienplatz-tour.zip: 0 codes, 0 notes, 3 stations",
  );
  await expect(page.locator("#rail .row-title")).toHaveText([
    "The column",
    "The old gate",
    "The town hall steps",
  ]);
  await expect(page.locator(".mk-station")).toHaveCount(3);
});
