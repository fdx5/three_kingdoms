/**
 * 테스트 설정.
 *
 * vite.config.ts 와 나눠 둔 이유는 하나다 — 게임을 **빌드**하는 데 테스트 러너가
 * 필요하면 안 되기 때문이다. 배포에서 devDependencies 가 빠지면 vite.config.ts 가
 * vitest 를 import 하는 순간 빌드가 죽는다(실제로 그랬다).
 *
 * 여기서 vite 설정을 가져다 쓰지 않는 것도 같은 맥락이다. 시뮬레이션 테스트는
 * three 도 DOM 도 쓰지 않아서(그게 이 저장소의 계층 규칙이다) 별칭도 프록시도 필요 없다.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
