import { parseArgs } from "node:util"

import * as esbuild from "esbuild"

/**
 * Bundles the main and preload entry points into `dist-electron/`.
 *
 * Bundling rather than plain `tsc` is what lets the preload script stay
 * sandboxed: a sandboxed preload cannot `require` a relative file, so the
 * shared API contract has to be inlined into it. `electron` and Node builtins
 * stay external — they are provided by the runtime.
 *
 *   node scripts/build-electron.mjs [--watch] [--minify]
 */
const { values } = parseArgs({
  options: {
    watch: { type: "boolean", default: false },
    minify: { type: "boolean", default: false },
  },
})

/** @type {import("esbuild").BuildOptions} */
const options = {
  entryPoints: {
    main: "src/main/main.ts",
    preload: "src/preload/index.ts",
    // The agent daemon: a separate process (see src/main/daemon.ts), so it
    // gets its own bundle rather than living inside main.cjs.
    daemon: "src/main/daemon.ts",
  },
  outdir: "dist-electron",
  bundle: true,
  platform: "node",
  target: "node22",
  // Electron loads these as CommonJS; `__dirname` in main.ts depends on it.
  // The package is `"type": "module"`, so the extension — not the format — is
  // what Node believes: a `.js` file here would be loaded as ESM and fail on
  // the first `require`.
  format: "cjs",
  outExtension: { ".js": ".cjs" },
  // All three stay real dependencies resolved from node_modules rather than
  // being inlined: node-pty loads a prebuilt native binary, and pg/mysql2
  // both carry optional native/dynamic requires (pg-native, pg-cloudflare)
  // that esbuild cannot statically resolve.
  external: ["electron", "@lydell/node-pty", "pg", "mysql2"],
  // The Settings item's icon travels inside the bundle as a data URL rather
  // than as a file read at runtime: `resources/` is not packaged — `files` in
  // package.json is `dist-electron` and `dist-renderer` — so a path would
  // resolve in dev and be missing from a built app.
  loader: { ".png": "dataurl" },
  sourcemap: true,
  minify: values.minify,
  logLevel: "info",
}

if (values.watch) {
  const context = await esbuild.context(options)
  await context.watch()
} else {
  await esbuild.build(options)
}
