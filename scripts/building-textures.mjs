/* global fetch, console */
import { writeFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import sharp from 'sharp';

// Powered by Poly Haven. CC0 sources: public/assets/textures/SOURCES.md.
for (const id of ['wood_planks_grey', 'plastered_wall']) {
  const metadata = await fetch(`https://api.polyhaven.com/files/${id}`);
  if (!metadata.ok) throw new Error(`${id}: ${metadata.status}`);
  const files = await metadata.json();
  for (const [key, suffix] of [['Diffuse', 'color'], ['nor_gl', 'normal'], ['Rough', 'roughness']]) {
    const response = await fetch(files[key]['1k'].jpg.url);
    if (!response.ok) throw new Error(`${id}/${key}: ${response.status}`);
    const output = await sharp(Buffer.from(await response.arrayBuffer())).webp({ quality: key === 'nor_gl' ? 95 : 88 }).toBuffer();
    await writeFile(`public/assets/textures/${id}_${suffix}.webp`, output);
    console.log(`${id} ${suffix}: ${output.length} bytes`);
  }
}
