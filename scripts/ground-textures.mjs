/* global fetch, console */
import { writeFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import sharp from 'sharp';

// 2K colour retains close-up detail; 1K normals and 512px roughness bound GPU memory.
for (const id of ['forest_ground_04', 'aerial_grass_rock', 'sparse_grass', 'brown_mud_dry']) {
  const response = await fetch(`https://api.polyhaven.com/files/${id}`);
  if (!response.ok) throw new Error(`Metadata ${id}: ${response.status}`);
  const files = await response.json();
  for (const [key, suffix, resolution, size] of [['Diffuse', 'color', '2k', 2048], ['nor_gl', 'normal', '1k', 1024], ['Rough', 'roughness', '1k', 512]]) {
    const res = await fetch(files[key][resolution].jpg.url);
    if (!res.ok) throw new Error(`Texture ${id} ${key}: ${res.status}`);
    const buffer = await sharp(Buffer.from(await res.arrayBuffer())).resize(size, size).webp({ quality: key === 'nor_gl' ? 95 : 90 }).toBuffer();
    const path = `public/assets/textures/${id}_surface_${suffix}.webp`;
    await writeFile(path, buffer);
    console.log(`${path}: ${Math.round(buffer.length / 1024)} KiB`);
  }
}
