import { defineBuildConfig } from 'unbuild';

/**
 * Module-builder (unbuild) configuration.
 *
 * Version handling: the module reads its own version from `package.json` at
 * setup time (`pkgVersion`) and injects `__ALLSTAK_NUXT_VERSION__` into the
 * host's Vite/Nitro build as a define, so the runtime plugins get the real
 * version at the host's build time. We deliberately do NOT use unbuild's global
 * `replace` for the version — that is a naive string replace and would clobber
 * the define KEY name (`__ALLSTAK_NUXT_VERSION__`) inside this module bundle.
 * The runtime `version.ts` falls back to a clearly-marked dev string if a tool
 * evaluates it without the host-injected define.
 *
 * `@allstak/js` and `@allstak/vue` stay external — the host app pins their
 * versions in its own dependency tree, and Nuxt resolves them at runtime.
 */
export default defineBuildConfig({
  externals: ['@allstak/js', '@allstak/vue', '#imports', 'nuxt/app', 'h3'],
});
