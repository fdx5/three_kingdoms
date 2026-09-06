/*
 * 빌드 전에 의존성이 실제로 깔려 있는지 확인하고, 없으면 깐다.
 *
 * 왜 필요한가 — render.com 배포가 `sh: 1: vite: not found` 로 계속 죽었다.
 * package.json 도 package-lock.json 도 멀쩡했다(vite 는 dependencies 에 있고
 * 프로덕션 전용 `npm ci` 로도 node_modules/.bin/vite 가 만들어진다). 원인은
 * 저장소가 아니라 대시보드였다 — 손으로 만든 Web Service 는 render.yaml 을
 * 읽지 않으므로 Build Command 가 `npm run build` 하나로 남아 있었고, 설치가
 * 아예 돌지 않은 채 vite 를 부른 것이다.
 *
 * 그래서 `npm run build` 자체를 자립시킨다. 설치가 이미 됐으면(정상 경로)
 * 이 파일은 몇 밀리초 만에 그냥 끝난다. 안 됐으면 여기서 깐다.
 *
 * 의존성 없는 순수 node 다 — tsx 도 못 쓰는 상황을 위한 파일이므로 .mjs 다.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(root, 'package.json'));

/** 빌드에 반드시 필요한 것들. 하나라도 없으면 설치가 안 돈 것으로 본다. */
const needed = ['vite'];

const missing = needed.filter((name) => {
  try {
    require.resolve(`${name}/package.json`);
    return false;
  } catch {
    return true;
  }
});

if (missing.length === 0) process.exit(0);

console.log(`[ensure-deps] 의존성이 없다(${missing.join(', ')}). 설치한다.`);

// 잠금 파일이 있으면 ci — 재현 가능하고 빠르다. 없으면 install 로 물러선다.
const hasLock = existsSync(join(root, 'package-lock.json'));
const args = hasLock ? ['ci', '--omit=dev'] : ['install', '--omit=dev'];

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = spawnSync(npm, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });

if (run.status !== 0) {
  console.error(`[ensure-deps] npm ${args.join(' ')} 실패 (exit ${run.status}).`);
  process.exit(run.status ?? 1);
}
