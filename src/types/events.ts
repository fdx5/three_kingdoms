/**
 * 이벤트 페이로드 타입 맵.
 * sim은 이벤트만 발행한다. VFX/오디오/HUD는 구독만 한다 (확장성 5원칙 #4).
 */

/**
 * 날아가는 물건의 겉모습. 시뮬의 damageKind와 1:1이 아니다 —
 * 같은 공성 피해라도 벽력거의 바위와 화포의 포탄은 달리 보여야 한다.
 */
export type ProjectileVisual = 'arrow' | 'stone' | 'shell' | 'flame';

export interface WorldPos {
  x: number;
  y: number;
  z: number;
}

export interface RunStats {
  wavesCleared: number;
  totalWaves: number;
  kills: number;
  leaks: number;
  castleHp: number;
  castleMaxHp: number;
  goldLeft: number;
  goldEarned: number;
  elapsed: number;
  /** 슬롯 id -> 타워 레벨 */
  towerLevels: Record<string, number>;
  /** 끝났을 때의 성문 강화 단계 */
  castleLevel: number;
  /** 성 체력 비율 기준 별 등급 */
  stars: 1 | 2 | 3;
}

export interface GameEvents {
  'enemy:spawned': { enemyId: number; unitId: string; distance: number };
  'enemy:damaged': { enemyId: number; amount: number; hpRatio: number; worldPos: WorldPos };
  'enemy:killed': { enemyId: number; unitId: string; gold: number; worldPos: WorldPos };
  'enemy:leaked': { enemyId: number; unitId: string; castleDamage: number };
  /** 성문 앞의 적이 반복 공격을 실제로 적중시켰다. */
  'enemy:castle-attack': { enemyId: number; unitId: string; castleDamage: number };

  'projectile:fired': {
    projectileId: number;
    /** 성문이 쏜 것이면 '__castle__' */
    towerSlotId: string;
    /** 뷰가 그릴 모습. 성문의 포탄·불줄기는 타워를 되찾아 봐도 알 수 없다. */
    kind: ProjectileVisual;
    from: WorldPos;
    to: WorldPos;
    targetId: number;
  };
  'projectile:hit': {
    projectileId: number;
    enemyId: number;
    worldPos: WorldPos;
    hit: boolean;
    /** 0보다 크면 범위 피해 — VFX가 폭발 반경을 안다 */
    splashRadius?: number;
    /** 화염 투사체면 착탄 폭발을 불꽃으로 그린다. */
    fire?: boolean;
  };
  'fire-zone:created': {
    zoneId: number;
    worldPos: WorldPos;
    radius: number;
    duration: number;
    source: 'arrow' | 'stone' | 'shell' | 'flame';
  };
  'fire-zone:removed': { zoneId: number };

  'tower:built': { slotId: string; towerId: string; cost: number; worldPos: WorldPos };
  'tower:upgraded': { slotId: string; towerId: string; level: number; cost: number; worldPos: WorldPos };
  'tower:sold': { slotId: string; towerId: string; refund: number; worldPos: WorldPos };
  'tower:targeting': { slotId: string; targeting: string };
  /** aura 타워가 적에게 효과를 걸었다 */
  'tower:aura': { slotId: string; towerId: string; affected: number; worldPos: WorldPos };

  'gold:changed': { total: number; delta: number; reason: string; worldPos?: WorldPos };
  'castle:damaged': { hp: number; maxHp: number; amount: number };
  'castle:repaired': { hp: number; maxHp: number; amount: number; cost: number };
  /** 성문 강화 — 이 순간부터 성이 다른 무기를 쓴다 */
  'castle:upgraded': {
    level: number;
    title: string;
    cost: number;
    hp: number;
    maxHp: number;
    weaponKind: 'arrow' | 'cannon' | 'flame';
    shots: number;
    worldPos: WorldPos;
  };
  /** 성문이 한 차례 사격했다 (뷰의 포구 섬광·반동용) */
  'castle:fired': {
    level: number;
    kind: 'arrow' | 'cannon' | 'flame';
    shots: number;
    targetId: number;
  };

  /** 계략 발동. affected는 이 계략이 실제로 건드린 대상 수 (원군은 타워 수). */
  'stratagem:cast': {
    stratagemId: string;
    cost: number;
    affected: number;
    /** rally처럼 지속되는 계략이면 남은 시간(초), 즉발이면 0 */
    duration: number;
  };
  /** 지속형 계략이 끝났다 */
  'stratagem:ended': { stratagemId: string };

  /** 이름 있는 장수의 고유 능력 발동/종료 */
  'enemy:ability': { enemyId: number; unitId: string; ability: string; active: boolean };

  'wave:started': { index: number; total: number; banner: string; isBossWave: boolean };
  'wave:cleared': { index: number; reward: number };
  'wave:countdown': { index: number; remaining: number; total: number };

  'level:won': { stats: RunStats };
  'level:lost': { stats: RunStats };
}

export type GameEventName = keyof GameEvents;
