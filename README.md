# Location-Based WebXR

**Stable outdoor AR in the browser — no native app, no VPS, no signup, not even internet required**

Three.js + GPS + WebXR sensor fusion that keeps 3D content pinned to real-world coordinates as the user walks.

[![npm version](https://img.shields.io/npm/v/gps-plus-slam-app-framework.svg)](https://www.npmjs.com/package/gps-plus-slam-app-framework)
[![npm downloads](https://img.shields.io/npm/dm/gps-plus-slam-app-framework.svg)](https://www.npmjs.com/package/gps-plus-slam-app-framework)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen.svg)](https://nodejs.org/)

<p align="center">
  <a href="https://gps.csutil.com"><strong>Live Demos & Examples →</strong></a>
</p>

---

- Build **outdoor AR apps** like navigation, GPS-anchored scavenger hunts, location-triggered tour guides, ... in the browser -> accurate AR content without the need of an native app or VPS service or requiring the user to be online at all.

- Provides a **client-side sensor fusion** pipeline that incrementally refines a GPS-to-AR alignment matrix using outlier-rejected observations. If you want to build any kind of game or experience tied to physical locations, this gives you stable world-anchored coordinates in a web browser.

- A composable Redux-based app framework where you plug in extraReducers and a storage backend, and it handles WebXR sessions, GPS sensors, recording, and replay out of the box.

- Ship location-based AR experiences as progressive web apps — no App Store review, no native SDK dependency, and a free community license key with zero signup

## What You Can Build With It

- **Outdoor AR navigation** — arrows and waypoints anchored to real-world GPS coordinates.
- **GPS-anchored 3D content** — drop persistent 3D objects at lat/lon and have them stay put as the user walks.
- **AR tour guides and museum trails** — content keyed to location, surfaced when the user is nearby.
- **Location-based games** — geocaching, scavenger hunts, multi-player AR experiences tied to physical places.
- **Field-data capture tools** — record GPS, AR poses, camera frames, and depth for later analysis or ML training.

## How It Works: Sensor Fusion & Outdoor Stability

A common assumption is that markerless WebXR will drift badly or make content "jump" in large, visually uniform outdoor spaces (open parks, grass fields), because classic visual SLAM leans on camera feature points that are sparse there. It's worth being precise about which layer does what, so you can judge whether this fits your use case:

- **Visual-inertial tracking is handled by the WebXR runtime (ARCore/ARKit), not by this library.** The device's own AR stack already fuses the camera with the IMU to produce local 6-DoF odometry, which stays usable through short stretches of sparse visual features. This framework **consumes** that odometry rather than re-implementing it.
- **What this framework adds is GPS↔AR alignment.** `gps-plus-slam-js` continuously aligns the local AR odometry with GPS, refining the fit **live as the user moves** rather than re-snapping, so placed content does not teleport on every GPS update. Placement helpers (`createGpsAnchor`) can even defer small corrections until an object is off-screen, while still correcting if alignment drifts far enough that content would otherwise be left in a stale spot.
- **Accuracy is sub-meter, not centimeter — and it improves with motion.** After roughly 15 seconds of walking in representative outdoor conditions, visible drift typically drops well below raw GPS and the fusion is what keeps locally-placed content sitting on its spot as the user walks around it.

This makes the framework well-suited to large-scale outdoor AR — a walking trail with arrows pointing the way, treasure-hunt markers hidden around a field, or info labels pinned to statues and buildings — provided you treat global placement as GPS-accurate and local stability as motion-dependent rather than guaranteed. For the full rationale, caveats, and the VPS-free positioning model, see the [framework's "Why use GPS+SLAM?" section](GpsPlusSlamJs_AppFramework/README.md). The fastest way to evaluate it is to open an example URL on your phone, step outside, drop an object, and walk around it.

## Architecture

```
┌──────────────────────────────────────────────────┐
│  Your App                                        │
│  (UI, screen flow, app-specific reducers)        │
├──────────────────────────────────────────────────┤
│  gps-plus-slam-app-framework   ← this repo       │
│  (WebXR, Three.js, sensors, storage, replay,     │
│   composable store factory with extension hooks) │
├──────────────────────────────────────────────────┤
│  gps-plus-slam-js              (npm package)     │
│  (GPS/AR alignment, outlier rejection, GPS math) │
└──────────────────────────────────────────────────┘
```

Your app composes its own state, screen flow, and visuals on top of the framework via `createSlamAppStore({ extraReducers, extraMiddleware, storageBackend })`. The framework never imports from your app, and the closed-source core never imports from the framework.

## Packages

| Package                                                     | Description                                                                                                                               | License    |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| [`GpsPlusSlamJs_AppFramework`](GpsPlusSlamJs_AppFramework/) | Reusable AR+GPS app framework — WebXR session management, Three.js visualization, GPS sensors, OPFS+ZIP record/replay, composable store. | Apache-2.0 |
| [`GpsPlusSlamJs_RecorderApp`](GpsPlusSlamJs_RecorderApp/)   | Full-featured recorder app: capture AR sessions on a phone, replay on a desktop, debug alignment, and contribute test data.              | Apache-2.0 |
| [`GpsPlusSlamJs_AnchorStarter`](GpsPlusSlamJs_AnchorStarter/) | Persistent-anchor starter (the public "Demo"). GPS-anchored placement with URL-based persistence (`?show=`) and cross-device sharing.   | Apache-2.0 |
| [`GpsPlusSlamJs_MinimalExample`](GpsPlusSlamJs_MinimalExample/) | Smallest possible consumer of the framework. A single-file GPS + AR hit-test demo (Enable GPS AR button → reticle → tap-to-place) that contrasts an uncompensated floater cube with a drift-corrected `createGpsAnchor` marker. Use this as your starting template. | Apache-2.0 |

The recorder app at a glance:

- Records WebXR AR poses, GPS positions, optional camera frames, and optional depth samples.
- Exports the session as a self-contained ZIP file you can email, version-control, or share.
- Replays the ZIP on a desktop with full 3D scene reconstruction for inspection and debugging.

## About the Core Library

The core alignment library ([`gps-plus-slam-js`](https://www.npmjs.com/package/gps-plus-slam-js)) is **closed-source** and distributed via npm under a proprietary license (EULA). It provides:

- **Sub-meter positioning** — fuses high-frequency AR odometry with noisy GPS.
- **Fully offline** — all computation runs on-device, no network requests.
- **Framework-agnostic** — pure TypeScript with a Redux-based state store. 
- **Incremental alignment** — the alignment matrix updates live as new observations arrive.

A free license key is bundled with the framework, so you can start building right away — no signup or API key request process required, see the [EULA](https://www.npmjs.com/package/gps-plus-slam-js) for further details on how it works. The key is updated every time a new framework version is released and it's valid for a year so that updating to the latest framework version automatically updates to a new license key as well. 

## Quick Start: Try the Recorder

> **Live demo:** the apps are deployed at **<https://gps.csutil.com>** — a
> landing page links to the **Demo** (persistent-anchor starter, `/starter/`)
> and the **Example app to evaluate the tracking accuracy** (the recorder,
> `/recorder/`). Open it on a WebXR-capable phone.

## Quick Start: Build Your Own App

Install the framework and core library:

```bash
pnpm add gps-plus-slam-app-framework gps-plus-slam-js
```

```ts
import { createSlamAppStore } from 'gps-plus-slam-app-framework/state';
import { initAR } from 'gps-plus-slam-app-framework/ar';
import { startGpsWatch } from 'gps-plus-slam-app-framework/sensors';
import { NullStorageBackend } from 'gps-plus-slam-app-framework/storage';

// 1. Compose the store. Use OpfsStorageBackend for durable recording.
const store = createSlamAppStore({
  storageBackend: new NullStorageBackend(),
});

// 2. Start the WebXR AR session.
await initAR(document.getElementById('app')!);

// 3. Wire GPS into the store.
startGpsWatch(
  (pos) => {
    /* dispatch into store */
  },
  (err) => {
    /* handle error */
  }
);
```

> See [`GpsPlusSlamJs_MinimalExample`](GpsPlusSlamJs_MinimalExample/) for a full, end-to-end runnable example (GPS + AR hit-test session with tap-to-place). For the full API surface and the composable extension hooks (`extraReducers`, `extraMiddleware`, `ZipExportContributor`), see the [framework README](GpsPlusSlamJs_AppFramework/README.md).

## Repository Layout

| Folder                                                      | Purpose                                                       |
| ----------------------------------------------------------- | ------------------------------------------------------------- |
| [`GpsPlusSlamJs_AppFramework/`](GpsPlusSlamJs_AppFramework/) | The reusable framework (npm package).                         |
| [`GpsPlusSlamJs_RecorderApp/`](GpsPlusSlamJs_RecorderApp/)   | The reference recorder app (Vite + Playwright).               |
| [`GpsPlusSlamJs_AnchorStarter/`](GpsPlusSlamJs_AnchorStarter/) | Persistent-anchor starter example (the public "Demo").       |
| [`GpsPlusSlamJs_MinimalExample/`](GpsPlusSlamJs_MinimalExample/) | Smallest possible framework consumer.                     |
| [`GpsPlusSlamJs_Landing/`](GpsPlusSlamJs_Landing/)          | Static landing page served at the deployment root.            |
| `signatures/`                                               | License-key public signatures for the closed-source core.     |
| `tests/`                                                    | Repo-config integration tests (workspace cohesion checks).    |

## Build the Framework from Source

```bash
pnpm --filter gps-plus-slam-app-framework build
```

## Deployment (gps.csutil.com)

All public surfaces share one origin and are built into a single `dist-site/`
directory served by Cloudflare static assets:

```bash
pnpm run build:site   # framework + recorder (/recorder/) + starter (/starter/) + minimal (/minimal/) + landing (/)
```

- `/` → landing page ([`GpsPlusSlamJs_Landing/`](GpsPlusSlamJs_Landing/))
- `/recorder/` → recorder app, built with `base=/recorder/`
- `/starter/` → anchor starter, built with `base=/starter/`
- `/minimal/` → minimal example, built with `base=/minimal/`

The Cloudflare Git integration runs `pnpm run build:site` and serves `./dist-site`
(see [`wrangler.toml`](wrangler.toml)). The orchestration script
([`scripts/build-site.mjs`](scripts/build-site.mjs)) asserts every built URL
resolves under its app's base so a misrouted asset fails the deploy instead of
404-ing in production.

## Run Tests

```bash
# All tests (repo-config + framework + recorder unit & E2E + anchor starter + minimal example)
pnpm test

# Framework tests only
pnpm run test:framework

# Recorder unit tests only
pnpm run test:recorder:unit

# Recorder E2E tests only
pnpm run test:recorder:e2e

# Anchor-starter tests only
pnpm run test:starter

# Minimal-example tests only
pnpm run test:example
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, coding standards, and the pull request process.

## License

The framework, recorder app, and minimal example are licensed under the [Apache License 2.0](LICENSE).

The `gps-plus-slam-js` library used by the framework has a proprietary license, see its [EULA](https://www.npmjs.com/package/gps-plus-slam-js) for details.
