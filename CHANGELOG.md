# Changelog

All notable changes to `@allstak/nuxt` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] — 2026-05-30

Maintenance release. No public API changes.

### Changed

- Refreshed the published build artifacts and confirmed the module resolves
  against the current `@allstak/js` and `@allstak/vue` releases.
- Tidied source comments and documentation wording.

## [0.1.0] — 2026-05-29

Initial release of the official AllStak SDK for Nuxt 3 / Nuxt 4, shipped as a
Nuxt module built with `@nuxt/module-builder`.

### Added

- `@allstak/nuxt` Nuxt module (`defineNuxtModule`, config key `allstak`,
  compatibility `nuxt >= 3.7`, Nuxt 4 supported). Register it in
  `nuxt.config.ts` `modules: ['@allstak/nuxt']`.
- Client runtime plugin (registered via `addPlugin`, `mode: 'client'`,
  `order: 0`) that:
  - delegates init and the Vue-side glue to `@allstak/vue`'s `AllStakPlugin`,
    stamping the wrapper identity (`sdkName: 'allstak-nuxt'`, `sdkVersion`) so
    backend ingest can distinguish Nuxt traffic;
  - sets `attachErrorHandler: false` so it does not hijack
    `app.config.errorHandler` — error capture is driven through Nuxt hooks;
  - captures uncaught client errors via the `vue:error` and `app:error` Nuxt
    hooks through a shared `reportNuxtError` helper, filtering expected
    3xx/4xx statuses;
  - opens a `navigation` span and breadcrumb per route change (`page:start` →
    `page:finish`), guarded by a tree-shakeable tracing flag.
- Nitro server plugin (registered via `addServerPlugin`) that:
  - calls `AllStak.init` on the server, reading `runtimeConfig.public.allstak`
    with a `process.env` fallback, stamped with the Nuxt SDK identity;
  - captures unhandled server errors via the Nitro `error` hook with the H3
    event context, ignoring expected 3xx/4xx;
  - wraps every request in an `http.server` span (`request` → finished on
    `beforeResponse` / `afterResponse` with the response status);
  - injects trace meta tags into the SSR `<head>` via `render:html` for
    client↔server trace continuity, skipped for pre-rendered / SWR-cached
    responses.
- Module options: `enabled`, `client`, `server`, `injectTraceMetaTags`,
  `autoInjectServerAllStak` (`'plugin'` | `'top-level-import'` |
  `'experimental_dynamic-import'`), `experimental_entrypointWrappedFunctions`,
  `sourceMapsUploadOptions`, and `debug`.
- `client.config` / `server.config`-equivalent init configuration via the
  `allstak.client` / `allstak.server` module options (sampling, filters, and
  every option `AllStak.init` accepts).
- `runtimeConfig.public.allstak` read for `apiKey` / `host` / `environment` /
  `release` / `dist`, with sensible defaults seeded by the module.
- Client surface (`@allstak/nuxt/client`) re-exporting the full `@allstak/vue`
  API; server surface (`@allstak/nuxt/server`) re-exporting the full
  `@allstak/js` API. Both export `SDK_NAME` and `SDK_VERSION`.
- The SDK version is injected at build time from `package.json`
  (`__ALLSTAK_NUXT_VERSION__`), never hand-written, so it cannot drift.

[0.1.1]: https://github.com/AllStak/allstak-nuxt/releases/tag/v0.1.1
[0.1.0]: https://github.com/AllStak/allstak-nuxt/releases/tag/v0.1.0
