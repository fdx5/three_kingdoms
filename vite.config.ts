import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  base: './',
  server: {
    watch: {
      /*
       * `img/` 는 감시하지 않는다.
       *
       * 원본 모델(70MB 안팎)을 브라우저로 여기에 직접 받는 작업 흐름이라, 받는 동안
       * `미확인 NNNNN.crdownload` 라는 잠긴 파일이 잠깐 생긴다. vite 의 파일 감시자가
       * 그걸 열려다 EBUSY 로 **프로세스째 죽는다**(실제로 두 번 죽었다).
       * 어차피 vite 가 서빙하지도 번들하지도 않는 폴더다 — 결과물은 asset 파이프라인이
       * `public/assets/models/` 로 낸다.
       */
      ignored: ['**/img/**'],
    },
    /*
     * dev 서버에서도 API 를 같은 오리진으로 쓸 수 있게 넘겨 준다.
     * `npm run server` 를 띄운 뒤 http://localhost:5173/?api=/api 로 열면
     * 배포와 똑같은 경로(토르소 DB)로 돌아간다. 서버를 안 띄우면 이 프록시는
     * 아무 일도 하지 않고, 게임은 localStorage 로 논다.
     */
    proxy: {
      '/api': { target: 'http://localhost:8787', changeOrigin: true },
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
