import type { AllStakConfig } from '@allstak/js';

/**
 * Strategy for getting the server-side AllStak init to run. The Nitro server
 * boots before Nuxt's runtime config is fully assembled, so the server SDK is
 * configured from `runtimeConfig.public.allstak` (read inside the server
 * plugin) and these strategies control how/when the server plugin is wired:
 *
 *   - `'plugin'` (default): register a Nitro plugin via `addServerPlugin()`.
 *     The plugin calls `AllStak.init` lazily on the first server request /
 *     Nitro `error` hook. This is the portable default that works on every
 *     Nitro preset (node-server, edge, serverless).
 *   - `'top-level-import'`: in addition to the plugin, the module can be
 *     instructed (by the host build) to import the server config at the top
 *     of the Nitro entry. Surfaced for parity / forward compatibility.
 *   - `'experimental_dynamic-import'`: wrap the Nitro entrypoint functions so
 *     the server SDK is imported dynamically before the handler runs.
 */
export type AutoInjectServerStrategy =
  | 'plugin'
  | 'top-level-import'
  | 'experimental_dynamic-import';

/**
 * Source-map upload options surfaced for parity with the build-integration
 * story. Upload itself is performed by `@allstak/js`'s source-map tooling /
 * the AllStak CLI against the AllStak source-map ingest endpoint; the module
 * threads these values through so a host can configure them in one place.
 */
export interface SourceMapsUploadOptions {
  /** Enable source-map upload during production build. Default: `false`. */
  enabled?: boolean;
  /** AllStak organisation slug. */
  org?: string;
  /** AllStak project slug. */
  project?: string;
  /** Upload auth token. Prefer an env var over committing this. */
  authToken?: string;
  /** Override the upload endpoint (defaults to the configured AllStak host). */
  url?: string;
  /** Suppress upload logging. Default: `false`. */
  silent?: boolean;
  /** Release name the maps are associated with. */
  release?: { name?: string };
  /** Which emitted assets to scan, ignore, and clean up after upload. */
  sourcemaps?: {
    assets?: string | string[];
    ignore?: string | string[];
    filesToDeleteAfterUpload?: string | string[];
  };
}

/**
 * `@allstak/nuxt` module options. Configured under the `allstak` key in
 * `nuxt.config.ts`:
 *
 *   export default defineNuxtConfig({
 *     modules: ['@allstak/nuxt'],
 *     allstak: {
 *       enabled: true,
 *       client: { tracesSampleRate: 1.0 },
 *       server: { tracesSampleRate: 1.0 },
 *     },
 *     runtimeConfig: {
 *       public: {
 *         allstak: {
 *           apiKey: process.env.ALLSTAK_API_KEY,
 *           environment: process.env.NODE_ENV,
 *           release: process.env.APP_VERSION,
 *         },
 *       },
 *     },
 *   });
 */
export interface AllStakModuleOptions {
  /** Master switch. When `false` the module registers nothing. Default: `true`. */
  enabled?: boolean;

  /**
   * Wire the client runtime plugin (error capture + router/navigation spans).
   * Default: `true`.
   */
  client?: boolean | AllStakClientConfig;

  /**
   * Wire the Nitro server plugin (unhandled-error capture + per-request span +
   * SSR trace meta-tag injection). Default: `true`.
   */
  server?: boolean | AllStakServerConfig;

  /**
   * Inject `<meta name="allstak-trace">` / `<meta name="baggage">` tags into
   * the SSR HTML head so the client can continue the server's trace. Default:
   * `true`. Skipped automatically for pre-rendered / SWR-cached responses.
   */
  injectTraceMetaTags?: boolean;

  /** Server-init injection strategy. Default: `'plugin'`. */
  autoInjectServerAllStak?: AutoInjectServerStrategy;

  /**
   * Entry function names wrapped by the `'experimental_dynamic-import'`
   * strategy. Default: `['default', 'handler', 'server']`.
   */
  experimental_entrypointWrappedFunctions?: string[];

  /** Source-map upload configuration (build-time). */
  sourceMapsUploadOptions?: SourceMapsUploadOptions;

  /** Emit verbose module + runtime logging. Default: `false`. */
  debug?: boolean;
}

/**
 * Client-side init config. A subset/passthrough of `AllStakConfig` so a host
 * can set sampling, filters, and tracing in `nuxt.config.ts`. Secrets
 * (`apiKey`) should live in `runtimeConfig.public.allstak`, not here.
 */
export type AllStakClientConfig = Partial<AllStakConfig>;

/** Server-side init config. Same passthrough shape as the client. */
export type AllStakServerConfig = Partial<AllStakConfig>;

/**
 * Shape the module writes into `runtimeConfig.public.allstak`. Only the public
 * fields belong here — they ship to the browser. The `apiKey` is a publishable
 * ingest key (the same key the other browser SDKs use), not a server secret.
 */
export interface AllStakPublicRuntimeConfig {
  apiKey?: string;
  host?: string;
  environment?: string;
  release?: string;
  dist?: string;
}
