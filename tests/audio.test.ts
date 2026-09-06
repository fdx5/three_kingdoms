import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { SOUND_MAP, SOUND_CLIPS, type SoundMapping } from '../src/audio/soundMap';
import { UNIT_LIST } from '../src/data/units';
import { TOWERS } from '../src/data/towers';
import { CASTLE_LEVELS } from '../src/data/castle';

const manifest = JSON.parse(readFileSync('public/assets/manifest.json', 'utf8')) as {
  audio: Record<string, string>;
};

/** SOUND_MAP이 가리키는 모든 음원 id */
function mappedIds(mapping: SoundMapping): string[] {
  return typeof mapping === 'string' ? [mapping] : Object.values(mapping);
}

describe('사운드 매핑', () => {
  it('매니페스트에 있는 음원 id는 실제 파일 경로를 가리킨다', () => {
    for (const [id, url] of Object.entries(manifest.audio)) {
      expect(url, id).toMatch(/^audio\/.+\.mp3$/);
    }
  });

  it('클립 설정은 매니페스트에 있는 음원에만 붙는다', () => {
    for (const id of Object.keys(SOUND_CLIPS)) {
      expect(manifest.audio[id], id).toBeDefined();
    }
  });

  it('성벽 타격음이 유닛 종류별로 갈린다 — 보병은 soldier, 장수는 middle_boss', () => {
    const mapping = SOUND_MAP['enemy:castle-attack'];
    expect(typeof mapping).not.toBe('string');
    if (typeof mapping === 'string') return;

    expect(manifest.audio[mapping.minion]).toBe('audio/soldier.mp3');
    expect(manifest.audio[mapping.elite]).toBe('audio/middle_boss.mp3');
    expect(manifest.audio[mapping.boss]).toBe('audio/middle_boss.mp3');

    // 종류로 고르므로 진영이 늘어도 모든 유닛에 소리가 붙는다
    for (const u of UNIT_LIST) expect(mapping[u.kind], u.id).toBeDefined();
  });

  it('대포는 타워든 성문이든 같은 포성을 낸다', () => {
    const fired = SOUND_MAP['projectile:fired'];
    const castle = SOUND_MAP['castle:fired'];
    if (typeof fired === 'string' || typeof castle === 'string') throw new Error('맵이어야 한다');

    expect(fired.cannon_tower).toBe('sfx_cannon');
    expect(castle.cannon).toBe('sfx_cannon');
    expect(manifest.audio.sfx_cannon).toBe('audio/cannon.mp3');
  });

  it('성문 사격음은 대포 단계에만 붙는다 (화살은 초당 여러 번이라 뭉갠다)', () => {
    const castle = SOUND_MAP['castle:fired'];
    if (typeof castle === 'string') throw new Error('맵이어야 한다');
    expect(castle.arrow).toBeUndefined();
    // 표에 적힌 키는 실제로 존재하는 무기 종류여야 한다
    const kinds = new Set(CASTLE_LEVELS.map((l) => l.weapon.kind));
    for (const key of Object.keys(castle)) expect(kinds.has(key as never), key).toBe(true);
  });

  it('발사음 표의 키가 실제 타워 id다', () => {
    const fired = SOUND_MAP['projectile:fired'];
    if (typeof fired === 'string') throw new Error('맵이어야 한다');
    for (const key of Object.keys(fired)) expect(TOWERS[key], key).toBeDefined();
  });

  it('새로 넣은 음원은 매니페스트에도 있고 매핑에서도 쓰인다', () => {
    /*
     * 매핑에는 아직 파일이 없는 id도 들어 있다(sfx_hit, sfx_victory …).
     * 그건 오류가 아니라 "그 소리는 아직 무음"이라는 뜻이다 — 매니페스트에 한 줄
     * 추가하면 그때부터 난다. 그래서 전체를 대조하지 않고, 이번에 넣은 셋만 확인한다.
     */
    const used = new Set(Object.values(SOUND_MAP).flatMap(mappedIds));
    for (const id of ['sfx_castle_strike_soldier', 'sfx_castle_strike_boss', 'sfx_cannon']) {
      expect(manifest.audio[id], `${id}: 매니페스트`).toBeDefined();
      expect(used.has(id), `${id}: 매핑`).toBe(true);
    }
  });
});
