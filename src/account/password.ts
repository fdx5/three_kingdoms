/**
 * 비밀번호 해싱.
 *
 * PBKDF2-SHA256 · 120,000회 · 계정마다 다른 16바이트 소금.
 * 브라우저 WebCrypto만 쓰므로 의존성이 없다.
 *
 * 이것이 보장하는 것과 보장하지 않는 것
 * ------------------------------------
 * 보장: 같은 id로 다른 비밀번호를 넣으면 로그인되지 않는다. 저장된 값만 봐서는
 *       원래 비밀번호를 알 수 없다.
 * 보장하지 않음: 저장소가 localStorage인 동안에는 기기 주인이 저장된 해시를
 *       통째로 바꿔치기할 수 있다. 진짜 인증은 서버(토르소 DB)가 검증할 때
 *       비로소 성립한다 — [[TorsoGameStore]] 주석 참고.
 */
const ITERATIONS = 120_000;
const KEY_BITS = 256;
const SALT_BYTES = 16;

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(text: string): Uint8Array {
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function newSalt(): string {
  const bytes = new Uint8Array(SALT_BYTES);
  crypto.getRandomValues(bytes);
  return toBase64(bytes);
}

export async function hashPassword(password: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: fromBase64(salt) as BufferSource, iterations: ITERATIONS, hash: 'SHA-256' },
    key,
    KEY_BITS,
  );
  return toBase64(new Uint8Array(bits));
}

/**
 * 시간 일정 비교. 길이가 다르면 바로 false지만, 같은 길이면 전부 훑는다 —
 * 앞자리가 맞는지를 응답 시간으로 알아내지 못하게 한다.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
