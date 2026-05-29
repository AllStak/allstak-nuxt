import { AllStak } from '@allstak/js';
import type { Span } from '@allstak/js';
// `nitropack` provides `defineNitroPlugin` and the runtime config accessor.
// They're resolved by the host's Nitro build; we declare loose types here so
// the module typechecks standalone without a hard nitropack dependency.
import { defineNitroPlugin, useRuntimeConfig } from 'nitropack/runtime';
import { SDK_NAME, SDK_VERSION } from '../version';
import type { AllStakPublicRuntimeConfig } from '../shared-options';

/**
 * Server-side init config, serialised into the build by the module from the
 * resolved `server` option.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const __ALLSTAK_SERVER_CONFIG__: Record<string, any>;
const baseServerConfig: Record<string, unknown> =
  typeof __ALLSTAK_SERVER_CONFIG__ !== 'undefined' ? __ALLSTAK_SERVER_CONFIG__ : {};

/**
 * Whether the module asked us to inject SSR trace meta tags. Serialised by the
 * module from `injectTraceMetaTags`.
 */
declare const __ALLSTAK_INJECT_META__: boolean;
const injectMetaTags: boolean =
  typeof __ALLSTAK_INJECT_META__ !== 'undefined' ? __ALLSTAK_INJECT_META__ : true;

/**
 * Init-once guard, parked on `globalThis` so it survives across the (possibly
 * re-imported) Nitro plugin module within a single process and can be reset by
 * tests. A module-level boolean would make the guard untestable and could be
 * duplicated if the plugin module is evaluated more than once.
 */
const INIT_FLAG = '__allstakNuxtServerInitialised__';

/** 3xx/4xx are expected control flow, not Issues. */
function isExpectedHttpStatus(error: unknown): boolean {
  const status = (error as { statusCode?: number; status?: number } | null)?.statusCode
    ?? (error as { statusCode?: number; status?: number } | null)?.status;
  return typeof status === 'number' && status >= 300 && status < 500;
}

/**
 * Initialise the server SDK exactly once. The Nitro server boots before Nuxt's
 * runtime config is fully assembled in some presets, so we read the public
 * config via `useRuntimeConfig()` here (callable inside a Nitro plugin) and
 * fall back to `process.env` for the build-artifact / top-level-import
 * strategies where runtime config isn't available yet.
 */
