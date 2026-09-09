/* global fetch, console */
import { mkdir, writeFile, stat, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Buffer } from 'node:buffer';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, weld, simplify, prune, textureCompress } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import * as THREE from 'three';

async function branchCards(document, primitive, alphaImage) {
  const source = primitive.getAttribute('POSITION');
  const material = primitive.getMaterial();
  const texture = material.getBaseColorTexture();
  const { data, info } = await sharp(Buffer.from(texture.getImage())).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const rgba = Buffer.alloc(info.width * info.height * 4);
  const alpha = await sharp(alphaImage).greyscale().resize(info.width, info.height).raw().toBuffer();
  for (let i = 0; i < info.width * info.height; i++) {
    const r = data[i * 3], g = data[i * 3 + 1], b = data[i * 3 + 2];
    rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = b;
    rgba[i * 4 + 3] = alpha[i];
  }
  texture.setImage(await sharp(rgba, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer()).setMimeType('image/png');
  material.setAlphaMode('MASK').setAlphaCutoff(.4).setDoubleSided(true);
  const vertices = [], normals = [], uv = [], indices = [];
  const element = [], normal = new THREE.Vector3();
  for (let i = 0; i < 480; i++) {
    source.getElement(Math.floor(((i * .61803398875) % 1) * source.getCount()), element);
    const center = new THREE.Vector3(...element);
    const angle = i * 2.39996, h = .58 + (i % 7) * .04, w = h * .39;
    const rotation = new THREE.Euler(Math.sin(i * 1.7) * .85, angle, Math.cos(i * 2.7) * .45);
    normal.set(center.x, 1.8, center.z).normalize();
    const faceNormal = new THREE.Vector3(0, 0, 1).applyEuler(rotation);
    if (normal.dot(faceNormal) < 0) normal.negate();
    normal.lerp(faceNormal, .55).normalize();
    for (const point of [[-w / 2, -h / 2, 0], [w / 2, -h / 2, 0], [w / 2, h / 2, 0], [-w / 2, h / 2, 0]]) {
      vertices.push(...new THREE.Vector3(...point).applyEuler(rotation).add(center).toArray());
      normals.push(...normal.toArray());
    }
    uv.push(.01, .99, .40, .99, .40, .01, .01, .01);
    const k = i * 4; indices.push(k, k + 1, k + 2, k, k + 2, k + 3);
  }
  const buffer = document.getRoot().listBuffers()[0];
  const accessor = (type, data) => document.createAccessor().setType(type).setArray(data).setBuffer(buffer);
  primitive.setAttribute('POSITION', accessor('VEC3', new Float32Array(vertices)));
  primitive.setAttribute('NORMAL', accessor('VEC3', new Float32Array(normals)));
  primitive.setAttribute('TEXCOORD_0', accessor('VEC2', new Float32Array(uv)));
  primitive.setAttribute('TEXCOORD_1', accessor('VEC2', new Float32Array(uv)));
  primitive.setIndices(accessor('SCALAR', new Uint16Array(indices)));
}

await MeshoptSimplifier.ready;
for (const id of ['tree_small_02', 'pine_sapling_small']) {
  const response = await fetch(`https://api.polyhaven.com/files/${id}`);
  if (!response.ok) throw new Error(`${id}: metadata ${response.status}`);
  const metadata = await response.json();
  const file = metadata.gltf['1k'].gltf;
  const root = join('img', 'vegetation', id);
  const downloads = [[`${id}.gltf`, file], ...Object.entries(file.include)];
  if (metadata.leaves_alpha) downloads.push(['leaves-alpha.png', metadata.leaves_alpha['1k'].png]);
  await Promise.all(downloads.map(async ([name, entry]) => {
    const path = join(root, name); await mkdir(dirname(path), { recursive: true });
    if (await stat(path).then(() => true).catch(() => false)) return;
    const result = await fetch(entry.url);
    if (!result.ok) throw new Error(`${name}: ${result.status}`);
    await writeFile(path, Buffer.from(await result.arrayBuffer()));
  }));
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const document = await io.read(join(root, `${id}.gltf`));
  const count = () => document.getRoot().listMeshes().flatMap(m => m.listPrimitives())
    .reduce((sum, p) => sum + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0);
  const before = count();
  const leaves = id === 'tree_small_02' ? document.getRoot().listMeshes()[0].listPrimitives().find(p => p.getMaterial().getName().includes('leaves')) : null;
  // Save the original spatial distribution before simplifying the woody skeleton.
  const cards = leaves ? leaves.clone() : null;
  if (cards) await branchCards(document, cards, await readFile(join(root, 'leaves-alpha.png')));
  await document.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: Math.min(1, 9500 / before), error: .015 }));
  if (cards) {
    const mesh = document.getRoot().listMeshes()[0];
    mesh.removePrimitive(leaves); mesh.addPrimitive(cards);
  }
  await document.transform(dedup(), prune(), textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 88 }));
  const output = `public/assets/models/scenery_${id}.glb`;
  await io.write(output, document);
  console.log(`${id}: ${before} → ${count()} triangles; ${output}`);
}
