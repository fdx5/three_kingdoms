/** Rebuild the supplied fire tower as a static carriage and five independently articulated dragon heads.
 * The generated source contains solid painted flame meshes; those faces are discarded, never animated.
 * Coordinates below describe the supplied 화공 망루.glb after optimization (before its scene transform).
 */
import { NodeIO, type Node, type Primitive, type Material } from '@gltf-transform/core';
import { BoxGeometry, CylinderGeometry, SphereGeometry, ConeGeometry, type BufferGeometry } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

type V3 = [number, number, number];
export async function rigDragonTower(input: string, output: string, height = 80): Promise<void> {
  const io = new NodeIO();
  const doc = await io.read(input);
  const root = doc.getRoot(), source = root.listMeshes()[0].listPrimitives()[0];
  const pos = source.getAttribute('POSITION')!, nor = source.getAttribute('NORMAL')!, uv = source.getAttribute('TEXCOORD_0')!;
  const indices = source.getIndices()!, material = source.getMaterial()!;
  const { data, info } = await sharp(material.getBaseColorTexture()!.getImage()!).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const vertices = Array.from({ length: pos.getCount() }, (_, i) => pos.getElement(i, [0, 0, 0]) as V3);
  const sample = (i: number): boolean => {
    const t = uv.getElement(i, []);
    const x = Math.max(0, Math.min(info.width - 1, Math.floor(t[0] * info.width)));
    const y = Math.max(0, Math.min(info.height - 1, Math.floor(t[1] * info.height)));
    const k = (y * info.width + x) * 3;
    return data[k] > 155 && data[k + 1] > 85 && data[k + 1] > data[k] * .51;
  };
  const paintedFire = vertices.map((v, i) => v[1] < .585 && Math.hypot(v[0], v[2]) > .30 && sample(i));
  const body: number[] = [], head: number[] = [], jaw: number[] = [];
  let removed = 0;
  for (let t = 0; t < indices.getCount(); t += 3) {
    const ids = [indices.getScalar(t), indices.getScalar(t + 1), indices.getScalar(t + 2)];
    const p = ids.map(i => vertices[i]);
    const c = [0, 1, 2].map(a => (p[0][a] + p[1][a] + p[2][a]) / 3);
    // Below the mouths, everything outside the timber frame is baked flame; wheels sit below -.30.
    const flame = (c[1] > -.30 && c[1] < .50 && Math.max(Math.abs(c[0]), Math.abs(c[2])) > .28)
      || ids.some(i => paintedFire[i]);
    if (flame) { removed++; continue; }
    // Keep one intact forward-facing dragon and rebuild the remaining stations from that head.
    const isHead = c[1] > .455 && c[1] < .805 && Math.hypot(c[0], c[2]) > .195;
    if (isHead) {
      if (Math.abs(c[0]) < .115 && c[2] > .195) {
        (c[1] < .555 && c[2] > .255 ? jaw : head).push(...ids);
      }
    } else if (c[1] <= .455 || c[1] >= .805) body.push(...ids);
  }
  if (head.length < 300 || removed < 300) throw new Error('Dragon segmentation does not match this source model');
  const oldScenes = root.listScenes();
  const scene = doc.createScene('dragon_fire_tower');root.setDefaultScene(scene);
  const scale = height / (pos.getMax([])[1] - pos.getMin([])[1]);
  const ground = -pos.getMin([])[1] * scale;
  const tower = doc.createNode('tower');scene.addChild(tower);
  const buffer = root.listBuffers()[0];
  const acc = (array: Float32Array | Uint32Array, type: 'VEC2' | 'VEC3' | 'SCALAR') =>
    doc.createAccessor().setType(type).setArray(array as Float32Array<ArrayBuffer>).setBuffer(buffer);
  const geometry = (name: string, tris: number[], pivot: V3, yaw = 0): Primitive => {
    const positions: number[] = [], normals: number[] = [], uvs: number[] = [], out: number[] = [];
    const remap = new Map<number, number>();
    const sin = Math.sin(yaw), cos = Math.cos(yaw);
    for (const i of tris) {
      if (!remap.has(i)) {
        remap.set(i, positions.length / 3);
        const p = vertices[i], n = nor.getElement(i, []), u = uv.getElement(i, []);
        const x = (p[0] - pivot[0]) * scale, y = (p[1] - pivot[1]) * scale, z = (p[2] - pivot[2]) * scale;
        positions.push(x * cos + z * sin, y, z * cos - x * sin);
        normals.push(n[0] * cos + n[2] * sin, n[1], n[2] * cos - n[0] * sin);
        uvs.push(...u);
      }
      out.push(remap.get(i)!);
    }
    return doc.createPrimitive().setMaterial(material)
      .setAttribute('POSITION', acc(new Float32Array(positions), 'VEC3'))
      .setAttribute('NORMAL', acc(new Float32Array(normals), 'VEC3'))
      .setAttribute('TEXCOORD_0', acc(new Float32Array(uvs), 'VEC2'))
      .setIndices(acc(new Uint32Array(out), 'SCALAR')).setMode(4).setExtras({ part: name });
  };
  tower.addChild(doc.createNode('carriage').setTranslation([0, ground, 0]).setMesh(doc.createMesh('carriage').addPrimitive(geometry('carriage', body, [0, 0, 0]))));
  const turret = doc.createNode('dragon_turret');tower.addChild(turret);
  // Rebuild the cut turret behind the heads as a complete timber drum with bronze bindings.
  const timber = doc.createMaterial('charred_walnut').setBaseColorFactor([.18, .09, .045, 1]).setRoughnessFactor(.88);
  const grain = new Uint8Array(128 * 256 * 3);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 128; x++) {
    const seam = x % 16 < 1 ? .4 : 1;
    const v = (1 + .16 * Math.sin(x * 8 + Math.sin(y * .07)) + .08 * Math.sin(y * .7 + x * 13)) * seam;
    const k = (y * 128 + x) * 3;grain[k] = 128 * v;grain[k + 1] = 86 * v;grain[k + 2] = 51 * v;
  }
  const grainTexture = doc.createTexture('walnut_grain').setMimeType('image/png')
    .setImage(await sharp(grain, { raw: { width: 128, height: 256, channels: 3 } }).png().toBuffer());
  timber.setBaseColorFactor([.7, .58, .44, 1]).setBaseColorTexture(grainTexture);
  const bronze = doc.createMaterial('aged_bronze').setBaseColorFactor([.29, .18, .07, 1]).setMetallicFactor(.65).setRoughnessFactor(.55);
  const jawMaterial = doc.createMaterial('dragon_jaw').setBaseColorFactor([.13, .09, .055, 1]).setMetallicFactor(.2).setRoughnessFactor(.75);
  const horn = doc.createMaterial('dragon_teeth').setBaseColorFactor([.56, .46, .3, 1]).setRoughnessFactor(.7);
  const shapes = new Map<Node, Map<Material, { name: string; geometry: BufferGeometry[] }>>();
  const addShape = (parent: Node, name: string, geo: BufferGeometry, mat: Material) => {
    if (!shapes.has(parent)) shapes.set(parent, new Map());
    const group = shapes.get(parent)!;
    if (!group.has(mat)) group.set(mat, { name, geometry: [] });
    group.get(mat)!.geometry.push(geo);
  };
  const writeShape = (parent: Node, name: string, geo: BufferGeometry, mat: Material) => {
    const p = doc.createPrimitive().setMaterial(mat)
      .setAttribute('POSITION', acc(new Float32Array(geo.getAttribute('position').array), 'VEC3'))
      .setAttribute('NORMAL', acc(new Float32Array(geo.getAttribute('normal').array), 'VEC3'));
    if (geo.getAttribute('uv')) p.setAttribute('TEXCOORD_0', acc(new Float32Array(geo.getAttribute('uv').array), 'VEC2'));
    if (geo.index) p.setIndices(acc(new Uint32Array(geo.index.array), 'SCALAR'));
    parent.addChild(doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(p)));geo.dispose();
  };
  addShape(turret, 'timber_turret', new CylinderGeometry(.203 * scale, .22 * scale, .32 * scale, 10).translate(0, ground + .61 * scale, 0), timber);
  for (const y of [.465, .745]) addShape(turret, `turret_binding_${y}`, new CylinderGeometry(.223 * scale, .223 * scale, .023 * scale, 10).translate(0, ground + y * scale, 0), bronze);
  for (let i = 0; i < 10; i++) {
    const a = i * Math.PI / 5;
    addShape(turret, `battlement_${i}`, new BoxGeometry(.075 * scale, .075 * scale, .045 * scale)
      .translate(0, ground + .79 * scale, .193 * scale).rotateY(a), timber);
  }
  const pivot: V3 = [0, .625, .195], hinge: V3 = [.025, .565, .30], mouth: V3 = [.025, .56, .43];
  const order = [0, -1, 1, -2, 2];
  const relative = (v: V3, origin: V3, yaw: number): V3 => {
    const x = (v[0] - origin[0]) * scale, z = (v[2] - origin[2]) * scale;
    return [x * Math.cos(yaw) + z * Math.sin(yaw), (v[1] - origin[1]) * scale, z * Math.cos(yaw) - x * Math.sin(yaw)];
  };
  for (let i = 0; i < 5; i++) {
    const yaw = order[i] * .58;
    const station = doc.createNode(`bow${i + 1}`).setTranslation([Math.sin(yaw) * .195 * scale, pivot[1] * scale + ground, Math.cos(yaw) * .195 * scale]);
    station.setExtras({ dragonHead: true });
    addShape(station, `neck${i + 1}`, new CylinderGeometry(.064 * scale, .079 * scale, .11 * scale, 10)
      .rotateX(Math.PI / 2).translate(0, -.03 * scale, -.015 * scale).rotateY(yaw), bronze);
    station.addChild(doc.createNode(`dragon${i + 1}`).setMesh(doc.createMesh(`dragon${i + 1}`).addPrimitive(geometry('head', head, pivot, yaw))));
    const jawNode = doc.createNode(`dragon${i + 1}_jaw`).setTranslation(relative(hinge, pivot, yaw));
    addShape(jawNode, `lower_jaw${i + 1}`, new SphereGeometry(1, 12, 6).scale(.027 * scale, .014 * scale, .045 * scale)
      .translate(0, -.025 * scale, .06 * scale).rotateY(yaw), jawMaterial);
    for (const side of [-1, 1]) for (let tooth = 0; tooth < 3; tooth++) {
      addShape(jawNode, `tooth_${i}_${side}_${tooth}`, new ConeGeometry(.004 * scale, .019 * scale, 5)
        .translate(side * .026 * scale, -.009 * scale, (.055 + tooth * .021) * scale).rotateY(yaw), horn);
    }
    station.addChild(jawNode);
    station.addChild(doc.createNode(`bow${i + 1}_nock`).setTranslation(relative(mouth, pivot, yaw)));
    turret.addChild(station);
    const anim = doc.createAnimation(`shoot${i + 1}`);
    const times = [0, .075, .18, .48, .70];
    const addTrack = (node: Node, path: 'translation' | 'rotation', values: number[], type: 'VEC3' | 'VEC4') => {
      const sampler = doc.createAnimationSampler().setInput(acc(new Float32Array(times), 'SCALAR'))
        .setOutput(doc.createAccessor().setBuffer(buffer).setType(type).setArray(new Float32Array(values))).setInterpolation('LINEAR');
      anim.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath(path).setSampler(sampler));
    };
    const base = station.getTranslation();
    addTrack(station, 'translation', [0, .8, .45, .15, 0].flatMap(k => [base[0] - Math.sin(yaw) * k, base[1] + k * .18, base[2] - Math.cos(yaw) * k]), 'VEC3');
    addTrack(jawNode, 'rotation', [0, .20, .25, .15, 0].flatMap(a => [Math.cos(yaw) * Math.sin(a / 2), 0, -Math.sin(yaw) * Math.sin(a / 2), Math.cos(a / 2)]), 'VEC4');
  }
  for (const [parent, materials] of shapes) for (const [mat, part] of materials) {
    const merged = mergeGeometries(part.geometry);
    if (!merged) throw new Error(`Cannot merge ${part.name}`);
    writeShape(parent, part.name, merged, mat);part.geometry.forEach(g => g.dispose());
  }
  // Dispose only original graph/meshes; generated nodes share the source textures and material.
  for (const old of oldScenes) old.dispose();
  const keep = new Set<Node>();const visit = (n: Node) => { keep.add(n);n.listChildren().forEach(visit); };scene.listChildren().forEach(visit);
  for (const n of root.listNodes()) if (!keep.has(n)) n.dispose();
  for (const m of root.listMeshes()) if (!root.listNodes().some(n => n.getMesh() === m)) m.dispose();
  // Remove detached original accessors so the final GLB contains only the rebuilt geometry.
  const { prune, dedup } = await import('@gltf-transform/functions');await doc.transform(prune({ keepLeaves: true }), dedup());
  mkdirSync(dirname(output), { recursive: true });await io.write(output, doc);
  console.log(`[dragon] removed ${removed} solid flame faces; carriage ${body.length / 3}; head ${head.length / 3}; jaw ${jaw.length / 3}; 5 stations -> ${output}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [, , input, output] = process.argv;
  if (!input || !output) throw new Error('Usage: rig-dragon-tower.ts input.glb output.glb');
  await rigDragonTower(input, output);
}
