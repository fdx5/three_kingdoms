/*
 * Start Command 가 빌드로 잘못 잡혀 있어도 서비스가 살아 있게 하는 안전장치.
 *
 * 무슨 일이 있었나
 * ---------------
 * render.com 대시보드의 Start Command 가 `npm install; npm run build` 로 잡혀
 * 있었다. 빌드는 끝나면 정상 종료(exit 0)하므로, 살아 있어야 할 프로세스가
 * 사라진다 → `Application exited early` 로 배포가 실패한다. 서버(server/index.ts)
 * 는 그동안 단 한 번도 실행되지 않았다.
 *
 * 제대로 된 해결은 Start Command 를 `npm start` 로 바꾸는 것이다. 이 파일은 그
 * 설정을 못 바꾸는 동안에도 서비스가 뜨게 해 주는 임시 다리다.
 *
 * 어떻게 빌드 단계와 구분하나
 * -------------------------
 * RENDER_INSTANCE_ID 는 **실행 중인 인스턴스에만** 주어진다. 빌드 단계에는 없다.
 * 그래서 이 변수가 있다 = "돌아가는 서비스 안에서 build 가 불렸다" = Start
 * Command 오설정이다. 로컬에서도, 정상적인 빌드 단계에서도 이 값이 없으므로
 * 아무 일도 일어나지 않는다. 판단을 뒤집어 잘못 걸리더라도 빌드가 멈추는 쪽이
 * 아니라 그냥 지나가는 쪽이 되도록 조건을 이렇게 잡았다.
 */
import { spawn } from 'node:child_process';

const instance = process.env.RENDER_INSTANCE_ID;

// 빌드 단계이거나 로컬이다. 빌드는 빌드로 끝나야 한다.
if (!instance) process.exit(0);

console.warn(
  [
    '',
    '='.repeat(70),
    '[postbuild] 실행 중인 인스턴스에서 `npm run build` 가 불렸다.',
    '[postbuild] Start Command 가 빌드로 잡혀 있다는 뜻이다 — 그대로 두면',
    '[postbuild] 빌드가 끝나는 순간 프로세스가 사라져 배포가 실패한다.',
    '[postbuild] 일단 서버를 대신 띄운다. 다만 매 재시작마다 빌드를 다시 하므로',
    '[postbuild] 느리다. Settings > Start Command 를 `npm start` 로 바꿀 것.',
    '='.repeat(70),
    '',
  ].join('\n'),
);

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const child = spawn(npm, ['start'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

/*
 * 신호를 그대로 넘긴다. render.com 은 배포를 교체할 때 SIGTERM 을 보내는데,
 * 중간에 낀 이 프로세스가 그걸 먹어 버리면 서버가 정리할 기회를 못 얻는다.
 */
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => child.kill(sig));
}

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
