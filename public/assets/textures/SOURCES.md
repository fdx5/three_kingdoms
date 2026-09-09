# Scenery PBR materials

## Building surfaces (2026-09-09)

- `wood_planks_grey_*`: [Wood Planks Grey](https://polyhaven.com/a/wood_planks_grey), Rob Tuytel, CC0.
- `plastered_wall_*`: [Plastered Wall](https://polyhaven.com/a/plastered_wall), CC0.

`node scripts/building-textures.mjs` downloads the 1K diffuse, OpenGL normal and
roughness maps and converts them to WebP. Used on settlement timber and plaster.
Powered by Poly Haven; https://polyhaven.com/license.

Downloaded from Poly Haven on 2026-09-08, under CC0 1.0:

- `bark_brown_02_*.webp`: [Bark Brown 02](https://polyhaven.com/a/bark_brown_02), Rob Tuytel.
- `rock_boulder_dry_*.webp`: [Rock Boulder Dry](https://polyhaven.com/a/rock_boulder_dry), photography by Dimitrios Savva, processing by Rico Cilliers.

The 1024×1024 diffuse, OpenGL normal and roughness maps are converted to WebP by
`scripts/scenery-textures.mjs` (normal quality 95, other maps 88). No displacement
map is used: texture relief must not raise terrain or obstruct gameplay.

License: https://polyhaven.com/license

## Settlement roofs

- `thatch_roof_angled_*.webp`: [Thatch Roof Angled](https://polyhaven.com/a/thatch_roof_angled), photography by Dimitrios Savva, processing by Rob Tuytel. CC0.

Downloaded on 2026-09-08. `scripts/settlement-textures.mjs` converts the 1K
diffuse and OpenGL normal maps to 1024×1024 WebP (quality 88 and 95).
Used on thatched homes and granaries; no displacement map is used.

## Ground surface upgrade

- `forest_ground_04_surface_*`: https://polyhaven.com/a/forest_ground_04 — Rob Tuytel, minor adjustment by Rico Cilliers.
- `aerial_grass_rock_surface_*`: https://polyhaven.com/a/aerial_grass_rock — Rob Tuytel.
- `sparse_grass_surface_*`: https://polyhaven.com/a/sparse_grass — Amal Kumar.
- `brown_mud_dry_surface_*`: https://polyhaven.com/a/brown_mud_dry — Rob Tuytel.

All four are CC0. `scripts/ground-textures.mjs` downloads 2K diffuse and 1K
OpenGL normal maps, downsamples roughness to 512×512, and encodes WebP at
quality 90 (normals 95). Texture displacement is not used. High quality adds
aligned stochastic sampling, grass coverage blending and half-resolution GTAO;
low and medium quality retain the direct PBR material without these passes.
