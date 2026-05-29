import { AllStakPlugin, type AllStakVueOptions } from '@allstak/vue';
import { AllStak } from '@allstak/js';
import type { Span } from '@allstak/js';
import { defineNuxtPlugin, useRuntimeConfig } from '#imports';
import { SDK_NAME, SDK_VERSION } from '../version';
import type { AllStakPublicRuntimeConfig } from '../shared-options';

/**
 * Read the client-side init config baked into the build by the module. The
 * module serialises the resolved `client` option into this virtual template
 * value, so a host can set sampling/filters in `nuxt.config.ts`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const __ALLSTAK_CLIENT_CONFIG__: Record<string, any>;
const baseClientConfig: Record<string, unknown> =
  typeof __ALLSTAK_CLIENT_CONFIG__ !== 'undefined' ? __ALLSTAK_CLIENT_CONFIG__ : {};

/**
 * Filter out expected non-error navigation/HTTP statuses so we don't report a
 * 3xx/4xx as an Issue. Mirrors the Nuxt convention of ignoring those in the
 * `app:error` hook.
 */
function isExpectedHttpStatus(error: unknown): boolean {
  const status = (error as { statusCode?: number; status?: number } | null)?.statusCode
    ?? (error as { statusCode?: number; status?: number } | null)?.status;
  return typeof status === 'number' && status >= 300 && status < 500;
}

/**
 * Funnel every captured client error through one helper so the context shape
 * (framework, source, component, lifecycle hook) stays consistent. This is the
 * AllStak equivalent of the Nuxt SDK's internal `reportNuxtError`.
 */
function reportNuxtError(args: {
  error: unknown;
  instance?: unknown;
  info?: string;
  source: string;
}): void {
  const { error, instance, info, source } = args;
  if (isExpectedHttpStatus(error)) return;
  try {
    AllStak.captureException(error instanceof Error ? error : new Error(String(error)), {
      framework: 'nuxt',
      source,
      componentName: (instance as { $options?: { name?: string } } | null)?.$options?.name,
      lifecycleHook: info,
    });
  } catch {
    // Never let our handler break the host's error path.
  }
}

/**
 * Client runtime plugin (registered via `addPlugin`, order 0 so it runs early).
 *
 * Responsibilities:
 *   1. `app.use(AllStakPlugin, …)` — delegate init + the Vue-side glue to the
 *      shared `@allstak/vue` SDK. `attachErrorHandler: false` so we do NOT
 *      hijack `app.config.errorHandler` (which would swallow Nuxt's own 500
 *      handling); error capture is driven through the Nuxt hooks below instead.
 *   2. `vue:error` / `app:error` Nuxt hooks → `reportNuxtError` (filtering
 *      expected 3xx/4xx).
 *   3. Router instrumentation → a `navigation` span per route change, finished
 *      on `page:finish`, guarded by the tree-shakeable `__ALLSTAK_TRACING__`
 *      flag.
 */
export default defineNuxtPlugin({
  name: 'allstak:client',
  enforce: 'pre',
  setup(nuxtApp) {
    const runtime = useRuntimeConfig();
    const publicConfig =
      ((runtime.public as { allstak?: AllStakPublicRuntimeConfig } | undefined)?.allstak) ?? {};

    // apiKey/environment/release/dist come from runtimeConfig.public.allstak;
    // everything else (sampling, filters, …) from the build-time client config.
    const options: AllStakVueOptions = {
      ...baseClientConfig,
      apiKey: publicConfig.apiKey ?? (baseClientConfig.apiKey as string | undefined) ?? '',
      host: publicConfig.host ?? (baseClientConfig.host as string | undefined),
      environment: publicConfig.environment ?? (baseClientConfig.environment as string | undefined),
      release: publicConfig.release ?? (baseClientConfig.release as string | undefined),
      dist: publicConfig.dist ?? (baseClientConfig.dist as string | undefined),
      sdkName: SDK_NAME,
      sdkVersion: SDK_VERSION,
      // Drive capture through Nuxt hooks, not Vue's errorHandler.
      attachErrorHandler: false,
    };

    nuxtApp.vueApp.use(AllStakPlugin, options);

    // 2. Error hooks --------------------------------------------------------
    nuxtApp.hook('vue:error', (error, instance, info) => {
      reportNuxtError({ error, instance, info, source: 'vue:error' });
    });

    nuxtApp.hook('app:error', (error) => {
      reportNuxtError({ error, source: 'app:error' });
    });

    // 3. Router / navigation tracing ---------------------------------------
    // `__ALLSTAK_TRACING__` is a tree-shakeable flag; bundlers that define it
    // to `false` drop this whole block, matching the framework convention.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tracingFlag = (globalThis as any).__ALLSTAK_TRACING__;
    if (tracingFlag === false) return;

    let activeNavSpan: Span | null = null;

    nuxtApp.hook('page:start', () => {
      // `useRouter()` isn't safely callable here, so read the route off the
      // app context. The router exposes the in-flight route via $route.
      const to = (nuxtApp.$router as { currentRoute?: { value?: { fullPath?: string; path?: string; name?: unknown } } } | undefined)?.currentRoute?.value;
      try {
        AllStak.addBreadcrumb({
          type: 'navigation',
          message: `→ ${String(to?.fullPath ?? '')}`,
          level: 'info',
          data: {
            name: String(to?.name ?? ''),
            fullPath: String(to?.fullPath ?? ''),
          },
        });
        activeNavSpan = AllStak.startSpan('navigation', {
          description: String(to?.fullPath ?? ''),
          attributes: {
            'allstak.origin': 'auto.navigation.nuxt',
            'route.name': String(to?.name ?? ''),
            'route.path': String(to?.path ?? ''),
          },
        });
      } catch {
        // never block navigation on observability errors
      }
    });

    nuxtApp.hook('page:finish', () => {
      try {
        activeNavSpan?.finish('ok');
      } catch {
        // ignore
      } finally {
        activeNavSpan = null;
      }
    });
  },
});
