import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
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

  /*
   * 음원이 없는 것은 에러가 아니다 — 그 소리는 무음으로 넘어간다(AssetRegistry의 규칙).
   * 그래서 정말 놓치기 쉬운 것은 반대쪽이다: **파일은 받아 두고 배선을 잊은 경우**.
   * 실제로 'level:lost' -> 'sfx_defeat' 매핑이 있는데 game over.mp3 가 매니페스트에
   * 없어서 게임오버가 무음이었고, 판이 끝날 때 한 번뿐인 소리라 아무도 눈치채지 못했다.
   *
   * 레벨 배경음(level*.mp3/mp4)은 유튜브로 스트리밍하므로 여기서 뺀다.
   */
  it('sound/ 에 받아 둔 음원은 빠짐없이 매니페스트에 배선돼 있다', () => {
    const used = new Set(Object.values(manifest.audio).map((u) => u.replace(/^audio\//, '')));
    const orphans = readdirSync('sound')
      .filter((f) => f.endsWith('.mp3') && !/^level\d/.test(f))
      .filter((f) => !used.has(f) && !used.has(f.replace(/ /g, '_')));
    expect(orphans, '받아 두고 아직 쓰지 않는 음원').toEqual([]);
  });

  it('게임오버에 소리가 난다', () => {
    expect(SOUND_MAP['level:lost']).toBe('sfx_defeat');
    expect(manifest.audio.sfx_defeat).toBe('audio/game_over.mp3');
    // 매니페스트의 파일이 sound/ 의 원본과 같은 파일인지까지 본다.
    expect(readFileSync(`public/assets/${manifest.audio.sfx_defeat}`))
      .toEqual(readFileSync('sound/game over.mp3'));
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
    expect(fired.fire_tower).toBe('sfx_fire_burn');
    expect(manifest.audio[fired.fire_tower]).toBe('audio/fire_burn.mp3');
    expect(readFileSync(`public/assets/${manifest.audio[fired.fire_tower]}`)).toEqual(readFileSync('sound/fire_burn.mp3'));
    expect(castle.cannon).toBe('sfx_cannon');
    expect(manifest.audio.sfx_cannon).toBe('audio/cannon.mp3');
  });

  it('성문의 활 발사는 arrow.mp3를 사용한다', () => {
    const castle = SOUND_MAP['castle:fired'];
    if (typeof castle === 'string') throw new Error('맵이어야 한다');
    expect(castle.arrow).toBe('sfx_bow');
    expect(manifest.audio[castle.arrow]).toBe('audio/arrow.mp3');
    expect(readFileSync(`public/assets/${manifest.audio[castle.arrow]}`)).toEqual(readFileSync('sound/arrow.mp3'));
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

  it('승리 이벤트는 victory.mp3를 재생한다', () => {
    expect(SOUND_MAP['level:won']).toBe('sfx_victory');
    expect(manifest.audio.sfx_victory).toBe('audio/victory.mp3');
  });
});
