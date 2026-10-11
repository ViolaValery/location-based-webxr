# Tour Viewer design prototypes (throwaway)

Standalone HTML drafts for the owner to choose a direction from (polish
round M1; the rule: root `CLAUDE.md` "Throwaway UX prototypes"). They are
served at `/tour/prototypes/` on a branch preview, linked from nothing in
the app, and NOT wired into its logic: every interaction is faked.

- `index.html` - the list.
- The setup-page (`landing-*`) and HUD (`hud-*`) drafts were removed after
  the owner's verdict (L5 and H1); they remain in git history on r815.
- `scan-1-centre-card/`, `scan-2-viewfinder/`, `scan-3-coach-mark/` - the
  visitor's scan overlay.

**Removed before they reach `main`:** delete this folder in the PR that
follows the owner's verdict, and in any case before a `main` merge. The
verdict goes into the polish-round plan (private docs).

**What goes with them:** the `public/prototypes/` lines in the package's
`.prettierignore` and `.stylelintignore` (the `landing-5-map-path` entry
of `tests/repo-config/slider-pages-load-the-guard.test.js` went with that draft). The
drafts are not held to the app's lint and format rules.

**Owner rule applied after the build:** the three HUD drafts first blocked
placing until the code was measured; that contradicts the owner's rule of
2026-10-09 (placing never depends on a code) and was lifted.
