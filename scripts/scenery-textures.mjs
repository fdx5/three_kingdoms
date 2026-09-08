/* global fetch, console */
import { writeFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import sharp from 'sharp';

// CC0 sources and authors are documented in public/assets/textures/SOURCES.md.
for (const id of ['bark_brown_02', 'rock_boulder_dry']) {
  const response = await fetch(`https://api.polyhaven.com/files/${id}`);
  if (!response.ok) throw new Error(`Texture metadata: ${response.status}`);
  const files = await response.json();
  for (const [key, suffix] of [['Diffuse', 'color'], ['nor_gl', 'normal'], ['Rough', 'roughness']]) {
    const file = files[key]['1k'].jpg;
    const res = await fetch(file.url);
    if (!res.ok) throw new Error(`Texture download: ${res.status}`);
    const buffer = await sharp(Buffer.from(await res.arrayBuffer())).webp({ quality: key === 'nor_gl' ? 95 : 88 }).toBuffer();
    const path = `public/assets/textures/${id}_${suffix}.webp`;
    await writeFile(path, buffer);
    console.log(`${path}: ${Math.round(buffer.length / 1024)} KiB`);
  }
}
