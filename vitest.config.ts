import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: {
    // Mirror the unbuild `replace` defines so runtime modules that read the
    // injected build-time constants typecheck and run under the test runner.
    __ALLSTAK_NUXT_VERSION__: JSON.stringify('0.1.0-test'),
    __ALLSTAK_INJECT_META__: JSON.stringify(true),
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    globals: true,
  },
});
