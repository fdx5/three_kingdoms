# Scenery PBR materials

Downloaded from Poly Haven on 2026-09-08, under CC0 1.0:

- `bark_brown_02_*.webp`: [Bark Brown 02](https://polyhaven.com/a/bark_brown_02), Rob Tuytel.
- `rock_boulder_dry_*.webp`: [Rock Boulder Dry](https://polyhaven.com/a/rock_boulder_dry), photography by Dimitrios Savva, processing by Rico Cilliers.

The 1024×1024 diffuse, OpenGL normal and roughness maps are converted to WebP by
`scripts/scenery-textures.mjs` (normal quality 95, other maps 88). No displacement
map is used: texture relief must not raise terrain or obstruct gameplay.

License: https://polyhaven.com/license

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
