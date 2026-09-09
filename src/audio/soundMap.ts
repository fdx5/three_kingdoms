/**
 * 사운드 이벤트 매핑 — 코드가 아니라 데이터다.
 * 음원을 바꾸려면 manifest.json의 id와 이 표만 고치면 된다.
 * 값이 문자열이면 그대로, 객체면 unitId/키별로 고른다.
 */
export type SoundMapping = string | Record<string, string>;

/**
 * 백병전 타격음 — **무기 계열**로 나눈다.
 *
 * 유닛마다 한 줄씩 적지 않고 계열로 묶는 이유는 둘이다. 진영이 늘 때마다
 * (오군·형주군·촉군…) 새 보병이 알아서 소리를 내야 하고, 스무 종이 넘는 유닛에
 * 스무 줄을 적으면 어떤 소리가 어디 쓰이는지 표를 봐도 알 수 없기 때문이다.
 * 여기 없는 유닛은 종류(minion/elite/boss) 기본값으로 떨어진다.
 *
 * 성벽을 치든 망루를 치든 같은 표를 쓴다 — 같은 병사가 무엇을 때리느냐에 따라
 * 다른 소리를 내면 그건 무기가 아니라 표적의 소리가 된다.
 */
const MELEE_BY_UNIT: Record<string, string> = {
  // 방패와 중장갑 — 쇠와 쇠가 부딪히는 둔중한 소리
  xl_shield: 'sfx_sword1',
  sh_chainmail: 'sfx_sword1',
  wu_rattan: 'sfx_sword1',

  // 기병 — 말 위에서 내리치는 짧고 빠른 검격
  xl_cavalry: 'sfx_sword2',
  ys_banner: 'sfx_sword2',
  wu_cavalry: 'sfx_sword2',
  jz_cavalry: 'sfx_sword2',
  sh_cavalry: 'sfx_sword2',

  // 창·수군 — 내지르는 장병기
  ys_spear: 'sfx_sword3',
  wu_marine: 'sfx_sword3',
  jz_marine: 'sfx_sword3',
  wu_raider: 'sfx_sword3',

  // 대도 — 몸만 한 날이 쓸고 지나간다
  jz_halberd: 'sfx_sword4',
};

/** 무기 계열 + 종류 기본값. 유닛 id 가 먼저 잡히고, 없으면 종류로 떨어진다. */
const MELEE_SOUNDS: Record<string, string> = {
  ...MELEE_BY_UNIT,
  minion: 'sfx_castle_strike_soldier',
  elite: 'sfx_castle_strike_boss',
  boss: 'sfx_castle_strike_boss',
};

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
    // 성문의 포는 망루의 화포(sfx_cannon)와 다른 음원이다 — 같은 소리면
    // 성이 쏜 것인지 화포 진지가 쏜 것인지 귀로 구분되지 않는다.
    cannon: 'sfx_castle_cannon',
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
  'enemy:castle-attack': MELEE_SOUNDS,
  'castle:spark': 'sfx_spark',
  /** 망루를 치는 소리도 성벽과 같은 표를 쓴다 — 무기가 정하지 표적이 정하지 않는다. */
  'tower:damaged': MELEE_SOUNDS,
  /*
   * 망루가 무너지는 소리. 대포 소리를 길게 늘여 쓴다 — 목재가 통째로 꺾이는
   * 굉음에 가진 음원 중 가장 가깝다. 화포 발사와 같은 원본이지만 클립 길이와
   * 여운이 두 배라(SOUND_CLIPS) 실제로 들리는 소리는 다르고, 무엇보다 이쪽에는
   * 배너와 화면 흔들림과 잔해가 함께 온다.
   */
  'tower:destroyed': 'sfx_tower_fall',
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
  /*
   * 검격. 짧게 끊어야 여러 기가 동시에 쳐도 뭉개지지 않는다.
   * 중복 억제는 넉넉히 두되 클립이 네 개라 실제로는 네 배만큼 자주 난다.
   */
  // 붕괴 — 길고 무겁게. 한 판에 몇 번 안 나므로 억제 간격도 길게.
  sfx_tower_fall: { duration: 1.6, fadeOut: .3, trimLead: true, dedupeMs: 700 },
  // 성문의 포. 화포 진지보다 굵고 길게 울린다.
  sfx_castle_cannon: { duration: 1.1, fadeOut: .2, trimLead: true, dedupeMs: 300 },
  sfx_sword1: { duration: .42, fadeOut: .1, trimLead: true, dedupeMs: 120, gain: .7 },
  sfx_sword2: { duration: .42, fadeOut: .1, trimLead: true, dedupeMs: 120, gain: .7 },
  sfx_sword3: { duration: .42, fadeOut: .1, trimLead: true, dedupeMs: 120, gain: .7 },
  sfx_sword4: { duration: .42, fadeOut: .1, trimLead: true, dedupeMs: 120, gain: .7 },
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
