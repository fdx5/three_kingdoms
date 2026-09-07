/**
 * 지면에 실을 크기로 이미지를 줄인다.
 *
 * 렌더는 넉넉하게 굽고(2배 해상도), 조판에 필요한 만큼만 남긴다.
 * 인물은 투명 배경이라 PNG로, 전장 사진은 불투명하니 JPEG로 간다 —
 * 이 구분만으로 파일이 열 배 넘게 줄어든다.
 */
import sharp from 'sharp';
import { readdirSync, mkdirSync, statSync } from 'node:fs';

const SRC = 'manual/img';
/** 그림 뒤에 깔리는 종이색. style.css 의 --fig-bg 와 반드시 같아야 한다. */
const FIGURE_BG = { r: 0xfa, g: 0xf6, b: 0xec };
const OUT = 'manual/print';
mkdirSync(OUT, { recursive: true });

let before = 0, after = 0;
for (const name of readdirSync(SRC).filter((f) => f.endsWith('.png'))) {
  before += statSync(`${SRC}/${name}`).size;
  const isField = /^(field|hud)-/.test(name);

  if (isField) {
    /*
     * 전장 사진 — 지면에서 폭 210mm를 넘지 않는다. 1500px이면 220dpi로,
     * 인쇄에도 화면에도 충분하면서 PDF가 몇 배 가벼워진다.
     */
    /*
     * 색보정을 CSS filter 로 걸면 크롬이 그 그림을 인쇄 해상도로 다시 래스터화해
     * PDF에 거대한 비트맵으로 심는다. 보정은 여기서 구워 넣고 지면에서는 그냥 깐다.
     */
    const out = `${OUT}/${name.replace('.png', '.jpg')}`;
    await sharp(`${SRC}/${name}`).resize({ width: 1500, withoutEnlargement: true })
      .modulate({ saturation: 0.74, brightness: 0.86 })
      .linear(1.06, -8)
      .jpeg({ quality: 78, mozjpeg: true }).toFile(out);
    after += statSync(out).size;
  } else {
    /*
     * 인물·망루·성문 — 투명 여백을 잘라 내고 지면 높이(최대 46mm ≈ 540px)에 맞춘다.
     *
     * 알파를 그대로 두면 크롬이 PDF에 무손실로 심어서 파일이 서너 배로 부푼다.
     * 어차피 이 그림들이 놓이는 자리는 전부 같은 종이색 한 겹이므로,
     * 그 색으로 눌러 JPEG로 넣는다 — 지면에서는 구분되지 않고 파일은 훨씬 가볍다.
     * (FIGURE_BG 는 style.css 의 --fig-bg 와 같은 값이어야 한다.)
     */
    const out = `${OUT}/${name.replace('.png', '.jpg')}`;
    await sharp(`${SRC}/${name}`).trim({ threshold: 1 })
      .resize({ height: 540, withoutEnlargement: true })
      .flatten({ background: FIGURE_BG })
      .jpeg({ quality: 88, mozjpeg: true, chromaSubsampling: '4:4:4' }).toFile(out);
    after += statSync(out).size;
  }
  process.stdout.write('.');
}

/*
 * 표지의 관우만 투명 그대로 한 장 더 굽는다.
 * 표지는 어두운 지면이라 종이색으로 눌러 버리면 인물 뒤에 크림색 사각형이 남는다.
 */
await sharp(`${SRC}/unit-guanyu.png`).trim({ threshold: 1 })
  .resize({ height: 1400, withoutEnlargement: true })
  .png({ compressionLevel: 9 }).toFile(`${OUT}/cover-hero.png`);
console.log('표지 인물 별도 저장');
console.log(`\n${(before / 1e6).toFixed(1)}MB → ${(after / 1e6).toFixed(1)}MB`);
