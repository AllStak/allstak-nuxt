/**
 * @allstak/nuxt wrapper tests.
 *
 * These exercise the Nuxt-side glue (client plugin error hooks + navigation
 * spans, Nitro server plugin init/error/request-span/meta-tag injection)
 * against fully in-memory fakes of `@allstak/js`, `@allstak/vue`, `#imports`,
 * and `nitropack/runtime`. No transport, no network, no timers — every core
 * call is recorded synchronously so assertions are deterministic.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Shared call registry. Built inside vi.hoisted() because vi.mock factories are
// hoisted above module-scope variables. `calls` is a stable reference the
// assertions read from.
// ---------------------------------------------------------------------------
interface FakeSpan {
  op: string;
  options: Record<string, unknown>;
  tags: Record<string, string>;
  finished: Array<string | undefined>;
  finish: (status?: string) => void;
  setTag: (k: string, v: string) => FakeSpan;
  setMeasurement: (k: string, v: number) => FakeSpan;
  setData: (d: string) => FakeSpan;
  setDescription: (d: string) => FakeSpan;
}

interface Calls {
  init: Array<Record<string, unknown>>;
  captureException: Array<{ error: Error; context?: Record<string, unknown> }>;
  addBreadcrumb: Array<Record<string, unknown>>;
  spans: FakeSpan[];
  vuePluginUses: Array<Record<string, unknown>>;
}

const { calls } = vi.hoisted(() => {
  const calls: Calls = {
    init: [],
    captureException: [],
    addBreadcrumb: [],
    spans: [],
    vuePluginUses: [],
  };
  return { calls };
});

vi.mock('@allstak/js', () => {
  function makeSpan(op: string, options: Record<string, unknown>): FakeSpan {
    const span: FakeSpan = {
      op,
      options,
      tags: {},
      finished: [],
      finish(status?: string) {
        this.finished.push(status);
      },
      setTag(k: string, v: string) {
        this.tags[k] = v;
        return this;
      },
      setMeasurement() {
        return this;
      },
      setData() {
        return this;
      },
      setDescription() {
        return this;
      },
    };
    return span;
  }

  const fakeAllStak = {
    init(config: Record<string, unknown>) {
      calls.init.push(config);
      return fakeAllStak;
    },
    captureException(error: Error, context?: Record<string, unknown>) {
      calls.captureException.push({ error, context });
    },
    addBreadcrumb(crumb: Record<string, unknown>) {
      calls.addBreadcrumb.push(crumb);
    },
    startSpan(operation: string, options: Record<string, unknown> = {}) {
      const span = makeSpan(operation, options);
      calls.spans.push(span);
      return span;
    },
    getTraceId() {
      return 'trace-abc';
    },
    getCurrentSpanId() {
      return 'span-xyz';
    },
  };

  return { AllStak: fakeAllStak, Span: class {} };
});

vi.mock('@allstak/vue', () => {
  // The Vue SDK's plugin is recorded so we can assert the client plugin
  // delegates init to it with the right options (sdkName, attachErrorHandler).
  const AllStakPlugin = {
    install(_app: unknown, options: Record<string, unknown>) {
      calls.vuePluginUses.push(options);
    },
  };
  return { AllStakPlugin };
});

// #imports provides defineNuxtPlugin + useRuntimeConfig in the Nuxt runtime.
vi.mock('#imports', () => {
  return {
    // defineNuxtPlugin returns the plugin object/definition unchanged so the
    // test can grab its `.setup` and call it with a fake nuxtApp.
    defineNuxtPlugin: (def: unknown) => def,
    useRuntimeConfig: () => fakeRuntimeConfig,
  };
});

// nitropack/runtime provides defineNitroPlugin + useRuntimeConfig server-side.
vi.mock('nitropack/runtime', () => {
  return {
    defineNitroPlugin: (fn: unknown) => fn,
    useRuntimeConfig: () => fakeRuntimeConfig,
  };
});

let fakeRuntimeConfig: { public: { allstak: Record<string, unknown> } };

// Import AFTER the mocks are registered.
import clientPlugin from '../src/runtime/plugins/allstak.client';
import serverPlugin from '../src/runtime/server/plugin';

beforeEach(() => {
  calls.init.length = 0;
  calls.captureException.length = 0;
  calls.addBreadcrumb.length = 0;
  calls.spans.length = 0;
  calls.vuePluginUses.length = 0;
  // Reset the server plugin's init-once guard so each test inits cleanly.
  delete (globalThis as Record<string, unknown>).__allstakNuxtServerInitialised__;
  fakeRuntimeConfig = {
    public: {
      allstak: {
        apiKey: 'ask_test',
        environment: 'test',
        release: '1.2.3',
      },
    },
  };
});

// ---------------------------------------------------------------------------
// Fake nuxtApp with a hook registry the tests can fire directly.
// ---------------------------------------------------------------------------
function makeFakeNuxtApp() {
  const hooks: Record<string, Array<(...args: unknown[]) => void>> = {};
  const router = {
    currentRoute: { value: { fullPath: '/dashboard', path: '/dashboard', name: 'dashboard' } },
  };
  return {
    vueApp: {
      use(_plugin: { install: (app: unknown, opts: unknown) => void }, opts: unknown) {
        _plugin.install(this, opts);
      },
    },
    $router: router,
    hook(name: string, fn: (...args: unknown[]) => void) {
      (hooks[name] ??= []).push(fn);
    },
    emit(name: string, ...args: unknown[]) {
      (hooks[name] ?? []).forEach((fn) => fn(...args));
    },
    hooks,
  };
}

describe('client plugin', () => {
  it("delegates init to @allstak/vue's AllStakPlugin with sdkName='allstak-nuxt' and attachErrorHandler:false", () => {
    const app = makeFakeNuxtApp();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (clientPlugin as any).setup(app);

    expect(calls.vuePluginUses).toHaveLength(1);
    const opts = calls.vuePluginUses[0];
    expect(opts.sdkName).toBe('allstak-nuxt');
    expect(typeof opts.sdkVersion).toBe('string');
    expect((opts.sdkVersion as string).length).toBeGreaterThan(0);
    expect(opts.attachErrorHandler).toBe(false);
    // apiKey/environment/release threaded from runtimeConfig.public.allstak.
    expect(opts.apiKey).toBe('ask_test');
    expect(opts.environment).toBe('test');
    expect(opts.release).toBe('1.2.3');
  });

  it('forwards vue:error to captureException with framework=nuxt context', () => {
    const app = makeFakeNuxtApp();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (clientPlugin as any).setup(app);

    app.emit('vue:error', new Error('render-explode'), { $options: { name: 'Widget' } }, 'render');

    expect(calls.captureException).toHaveLength(1);
    expect(calls.captureException[0]!.error.message).toBe('render-explode');
    expect(calls.captureException[0]!.context?.framework).toBe('nuxt');
    expect(calls.captureException[0]!.context?.source).toBe('vue:error');
    expect(calls.captureException[0]!.context?.componentName).toBe('Widget');
  });

  it('forwards app:error to captureException', () => {
    const app = makeFakeNuxtApp();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (clientPlugin as any).setup(app);

    app.emit('app:error', new Error('boot-fail'));

    expect(calls.captureException).toHaveLength(1);
    expect(calls.captureException[0]!.context?.source).toBe('app:error');
  });

  it('ignores expected 3xx/4xx errors (no Issue)', () => {
    const app = makeFakeNuxtApp();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (clientPlugin as any).setup(app);

    app.emit('app:error', { statusCode: 404, message: 'Not Found' });

    expect(calls.captureException).toHaveLength(0);
  });

  it('opens a navigation span on page:start and finishes it on page:finish', () => {
    const app = makeFakeNuxtApp();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (clientPlugin as any).setup(app);

    app.emit('page:start');
    expect(calls.spans).toHaveLength(1);
    expect(calls.spans[0]!.op).toBe('navigation');
    expect(calls.spans[0]!.options.description).toBe('/dashboard');
    expect(calls.addBreadcrumb).toHaveLength(1);
    expect(calls.addBreadcrumb[0].type).toBe('navigation');

    app.emit('page:finish');
    expect(calls.spans[0]!.finished).toEqual(['ok']);
  });
});

// ---------------------------------------------------------------------------
// Fake nitroApp with a hook registry.
// ---------------------------------------------------------------------------
function makeFakeNitroApp() {
  const registry: Record<string, Array<(...args: unknown[]) => void>> = {};
  return {
    hooks: {
      hook(name: string, fn: (...args: unknown[]) => void) {
        (registry[name] ??= []).push(fn);
      },
    },
    emit(name: string, ...args: unknown[]) {
      (registry[name] ?? []).forEach((fn) => fn(...args));
    },
  };
}

function makeFakeEvent(method = 'GET', path = '/api/widgets') {
  return {
    method,
    path,
    context: {} as Record<string, unknown>,
    node: { req: { method, url: path }, res: { statusCode: 200 } },
  };
}

describe('server (Nitro) plugin', () => {
  it("inits AllStak with sdkName='allstak-nuxt' from runtimeConfig.public.allstak", () => {
    const nitro = makeFakeNitroApp();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (serverPlugin as any)(nitro);

    expect(calls.init).toHaveLength(1);
    expect(calls.init[0].sdkName).toBe('allstak-nuxt');
    expect(calls.init[0].apiKey).toBe('ask_test');
    expect(calls.init[0].environment).toBe('test');
    expect(typeof calls.init[0].sdkVersion).toBe('string');
  });

  it('wraps a request in an http.server span and finishes it on beforeResponse', () => {
    const nitro = makeFakeNitroApp();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (serverPlugin as any)(nitro);

    const event = makeFakeEvent('POST', '/api/orders');
    nitro.emit('request', event);

    expect(calls.spans).toHaveLength(1);
    expect(calls.spans[0]!.op).toBe('http.server');
    expect(calls.spans[0]!.options.description).toBe('POST /api/orders');

    event.node.res.statusCode = 201;
    nitro.emit('beforeResponse', event, {});
    expect(calls.spans[0]!.finished).toEqual(['ok']);
    expect(calls.spans[0]!.tags['http.status_code']).toBe('201');
  });

  it('finishes the request span as errored for a 5xx response', () => {
    const nitro = makeFakeNitroApp();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (serverPlugin as any)(nitro);

    const event = makeFakeEvent('GET', '/api/boom');
    nitro.emit('request', event);
    event.node.res.statusCode = 500;
    nitro.emit('beforeResponse', event, {});

    expect(calls.spans[0]!.finished).toEqual(['error']);
  });

  it('captures unhandled server errors on the error hook with H3 context', () => {
    const nitro = makeFakeNitroApp();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (serverPlugin as any)(nitro);

    const event = makeFakeEvent('GET', '/api/explode');
    nitro.emit('request', event);
    nitro.emit('error', new Error('server-explode'), { event });

    expect(calls.captureException).toHaveLength(1);
    expect(calls.captureException[0]!.error.message).toBe('server-explode');
    expect(calls.captureException[0]!.context?.framework).toBe('nuxt');
    expect(calls.captureException[0]!.context?.source).toBe('nitro:error');
    expect(calls.captureException[0]!.context?.path).toBe('/api/explode');
    // The request span was finished as errored before reporting.
    expect(calls.spans[0]!.finished).toEqual(['error']);
  });

  it('ignores expected 3xx/4xx on the error hook', () => {
    const nitro = makeFakeNitroApp();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (serverPlugin as any)(nitro);

    nitro.emit('error', { statusCode: 401, message: 'Unauthorized' }, { event: makeFakeEvent() });

    expect(calls.captureException).toHaveLength(0);
  });

  it('injects trace meta tags into the SSR head for a normal (non-SWR) render', () => {
    const nitro = makeFakeNitroApp();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (serverPlugin as any)(nitro);

    const html = { head: [] as string[] };
    nitro.emit('render:html', html, { event: makeFakeEvent() });

    expect(html.head.some((tag) => tag.includes('allstak-trace'))).toBe(true);
    expect(html.head.some((tag) => tag.includes('trace-abc-span-xyz'))).toBe(true);
    expect(html.head.some((tag) => tag.includes('baggage'))).toBe(true);
  });

  it('skips meta-tag injection for SWR-cached responses', () => {
    const nitro = makeFakeNitroApp();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (serverPlugin as any)(nitro);

    const html = { head: [] as string[] };
    const event = makeFakeEvent();
    event.context = { routeRules: { swr: true } };
    nitro.emit('render:html', html, { event });

    expect(html.head).toHaveLength(0);
  });
});
