/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CLOUDFLARE_WORKER_URL?: string;
  // NOTE: there is deliberately no VITE_CLOUDFLARE_API_KEY. Auth is a
  // credential-gated HttpOnly session cookie (see services/cloudConfig.ts); a
  // VITE_* key would be inlined into the public bundle. The Worker's secret is
  // SESSION_SECRET, set via `wrangler secret put`, never shipped to the client.
  readonly VITE_PUBLIC_MENU_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
