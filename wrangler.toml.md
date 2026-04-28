# `wrangler.toml`

## Purpose

Cloudflare Workers config used by the Cloudflare Git integration to deploy the
RecorderApp as a static site. Without this file, the deploy step
(`npx wrangler versions upload`) fails with **"Missing entry-point to Worker
script or to assets directory"** because Wrangler 4.x has no implicit default.

## Public API

Not applicable — declarative config consumed by Cloudflare's build pipeline.

## Invariants & assumptions

- `name` matches the Cloudflare Workers project (`gps-plus-slam`).
- `[assets].directory` points at the RecorderApp's Vite build output
  (`GpsPlusSlamJs_RecorderApp/dist`). The path is relative to this file
  (repo root). Build command (`pnpm run build:recorder`) must populate this
  directory before deploy.
- `compatibility_date` is bumped to deploy date when Cloudflare APIs change;
  no behaviour depends on it for a pure static-asset site.
- No Worker script (`main`) — assets-only deployment.
- Observability is mostly off; logs are persisted for post-deploy debugging.

## History

- Originally lived in the private `gps-plus-slam` repo.
- Deleted from both repos during the public-repo split (see
  `2026-03-30-separate-public-repo-plan.md` §4.3) under the assumption that
  Cloudflare's Git integration would auto-detect the assets directory. That
  assumption was wrong — `wrangler versions upload` (the deploy step run by
  the integration) requires explicit config, so this file was restored.

## Tests

Verified end-to-end by a successful Cloudflare deployment from a PR build.
No unit-test coverage applicable.
