# Vegetation sources

Downloaded 2026-09-09 from Poly Haven. Assets are CC0 1.0:
https://polyhaven.com/license

- `scenery_tree_small_02.glb`: [Tree Small 02](https://polyhaven.com/a/tree_small_02), Rico Cilliers.
- `scenery_pine_sapling_small.glb`: [Pine Sapling Small](https://polyhaven.com/a/pine_sapling_small).

Rebuild: `node scripts/import-vegetation.mjs` (Powered by Poly Haven).
Original glTF, buffers and textures are cached in ignored `img/vegetation/`.
Wood geometry is simplified with Meshoptimizer. Tree Small 02's original leaf
distribution seeds 480 leaf-branch cards using its original diffuse, normal,
roughness and alpha maps; no black-color threshold or opaque leaf rectangles.
Textures are embedded at 1K in WebP. Final trees contain 1,945 and 9,094 triangles.
The game instances their primitives and keeps registry textures shared.
