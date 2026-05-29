/**
 * Server surface of `@allstak/nuxt`.
 *
 * Mirrors the framework convention where the server entry re-exports the full
 * core (node) SDK so server route handlers and Nitro plugins can call the
 * manual API directly:
 *
 *   import { AllStak } from '@allstak/nuxt/server';
 *   export default defineEventHandler(() => { AllStak.addBreadcrumb({ ... }); });
 */
export * from '@allstak/js';
export { SDK_NAME, SDK_VERSION } from './version';
