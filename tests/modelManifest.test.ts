import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { UNIT_LIST } from '../src/data/units';
import { TOWER_LIST } from '../src/data/towers';
import { LEVEL_ORDER } from '../src/data/levels';

/**
 * 모델 참조가 끊기지 않았는지 본다.
 *
 * 끊겨도 게임은 죽지 않는다 — AssetRegistry 가 조용히 프리미티브로 돌아간다.
 * 그래서 화면을 열어 보기 전에는 모르고, 모델 파일 이름을 바꾸는 순간이 정확히
 * 그 사고가 나는 자리다(화공 망루의 포대를 화포 진지로 옮기면서 실제로 겪었다).
 */
const manifest = JSON.parse(readFileSync('public/assets/manifest.json', 'utf8')) as {
  models: Record<string, { url: string }>;
};

function refs(): { who: string; modelId: string }[] {
  const out: { who: string; modelId: string }[] = [];
  for (const u of UNIT_LIST) if (u.view.modelId) out.push({ who: `unit ${u.id}`, modelId: u.view.modelId });
  for (const t of TOWER_LIST) {
    t.levels.forEach((lv, i) => {
      if (lv.view.modelId) out.push({ who: `tower ${t.id} lv${i + 1}`, modelId: lv.view.modelId });
    });
  }
  for (const l of LEVEL_ORDER) out.push({ who: `castle ${l.id}`, modelId: l.castle.id });
  return out;
}

describe('모델 매니페스트', () => {
  it('데이터가 가리키는 모델이 모두 매니페스트에 있고 파일도 있다', () => {
    for (const { who, modelId } of refs()) {
      const entry = manifest.models[modelId];
      expect(entry, `${who} -> ${modelId} 이(가) manifest 에 없다`).toBeDefined();
      // url 에는 캐시 버스터가 붙을 수 있다 (models/x.glb?v=abc123) — 파일은 그 앞까지다
      const file = entry.url.split('?')[0];
      expect(existsSync(`public/assets/${file}`), `${who} -> ${file} 파일이 없다`).toBe(true);
    }
  });

  it('매니페스트에 아무도 안 쓰는 모델이 남아 있지 않다', () => {
    const used = new Set(refs().map((r) => r.modelId));
    expect(Object.keys(manifest.models).filter((id) => !used.has(id))).toEqual([]);
  });
});
