/**
 * Client surface of `@allstak/nuxt`.
 *
 * Mirrors the framework convention where the client entry re-exports the full
 * Vue SDK plus the framework-specific helpers. Importable in client code as:
 *
 *   import { AllStak, useAllStak } from '@allstak/nuxt/client';
 */
export * from '@allstak/vue';
export { SDK_NAME, SDK_VERSION } from './version';
