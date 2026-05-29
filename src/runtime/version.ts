/**
 * SDK identity. The version is injected at build time from `package.json` via
 * the unbuild `replace` define (`__ALLSTAK_NUXT_VERSION__`) in `build.config.ts`
 * — never hand-write it, so it can't drift from the published version. The
 * fallback string only applies when a tool evaluates this module without the
 * build-time replace (e.g. a raw `tsc` typecheck or a test runner without the
 * define), and is clearly marked so it never looks like a real release.
 */
declare const __ALLSTAK_NUXT_VERSION__: string;

export const SDK_NAME = 'allstak-nuxt';

export const SDK_VERSION: string =
  typeof __ALLSTAK_NUXT_VERSION__ === 'string'
    ? __ALLSTAK_NUXT_VERSION__
    : '0.0.0-dev';
