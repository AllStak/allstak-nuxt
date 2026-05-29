# @allstak/nuxt

[![npm](https://img.shields.io/npm/v/@allstak/nuxt.svg)](https://www.npmjs.com/package/@allstak/nuxt)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Official AllStak SDK for **Nuxt 3 / Nuxt 4**, shipped as a Nuxt module. Captures uncaught errors on the client and the Nitro server, wraps every server request in a span, opens navigation spans on route changes, stitches client↔server traces through SSR meta tags, and surfaces the full AllStak observability API on both runtimes.

Built on `@allstak/vue` (client) and `@allstak/js` (server).

## Install

```bash
npm install @allstak/nuxt
# or
pnpm add @allstak/nuxt
# or
yarn add @allstak/nuxt
```

`nuxt@^3.7 || ^4` is a peer dependency. Nuxt >= 3.14 is recommended.

## Setup

Register the module and provide your ingest key through `runtimeConfig`:

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['@allstak/nuxt'],

  runtimeConfig: {
    public: {
      allstak: {
        apiKey: process.env.ALLSTAK_API_KEY,
        environment: process.env.NODE_ENV,
        release: process.env.APP_VERSION,
      },
    },
  },

  // Optional — client.config / server.config-equivalent options:
  allstak: {
    client: { tracesSampleRate: 1.0 },
    server: { tracesSampleRate: 1.0 },
  },
});
```

That single entry wires:

- **Client** — delegates init and the Vue glue to `@allstak/vue`'s plugin (with `attachErrorHandler: false` so Nuxt's own error handling isn't hijacked), captures errors via the `vue:error` and `app:error` hooks, and opens a `navigation` span per route change.
- **Server (Nitro)** — calls `AllStak.init` on the server, captures unhandled errors via the Nitro `error` hook, wraps each request in an `http.server` span, and injects trace meta tags into the SSR `<head>`.
- Reads `runtimeConfig.public.allstak` for `apiKey` / `host` / `environment` / `release` / `dist` so secrets never have to live in `nuxt.config`.

## Using the API

The full client API is available from `@allstak/nuxt/client`, and the full server API from `@allstak/nuxt/server`:

```ts
// A client component
import { AllStak, useAllStak } from '@allstak/nuxt/client';

const allstak = useAllStak();
allstak.captureException(new Error('payment declined'));
```

```ts
// server/api/orders.post.ts
import { AllStak } from '@allstak/nuxt/server';

export default defineEventHandler(async (event) => {
  AllStak.addBreadcrumb({ type: 'order', message: 'creating order' });
  // ...
});
```

## Module options

Configured under the `allstak` key in `nuxt.config.ts`:

| Option | Default | Purpose |
|---|---|---|
| `enabled` | `true` | Master switch. `false` registers nothing. |
| `client` | `true` | Wire the client plugin. Pass an object to set client init config (sampling, filters, …). |
| `server` | `true` | Wire the Nitro server plugin. Pass an object to set server init config. |
| `injectTraceMetaTags` | `true` | Inject SSR trace meta tags for client↔server trace continuity (skipped for pre-render / SWR). |
| `autoInjectServerAllStak` | `'plugin'` | Server-init strategy: `'plugin'`, `'top-level-import'`, or `'experimental_dynamic-import'`. |
| `experimental_entrypointWrappedFunctions` | `['default','handler','server']` | Entry functions wrapped by the dynamic-import strategy. |
| `sourceMapsUploadOptions` | — | Source-map upload config (`org`, `project`, `authToken`, `release`, `sourcemaps`). Enables `sourcemap.client: 'hidden'`. |
| `debug` | `false` | Verbose module + runtime logging. |

### Public runtime config

The browser-safe ingest config lives under `runtimeConfig.public.allstak`:

| Field | Purpose |
|---|---|
| `apiKey` | Publishable ingest key. |
| `host` | Override the AllStak ingest host. |
| `environment` | Deployment environment (e.g. `production`). |
| `release` | Release identifier for grouping. |
| `dist` | Build distribution identifier. |

The server plugin also reads `ALLSTAK_API_KEY` / `ALLSTAK_HOST` / `APP_VERSION` from `process.env` as a fallback for the build-artifact and top-level-import server-init strategies, where runtime config may not be assembled yet.

## License

MIT
