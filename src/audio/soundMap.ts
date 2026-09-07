/**
 * 사운드 이벤트 매핑 — 코드가 아니라 데이터다.
 * 음원을 바꾸려면 manifest.json의 id와 이 표만 고치면 된다.
 * 값이 문자열이면 그대로, 객체면 unitId/키별로 고른다.
 */
export type SoundMapping = string | Record<string, string>;

export const SOUND_MAP: Record<string, SoundMapping> = {
  'enemy:killed': {
    yt_infantry: 'sfx_die_small',
    yt_captain: 'sfx_die_boss',
    zhangjiao: 'sfx_die_boss',
  },
  'enemy:spawned': {
    yt_captain: 'sfx_boss_spawn',
    zhangjiao: 'sfx_boss_spawn',
  },
  // 발사음은 타워 종류로 갈린다 (변형자로 towerId가 들어온다).
  // 매핑에 없는 타워(철질려 등)는 발사음이 없다.
  'projectile:fired': {
    archer_tower: 'sfx_bow',
    catapult: 'sfx_catapult',
    cannon_tower: 'sfx_cannon',
    fire_tower: 'sfx_fire_burn',
  },
  /**
   * 성문의 사격음. 무기 종류(arrow/cannon/flame)로 갈린다 —
   * 성문은 타워가 아니라 강화 단계가 무기를 바꾸므로 towerId로는 고를 수 없다.
   * 일제사격마다 한 번 재생해 여러 발의 발사음이 겹치지 않게 한다.
   */
  'castle:fired': {
    arrow: 'sfx_bow',
    cannon: 'sfx_cannon',
    flame: 'sfx_fire_burn',
  },
  'projectile:hit': 'sfx_hit',
  'enemy:leaked': 'sfx_castle_hit',
  /**
   * 성벽을 때리는 소리. 유닛 id가 아니라 **종류(kind)** 로 고른다 —
   * 진영이 늘 때마다(오군·형주군·촉군…) 표를 고치지 않아도 새 보병이 알아서 소리를 낸다.
   * 특정 유닛만 다른 소리를 내야 하면 그 유닛 id를 여기에 한 줄 더 적으면 되고,
   * 그때는 id 쪽이 먼저 잡힌다 (AudioManager.play의 fallbackVariant).
   */
  'enemy:castle-attack': {
    minion: 'sfx_castle_strike_soldier',
    elite: 'sfx_castle_strike_boss',
    boss: 'sfx_castle_strike_boss',
  },
  'castle:spark': 'sfx_spark',
  'tower:built': 'sfx_build',
  'tower:upgraded': 'sfx_upgrade',
  'tower:sold': 'sfx_sell',
  'stratagem:cast': {
    fire_attack: 'sfx_fire_attack',
    ice_storm: 'sfx_ice_storm',
    reinforcements: 'sfx_rally',
  },
  'wave:started': 'sfx_wave',
  'wave:boss': 'sfx_wave_boss',
  'level:won': 'sfx_victory',
  'level:lost': 'sfx_defeat',
  'ui:tap': 'sfx_ui_tap',
  'ui:gold': 'sfx_coin',
};

/**
 * 음원 재생 구간 — 원본을 건드리지 않고 게임 템포에 맞춰 잘라 쓴다.
 *
 * 받은 음원은 보통 여운까지 길게 녹음돼 있다. 발사음처럼 초당 여러 번 나는 소리는
 * 그대로 틀면 서로 겹쳐 뭉개지므로, 앞의 묵음을 건너뛰고 정해진 길이만 낸다.
 * 파일을 다시 인코딩하지 않으니 값만 바꾸면 바로 반영된다.
 */
export interface SoundClip {
  /** 최대 재생 길이(초) */
  duration: number;
  /** 끝을 닫는 시간(초). 뚝 끊길 때 나는 딸깍 소리를 없앤다 */
  fadeOut?: number;
  /** 앞의 묵음을 건너뛴다 — mp3 인코딩 패딩 때문에 타격감이 밀리는 걸 막는다 */
  trimLead?: boolean;
  /** 이 음원만의 중복 억제 간격(ms). 없으면 기본값 */
  dedupeMs?: number;
  /** 볼륨 배수 */
  gain?: number;
}

export const SOUND_CLIPS: Record<string, SoundClip> = {
  // 활: 한 발마다 짧고 날카롭게. 원본 1.04초 중 앞부분만.
  sfx_bow: { duration: 0.4, fadeOut: 0.09, trimLead: true, dedupeMs: 45, gain: 0.9 },
  // 투석: 요청대로 0.7초만. 원본 2.11초.
  sfx_catapult: { duration: 0.7, fadeOut: 0.12, trimLead: true, dedupeMs: 120 },
  /*
   * 성벽 타격음. 후반에는 성문 앞에 수십 기가 붙어 제각기 때리므로
   * 그대로 두면 소리가 뭉개진다. 짧게 자르고 중복 억제 간격을 넉넉히 준다.
   */
  sfx_castle_strike_soldier: { duration: 0.55, fadeOut: 0.1, trimLead: true, dedupeMs: 110, gain: 0.85 },
  // 중간보스는 한 번에 하나뿐이라 길게 울려도 뭉개지지 않는다.
  sfx_castle_strike_boss: { duration: 1.2, fadeOut: 0.18, trimLead: true, dedupeMs: 400 },
  /*
   * 대포. 한 번의 발사가 2~4발이고 성문과 화포 진지가 동시에 쏠 수 있어,
   * 한 발마다 울리면 굉음이 겹친다. 일제사격 한 번에 한 번만 나게
   * 중복 억제를 발사 간격(화포 2.2초 / 성문 1.05초)보다 짧게, 그러나 넉넉히 잡는다.
   */
  sfx_cannon: { duration: 0.9, fadeOut: 0.15, trimLead: true, dedupeMs: 260 },
  sfx_fire_burn: { duration: .8, fadeOut: .16, trimLead: true, dedupeMs: 90, gain: .8 },
};

/** 버스 배정 */
export const SOUND_BUS: Record<string, 'sfx' | 'ui' | 'bgm'> = {
  'ui:tap': 'ui',
  'ui:gold': 'ui',
  'tower:built': 'ui',
  'tower:upgraded': 'ui',
  'tower:sold': 'ui',
  'stratagem:cast': 'sfx',
};
