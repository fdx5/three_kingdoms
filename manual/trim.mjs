/** 투명 여백을 잘라 낸다 — 레이아웃이 프레임을 정하게 하려고. */
import sharp from 'sharp';
/* global console, process */
import { readdirSync } from 'node:fs';

for (const name of readdirSync('manual/img').filter((f) => f.endsWith('.png'))) {
  const p = `manual/img/${name}`;
  const img = sharp(p);
  const { width, height } = await img.metadata();
  const box = await img.trim({ threshold: 1 }).toBuffer({ resolveWithObject: true }).catch(() => null);
  if (!box) { console.log('skip', name); continue; }
  await sharp(box.data).toFile(p.replace('.png', '.trim.png'));
  process.stdout.write(`${name} ${width}x${height} → ${box.info.width}x${box.info.height}\n`);
}
