/**
 * GLB 경량화 — 원본 에셋을 게임 사양으로 줄인다.
 *
 *   npx tsx scripts/optimize-model.ts img/Soldier.glb public/assets/models/soldier.glb
 *   npx tsx scripts/optimize-model.ts <in> <out> --tris 6000 --tex 1024
 *
 * 왜 필요한가
 * ----------
 * 이 게임은 보병 40기가 동시에 화면에 있고, 저사양 프리셋에서도 돌아야 한다.
 * 스캔·조각 원본은 보통 100만 삼각형 단위라 그대로 쓰면 한 마리로 전체 예산을 넘긴다.
 * 여기서 정한 기준은 "보병 한 기 6,000 삼각형, 텍스처 1024" 다 —
 * 40기면 24만 삼각형으로, 지금 씬 전체(2만)의 열 배 남짓이며 실측으로 60fps가 나온다.
 *
 * 원본은 img/ 에 그대로 두고 결과만 public/assets/models/ 로 나간다.
 * 원본을 덮어쓰지 않으므로 기준을 바꿔 다시 돌리면 된다.
 */
import { NodeIO, type Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, weld, simplify, textureCompress, prune, resample } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { mkdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

export interface Args {
  input: string;
  output: string;
  /** 목표 삼각형 수 */
  tris: number;
  /** 텍스처 한 변의 최대 픽셀 */
  tex: number;
  /**
   * 감면 허용 오차 (bbox 대비 비율). 목표 삼각형 수와 이 값 중 **먼저 걸리는 쪽**에서 멈춘다.
   * 크게 두면 목표까지 확실히 줄지만 얇은 구조(성벽 톱니 같은)가 뭉개진다.
   * 기본 0.02 는 사람 모델처럼 덩어리진 형상에 맞춘 값이다.
   */
  error?: number;
}

function parseArgs(argv: string[]): Args {
  const positional = argv.filter((a) => !a.startsWith('--'));
  const flag = (name: string, fallback: number): number => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? Number(argv[i + 1]) : fallback;
  };
  return {
    input: positional[0] ?? 'img/Soldier.glb',
    output: positional[1] ?? 'public/assets/models/soldier.glb',
    tris: flag('tris', 6000),
    tex: flag('tex', 1024),
    error: flag('error', 0.02),
  };
}

function triangleCount(doc: Document): number {
  let tris = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      tris += (idx ? idx.getCount() : (prim.getAttribute('POSITION')?.getCount() ?? 0)) / 3;
    }
  }
  return Math.round(tris);
}

const mb = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(2)} MB`;

export async function optimize(a: Args): Promise<void> {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  console.log(`[optimize] 읽는 중: ${a.input} (${mb(statSync(a.input).size)})`);
  const doc = await io.read(a.input);

  const before = triangleCount(doc);
  console.log(`[optimize] 원본 삼각형 ${before.toLocaleString()}`);

  await MeshoptSimplifier.ready;
  // 목표 비율. 이미 목표보다 적으면 줄이지 않는다.
  const ratio = Math.min(1, a.tris / Math.max(1, before));

  await doc.transform(
    dedup(),
    // simplify는 인접 정보가 필요하다 — weld 없이 돌리면 감면이 거의 되지 않는다
    weld(),
    simplify({ simplifier: MeshoptSimplifier, ratio, error: a.error ?? 0.02, lockBorder: false }),
    resample(),
    prune(),
    textureCompress({
      encoder: sharp,
      targetFormat: 'jpeg',
      resize: [a.tex, a.tex],
      quality: 85,
    }),
  );

  console.log(`[optimize] 감면 후 삼각형 ${triangleCount(doc).toLocaleString()} (목표 ${a.tris.toLocaleString()})`);
  for (const t of doc.getRoot().listTextures()) {
    console.log(`[optimize] 텍스처 ${t.getSize()?.join('x')} ${t.getMimeType()} ${mb(t.getImage()?.byteLength ?? 0)}`);
  }

  mkdirSync(dirname(a.output), { recursive: true });
  await io.write(a.output, doc);
  console.log(`[optimize] 저장: ${a.output} (${mb(statSync(a.output).size)})`);
}

const isMain = process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/optimize-model.ts');
if (isMain) {
  await optimize(parseArgs(process.argv.slice(2)));
}
