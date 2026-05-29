import { fileURLToPath } from 'node:url';
import {
  defineNuxtModule,
  createResolver,
  addPlugin,
  addServerPlugin,
  addTemplate,
  useLogger,
} from '@nuxt/kit';
import { name as pkgName, version as pkgVersion } from '../package.json';
import type {
  AllStakModuleOptions,
  AllStakClientConfig,
  AllStakServerConfig,
} from './types';

export type {
  AllStakModuleOptions,
  AllStakClientConfig,
  AllStakServerConfig,
  AutoInjectServerStrategy,
  SourceMapsUploadOptions,
  AllStakPublicRuntimeConfig,
} from './types';

export const SDK_NAME = 'allstak-nuxt';
declare const __ALLSTAK_NUXT_VERSION__: string;
export const SDK_VERSION: string =
  typeof __ALLSTAK_NUXT_VERSION__ === 'string' ? __ALLSTAK_NUXT_VERSION__ : pkgVersion;

/**
 * `@allstak/nuxt` — the official AllStak Nuxt module.
 *
 * Wiring it is a one-liner in `nuxt.config.ts`:
 *
 *   export default defineNuxtConfig({
 *     modules: ['@allstak/nuxt'],
 *     runtimeConfig: {
 *       public: {
 *         allstak: { apiKey: process.env.ALLSTAK_API_KEY },
 *       },
 *     },
 *   });
 *
 * The module:
 *   - registers a client plugin that delegates to `@allstak/vue`'s
 *     `AllStakPlugin` (init + Vue glue) and wires Nuxt error hooks + router
 *     navigation spans;
 *   - registers a Nitro server plugin that calls `AllStak.init` on the server,
 *     captures unhandled server errors, wraps every request in a span, and
 *     injects SSR trace meta tags;
 *   - reads `runtimeConfig.public.allstak` for `apiKey`/`environment`/`release`
 *     /`host`/`dist` so secrets never have to live in `nuxt.config`;
 *   - exposes split client/server configuration through the
 *     `allstak.client` / `allstak.server` module options.
 */
