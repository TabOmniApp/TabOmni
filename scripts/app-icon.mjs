// Derives resources/icon.png from the designer's export in resources/icon-source.png.
//
// It exists because electron-builder does not letterbox: it resizes whatever
// PNG it is handed to a square 1024, so a 1536×1024 export came out of the
// build squashed by a third along one axis. The export is also mostly empty —
// the mark occupied 707×626 of that frame — which no amount of squaring alone
// would fix, since the icon would then sit small inside its own tile next to
// every other icon in the Dock.
//
// So: crop to what is actually drawn, then place it on the macOS icon grid.
//
//   bun scripts/app-icon.mjs

import { readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"
import console from "node:console"
import { Buffer } from "node:buffer"
import { decodePng, encodePng, alphaBounds, crop, resize } from "./png.mjs"

const CANVAS = 1024

// Apple's macOS icon grid: the artwork lives in a 824×824 area centred in a
// 1024 tile, and the surrounding margin is what keeps icons optically the same
// size in the Dock whatever their silhouette. A freeform mark like this one
// fills the box rather than sitting in a rounded-rect plate.
const CONTENT = 824

const buildDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "resources"
)
const sourceFile = path.join(buildDir, "icon-source.png")
const outFile = path.join(buildDir, "icon.png")

const source = decodePng(readFileSync(sourceFile))

// Above 1, not above 0. The export carries a ~16k pixel halo at alpha 1 —
// a 0.4%-opacity ghost of a glow that is not visible on any background but
// stretches the bounding box to 1273×955, which would shrink the mark itself
// to little over half the tile. From alpha 2 up through 8 the box is stable at
// 712×632, so the cut is nowhere near the mark's own antialiasing.
const bounds = alphaBounds(source, 1)
const mark = crop(source, bounds)

const scale = CONTENT / Math.max(mark.width, mark.height)
const width = Math.round(mark.width * scale)
const height = Math.round(mark.height * scale)
const scaled = resize(mark, width, height)

const pixels = Buffer.alloc(CANVAS * CANVAS * 4)
const left = Math.round((CANVAS - width) / 2)
const top = Math.round((CANVAS - height) / 2)
for (let y = 0; y < height; y++) {
  const from = y * width * 4
  scaled.pixels.copy(
    pixels,
    ((top + y) * CANVAS + left) * 4,
    from,
    from + width * 4
  )
}

writeFileSync(outFile, encodePng({ width: CANVAS, height: CANVAS, pixels }))

console.log(
  `${outFile}  ${CANVAS}×${CANVAS}  ` +
    `(mark ${bounds.width}×${bounds.height} at ${bounds.x},${bounds.y} → ${width}×${height})`
)
