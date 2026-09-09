// @ts-check
import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';

export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'public/**', 'artifacts/**', '_tmp-*.mjs', '*.config.js'],
  },
  js.configs.recommended,
  {
    // 설명서·공유 이미지 파이프라인 — 노드에서 돌지만 page.evaluate 안에서는 브라우저다
    files: ['manual/*.mjs', 'scripts/share-art/*.mjs'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly', window: 'readonly', document: 'readonly', getComputedStyle: 'readonly' } },
  },
  {
    files: ['scripts/ensure-deps.mjs', 'scripts/postbuild-serve.mjs', 'scripts/check-head.mjs'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly' } },
  },
  {
    // 눈 검사 러너 — 노드에서 브라우저를 몰고 다닌다
    files: ['scripts/smoke-siege.mjs'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly', window: 'readonly', document: 'readonly' } },
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
      globals: {
        window: 'readonly',
        document: 'readonly',
        console: 'readonly',
        performance: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        localStorage: 'readonly',
        navigator: 'readonly',
        fetch: 'readonly',
        ResizeObserver: 'readonly',
        HTMLElement: 'readonly',
        HTMLCanvasElement: 'readonly',
        AudioContext: 'readonly',
        Audio: 'readonly',
        process: 'readonly',
        matchMedia: 'readonly',
        devicePixelRatio: 'readonly',
        PointerEvent: 'readonly',
        TouchEvent: 'readonly',
        KeyboardEvent: 'readonly',
        WheelEvent: 'readonly',
      },
    },
    plugins: { '@typescript-eslint': tseslint },
    rules: {
      ...tseslint.configs.recommended.rules,
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-undef': 'off',
    },
  },
  {
    // 확장성 5원칙 #2 — sim은 three를 몰라야 한다. 헤드리스 실행의 근거.
    files: ['src/sim/**/*.ts', 'src/core/**/*.ts', 'src/data/**/*.ts', 'src/types/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'three',
              message: 'src/sim, src/core, src/data 는 three를 import할 수 없다 (확장성 5원칙 #2).',
            },
          ],
          patterns: [
            {
              group: ['three', 'three/*', 'three/**', '**/view/**'],
              message: 'src/sim, src/core, src/data 는 three 및 view 계층에 의존할 수 없다 (확장성 5원칙 #2).',
            },
          ],
        },
      ],
    },
  },
];
