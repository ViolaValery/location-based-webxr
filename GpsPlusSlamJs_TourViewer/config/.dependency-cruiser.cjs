/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  options: {
    doNotFollow: { path: "node_modules" },
    includeOnly: "src",
    reporterOptions: { dot: { collapsePattern: "node_modules/[^/]*" } },
  },
  forbidden: [
    // Catch typos in import paths (unresolvable specifiers)
    {
      name: "not-to-unresolvable",
      severity: "error",
      from: {},
      to: { couldNotResolve: true },
    },

    // No circular dependencies (component dependency loops)
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true },
    },

    // The desktop editor (`src/editor/`, its own page) imports Leaflet
    // statically; the visitor page must never reach it, or every visitor
    // downloads the map library. `summary-map-lazy.test.ts` scans only the
    // top level of `src/`, so this rule closes the gap (M6 E1 plan review
    // #5).
    {
      name: "viewer-not-to-editor",
      severity: "error",
      from: { path: "^src/[^/]+\\.ts$", pathNot: "\\.test\\.ts$" },
      to: { path: "^src/editor/" },
    },
  ],
};
