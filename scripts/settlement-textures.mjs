/* global console, fetch */
import { writeFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import sharp from 'sharp';

// Powered by Poly Haven. CC0 source: https://polyhaven.com/a/thatch_roof_angled
const response = await fetch('https://api.polyhaven.com/files/thatch_roof_angled');
if (!response.ok) throw new Error(`Texture metadata: ${response.status}`);
const files = await response.json();
for (const [key, suffix] of [['Diffuse', 'color'], ['nor_gl', 'normal']]) {
  const res = await fetch(files[key]['1k'].jpg.url);
  if (!res.ok) throw new Error(`Thatch ${suffix}: ${res.status}`);
  const buffer = await sharp(Buffer.from(await res.arrayBuffer())).resize(1024, 1024)
    .webp({ quality: suffix === 'normal' ? 95 : 88 }).toBuffer();
  await writeFile(`public/assets/textures/thatch_roof_angled_${suffix}.webp`, buffer);
  console.log(`Thatch ${suffix}: ${Math.round(buffer.length / 1024)} KiB`);
}
