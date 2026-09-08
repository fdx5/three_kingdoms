/**
 * 커밋된 트리(HEAD)만으로 앱이 성립하는지 검사한다.
 *
 * 왜 필요한가. 이 저장소는 여러 세션이 동시에 고친다. 워킹 트리에는 아직 커밋되지
 * 않은 남의 작업이 섞여 있어서 `npm run typecheck` 도 테스트도 스모크도 전부 통과하는데,
 * **커밋된 트리로 빌드되는 배포본만** 죽는 일이 실제로 있었다:
 *   [boot] 시작 실패: TypeError: this.ribbon.setSurfaceQuality is not a function
 *
 * 그래서 HEAD 의 src 만 임시 폴더에 꺼내 놓고 거기서 타입 검사를 돌린다.
 * node_modules 는 정션(심볼릭 링크)으로 빌려 쓰므로 설치는 다시 하지 않는다.
 *
 *   node scripts/check-head.mjs        (= npm run check:head)
 */
import { execFileSync, execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const repo = resolve(import.meta.dirname, '..');
const out = mkdtempSync(join(tmpdir(), 'head-check-'));

try {
  const files = execSync('git ls-files "src/*.ts" "src/**/*.ts" "src/**/*.d.ts"', {
    cwd: repo,
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean);

  if (files.length === 0) throw new Error('HEAD 에 src 파일이 없다 — git ls-files 확인');

  for (const f of files) {
    const body = execSync(`git show HEAD:${f}`, { cwd: repo, encoding: 'utf8', maxBuffer: 64e6 });
    const dest = join(out, f);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, body);
  }
  copyFileSync(join(repo, 'tsconfig.json'), join(out, 'tsconfig.json'));

  // node_modules 를 빌려 쓴다 (윈도우 정션 / 그 외 심볼릭 링크)
  const link = join(out, 'node_modules');
  const target = join(repo, 'node_modules');
  if (process.platform === 'win32') {
    execSync(`mklink /J "${link}" "${target}"`, { shell: 'cmd.exe', stdio: 'ignore' });
  } else {
    execSync(`ln -s "${target}" "${link}"`);
  }

  // .bin 의 래퍼(.cmd)는 윈도우에서 shell 없이 못 띄운다. 타입스크립트의 JS 진입점을 직접 돌린다.
  const tsc = join(repo, 'node_modules', 'typescript', 'bin', 'tsc');
  if (!existsSync(tsc)) throw new Error('typescript 를 찾을 수 없다 — npm install 먼저');

  execFileSync(process.execPath, [tsc, '--noEmit', '-p', 'tsconfig.json'], {
    cwd: out,
    stdio: 'inherit',
  });
  console.log(`[check:head] 커밋된 트리(${files.length}개 파일)만으로 타입 검사 통과`);
} catch (err) {
  console.error('\n[check:head] 커밋된 트리만으로는 성립하지 않는다.');
  console.error('  워킹 트리에만 있는 코드에 기대고 있다는 뜻이다 — 그대로 배포하면 배포본이 죽는다.');
  console.error('  의존하는 파일을 같이 커밋하거나, 그 호출을 빼거나, 옵셔널로 감싼다.');
  process.exitCode = 1;
  // tsc 가 낸 오류는 이미 위에 찍혔다. 그 밖의 실패(정션·git 등)는 이유를 보여준다.
  const isTsc = err && typeof err === 'object' && err.cmd && String(err.cmd).includes('tsc');
  if (!isTsc) console.error(err?.message ?? err);
} finally {
  rmSync(out, { recursive: true, force: true });
}