export default defineNuxtModule<AllStakModuleOptions>({
  meta: {
    name: pkgName,
    version: pkgVersion,
    configKey: 'allstak',
    compatibility: {
      // Hooks/APIs used (nuxtApp.hook('vue:error'), addServerPlugin, render:html)
      // are stable from 3.7; recommend >= 3.14. Nuxt 4 supported.
      nuxt: '>=3.7.0',
    },
  },
  defaults: {
    enabled: true,
    client: true,
    server: true,
    injectTraceMetaTags: true,
    autoInjectServerAllStak: 'plugin',
    experimental_entrypointWrappedFunctions: ['default', 'handler', 'server'],
    debug: false,
  },
  setup(options, nuxt) {
    const logger = useLogger(pkgName);

    if (options.enabled === false) {
      if (options.debug) logger.info('disabled via `allstak.enabled: false` — skipping setup');
      return;
    }

    const resolver = createResolver(import.meta.url);
    const runtimeDir = fileURLToPath(new URL('./runtime', import.meta.url));
    nuxt.options.build.transpile.push(runtimeDir);

    // ---- runtimeConfig.public.allstak defaults --------------------------
    // Ensure the public namespace exists so a host only has to set `apiKey`.
    // We don't overwrite anything the host already provided.
    nuxt.options.runtimeConfig.public = nuxt.options.runtimeConfig.public || {};
    const existingPublic =
      (nuxt.options.runtimeConfig.public as Record<string, unknown>).allstak as
        | Record<string, unknown>
        | undefined;
    (nuxt.options.runtimeConfig.public as Record<string, unknown>).allstak = {
      apiKey: '',
      ...(existingPublic ?? {}),
    };

    // ---- serialise resolved client/server config for the runtime --------
    const clientConfig: AllStakClientConfig =
      typeof options.client === 'object' ? options.client : {};
    const serverConfig: AllStakServerConfig =
      typeof options.server === 'object' ? options.server : {};

    // The runtime plugins read these build-time defines. We expose them via
    // Vite/Nitro `define` so they're inlined and tree-shakeable.
    //
    // `__ALLSTAK_NUXT_VERSION__` is injected here (from this module's own
    // package version) rather than at module-build time: module-builder
    // transpiles the runtime tree with mkdist, which does NOT run rollup's
    // replace plugin, so the constant must be supplied by the host's Vite/Nitro
    // build instead. The runtime falls back to a clearly-marked dev string if a
    // tool evaluates it without this define.
    const defines: Record<string, string> = {
      __ALLSTAK_NUXT_VERSION__: JSON.stringify(pkgVersion),
      __ALLSTAK_CLIENT_CONFIG__: JSON.stringify(clientConfig),
      __ALLSTAK_SERVER_CONFIG__: JSON.stringify(serverConfig),
      __ALLSTAK_INJECT_META__: JSON.stringify(options.injectTraceMetaTags !== false),
    };

    nuxt.options.vite = nuxt.options.vite || {};
    nuxt.options.vite.define = { ...(nuxt.options.vite.define ?? {}), ...defines };

    nuxt.options.nitro = nuxt.options.nitro || {};
    // `replace` is the Nitro/rollup-side equivalent of Vite's `define`.
    nuxt.options.nitro.replace = { ...(nuxt.options.nitro.replace ?? {}), ...defines };

    // ---- client plugin ---------------------------------------------------
    if (options.client !== false) {
      addPlugin({
        src: resolver.resolve('./runtime/plugins/allstak.client'),
        mode: 'client',
        order: 0,
      });
      if (options.debug) logger.info('registered client plugin');
    }

    // ---- server (Nitro) plugin ------------------------------------------
    if (options.server !== false) {
      const strategy = options.autoInjectServerAllStak ?? 'plugin';

      // The `plugin` strategy is the portable default and is always wired so
      // the `error`/`render:html`/request-span hooks exist. The other two
      // strategies are additive injection points; the
      // server plugin itself is idempotent (`ensureInit` guards double-init).
      addServerPlugin(resolver.resolve('./runtime/server/plugin'));

      if (strategy === 'top-level-import') {
        // Import the server plugin at the top of the Nitro entry so init runs
        // before the first handler, not lazily on first request.
        nuxt.options.nitro.plugins = nuxt.options.nitro.plugins || [];
        nuxt.options.nitro.plugins.push(resolver.resolve('./runtime/server/plugin'));
        if (options.debug) logger.info("server strategy 'top-level-import' wired");
      } else if (strategy === 'experimental_dynamic-import') {
        // Mark entry functions to be wrapped; the host build's Nitro rollup
        // step honours `experimental_entrypointWrappedFunctions`.
        nuxt.options.nitro.virtual = nuxt.options.nitro.virtual || {};
        const wrapped =
          options.experimental_entrypointWrappedFunctions ?? ['default', 'handler', 'server'];
        nuxt.options.nitro.virtual['#allstak-entrypoint-functions'] =
          `export const wrapped = ${JSON.stringify(wrapped)};`;
        if (options.debug) {
          logger.info(
            `server strategy 'experimental_dynamic-import' wrapping: ${wrapped.join(', ')}`,
          );
        }
      }

      if (options.debug) logger.info('registered Nitro server plugin');
    }

    // ---- source-map upload notice ---------------------------------------
    // The upload itself is performed by the AllStak source-map tooling / CLI
    // against the AllStak ingest endpoint. We surface a build-time virtual so
    // a host's bundler config can read the resolved options in one place.
    if (options.sourceMapsUploadOptions?.enabled) {
      addTemplate({
        filename: 'allstak-sourcemaps-options.mjs',
        getContents: () =>
          `export default ${JSON.stringify(options.sourceMapsUploadOptions ?? {}, null, 2)};\n`,
      });
      // 'hidden' generates client maps without emitting the sourceMappingURL
      // comment, avoiding browser 404s — the convention for upload-then-delete.
      if (typeof nuxt.options.sourcemap === 'object') {
        if (nuxt.options.sourcemap.client === undefined) {
          nuxt.options.sourcemap.client = 'hidden';
        }
      } else if (nuxt.options.sourcemap === undefined) {
        nuxt.options.sourcemap = { client: 'hidden', server: true };
      }
      if (options.debug) logger.info('source-map upload options surfaced');
    }

    if (options.debug) {
      logger.success(`${pkgName}@${pkgVersion} ready (configKey: allstak)`);
    }
  },
});