function ensureInit(): void {
  const g = globalThis as Record<string, unknown>;
  if (g[INIT_FLAG]) return;
  g[INIT_FLAG] = true;

  let publicConfig: AllStakPublicRuntimeConfig = {};
  try {
    const runtime = useRuntimeConfig() as { public?: { allstak?: AllStakPublicRuntimeConfig } };
    publicConfig = runtime?.public?.allstak ?? {};
  } catch {
    // useRuntimeConfig is unavailable outside a request scope in some presets.
  }

  const apiKey =
    publicConfig.apiKey
    ?? (baseServerConfig.apiKey as string | undefined)
    ?? process.env.ALLSTAK_API_KEY
    ?? '';

  try {
    AllStak.init({
      ...(baseServerConfig as Record<string, unknown>),
      apiKey,
      host: publicConfig.host ?? (baseServerConfig.host as string | undefined) ?? process.env.ALLSTAK_HOST,
      environment:
        publicConfig.environment
        ?? (baseServerConfig.environment as string | undefined)
        ?? process.env.NODE_ENV,
      release:
        publicConfig.release
        ?? (baseServerConfig.release as string | undefined)
        ?? process.env.APP_VERSION,
      dist: publicConfig.dist ?? (baseServerConfig.dist as string | undefined),
      sdkName: SDK_NAME,
      sdkVersion: SDK_VERSION,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
  } catch {
    // A misconfigured key must not crash the server boot.
  }
}

/**
 * Nitro server plugin (registered via `addServerPlugin`).
 *
 *   1. `AllStak.init` on the server, stamped with the Nuxt SDK identity.
 *   2. `request` → open a per-request span; `afterResponse` / `beforeResponse`
 *      → finish it with the response status, so every server request is wrapped
 *      in a span.
 *   3. `error` hook → `captureException` with the H3 event context (ignoring
 *      expected 3xx/4xx).
 *   4. `render:html` → inject trace meta tags into the SSR `<head>` so the
 *      client continues the server's trace. Skipped for pre-render / SWR.
 */
export default defineNitroPlugin((nitroApp) => {
  ensureInit();

  // We stash the in-flight span on the H3 event context so request/response
  // hooks can correlate without a shared mutable. Hook params are read through
  // the loose `AllStakH3Event` view (not annotated on the callbacks) so we
  // don't fight Nitro's own `H3Event` hook signatures.
  const SPAN_KEY = '_allstakSpan';

  // Loose accessor so we never annotate a hook callback with a shape that
  // conflicts with Nitro's typed hook signatures.
  const ev = (event: unknown): AllStakH3Event => event as AllStakH3Event;

  // 2. Per-request span -----------------------------------------------------
  nitroApp.hooks.hook('request', (event) => {
    const e = ev(event);
    try {
      const method = e?.method ?? e?.node?.req?.method ?? 'GET';
      const path = e?.path ?? e?.node?.req?.url ?? '/';
      const span = AllStak.startSpan('http.server', {
        description: `${method} ${path}`,
        attributes: {
          'allstak.origin': 'auto.http.server.nuxt',
          'http.method': String(method),
          'http.target': String(path),
        },
      });
      (e.context as Record<string, unknown>)[SPAN_KEY] = span;
    } catch {
      // ignore — never block the request on tracing
    }
  });

  const finishSpan = (event: unknown, status?: number) => {
    const e = ev(event);
    try {
      const span = (e?.context as Record<string, unknown> | undefined)?.[SPAN_KEY] as
        | Span
        | undefined;
      if (!span) return;
      if (typeof status === 'number') span.setTag('http.status_code', String(status));
      span.finish(typeof status === 'number' && status >= 500 ? 'error' : 'ok');
      delete (e.context as Record<string, unknown>)[SPAN_KEY];
    } catch {
      // ignore
    }
  };

  nitroApp.hooks.hook('beforeResponse', (event, response) => {
    const e = ev(event);
    const status = e?.node?.res?.statusCode ?? (response as { status?: number })?.status;
    finishSpan(event, status);
  });

  nitroApp.hooks.hook('afterResponse', (event) => {
    // Safety net: finish any span that beforeResponse didn't (e.g. streamed).
    finishSpan(event, ev(event)?.node?.res?.statusCode);
  });

  // 3. Unhandled server errors ---------------------------------------------
  nitroApp.hooks.hook('error', (error, context) => {
    if (isExpectedHttpStatus(error)) return;
    const e = context?.event ? ev(context.event) : undefined;
    try {
      // Finish the request span as errored before reporting.
      if (e) finishSpan(e, 500);
      AllStak.captureException(error instanceof Error ? error : new Error(String(error)), {
        framework: 'nuxt',
        source: 'nitro:error',
        method: e?.method ?? e?.node?.req?.method,
        path: e?.path ?? e?.node?.req?.url,
      });
    } catch {
      // ignore
    }
  });

  // 4. SSR trace meta-tag injection ----------------------------------------
  if (injectMetaTags) {
    // `render:html` isn't part of the statically-typed NitroRuntimeHooks union
    // in every Nitro version, so register it through a loosened hook view.
    const looseHook = nitroApp.hooks.hook as unknown as (
      name: string,
      cb: (html: { head: string[] }, context: { event?: unknown }) => void,
    ) => void;
    looseHook('render:html', (html, context) => {
      try {
        const e = context?.event ? ev(context.event) : undefined;
        if (isPrerenderOrSwr(e)) return;
        const traceId = AllStak.getTraceId?.();
        const spanId = AllStak.getCurrentSpanId?.();
        if (!traceId) return;
        const traceParent = spanId ? `${traceId}-${spanId}` : traceId;
        html.head.push(`<meta name="allstak-trace" content="${escapeAttr(traceParent)}">`);
        html.head.push(`<meta name="baggage" content="${escapeAttr(`allstak-trace_id=${traceId}`)}">`);
      } catch {
        // ignore — meta-tag stitching is best-effort
      }
    });
  }
});

/** Minimal H3 event shape we touch — kept loose to avoid an h3 hard dep. */
interface AllStakH3Event {
  method?: string;
  path?: string;
  context: Record<string, unknown> & {
    routeRules?: { swr?: unknown; isr?: unknown };
  };
  node?: {
    req?: { method?: string; url?: string };
    res?: { statusCode?: number; getHeaders?: () => Record<string, unknown> };
  };
  res?: { headers?: unknown };
}

/**
 * Detect pre-rendered or SWR/ISR-cached responses; injecting per-request trace
 * tags into a cached document would stitch every visitor to one stale trace.
 * Covers H3 v1 (`event.node.res`) and the `routeRules.swr/isr` markers.
 */
function isPrerenderOrSwr(event?: AllStakH3Event): boolean {
  if (!event) return true;
  const rules = event.context?.routeRules;
  if (rules && (rules.swr || rules.isr)) return true;
  return false;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
