import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * 배포 설정의 규약.
 *
 * 여기가 깨지면 **테스트도 빌드도 다 통과한 채로 배포만 조용히 멈춘다.**
 * 실제로 하루를 그렇게 보냈다 — 사이트는 200 을 주고 있었고, 다만 어제 빌드였다.
 * 그래서 밖에서 확인할 수 없는 것들을 여기에 적어 둔다.
 */
const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
  scripts: Record<string, string>;
};
const renderYaml = readFileSync('render.yaml', 'utf8');

describe('배포 설정', () => {
  it('빌드는 반드시 끝나는 명령이어야 한다 — 서버를 띄우는 훅을 달지 않는다', () => {
    /*
     * postbuild 로 `npm start` 를 띄우는 안전장치가 있었다. Start Command 가
     * 빌드로 잘못 잡혀 있어도 서비스가 살아 있게 하려는 것이었는데, 대가가 너무
     * 컸다 — 빌드 단계가 **영영 끝나지 않는다.** render.com 은 그 배포를 "진행 중"
     * 으로 붙들고 있고, 뒤따르는 푸시는 전부 그 뒤에 줄을 선다. 로그에는 서버가
     * 정상 기동했다고 찍혀 있어서 어디가 막혔는지 보이지도 않는다.
     *
     * 오설정은 대시보드에서 고칠 일이다(Start Command 를 `npm start` 로).
     * 잘못됐다면 "Application exited early" 로 **빠르게 실패**하는 편이,
     * 한 시간짜리 침묵보다 낫다.
     */
    expect(pkg.scripts.postbuild).toBeUndefined();
    expect(pkg.scripts.build).toBe('vite build');
    // prebuild 는 확인만 하고 끝나는 명령이라 괜찮다 (없으면 깔고 즉시 종료한다)
    expect(pkg.scripts.prebuild ?? '').not.toMatch(/\bstart\b/);
  });

  it('기동 명령은 서버를 띄운다 — 빌드가 아니다', () => {
    expect(pkg.scripts.start).toContain('server/index.ts');
    expect(renderYaml).toContain('startCommand: npm start');
  });

  it('헬스체크 경로가 서버의 라우트와 같다', () => {
    expect(renderYaml).toContain('healthCheckPath: /api/health');
    expect(readFileSync('server/index.ts', 'utf8')).toContain("path === '/health'");
  });

  it('배포된 커밋을 밖에서 읽을 수 있다', () => {
    // 이게 없으면 "지금 뜬 것이 무엇인가"에 답할 방법이 없다
    expect(readFileSync('server/index.ts', 'utf8')).toContain('RENDER_GIT_COMMIT');
    expect(pkg.scripts['deploy:check']).toBeTruthy();
  });
});
