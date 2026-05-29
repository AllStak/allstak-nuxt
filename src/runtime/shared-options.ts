/**
 * Runtime-side view of the public runtime config the module writes into
 * `runtimeConfig.public.allstak`. Kept in the runtime tree (not `src/types.ts`)
 * so the bundled runtime plugins stay self-contained and don't drag the
 * module's build-time types into the client/server bundles.
 *
 * Only public fields live here — they ship to the browser. The `apiKey` is a
 * publishable ingest key (the same key the other browser SDKs use), not a
 * server secret.
 */
export interface AllStakPublicRuntimeConfig {
  apiKey?: string;
  host?: string;
  environment?: string;
  release?: string;
  dist?: string;
}
