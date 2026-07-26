/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CLOUDFLARE_WORKER_URL?: string;
  readonly VITE_PUBLIC_MENU_URL?: string;
  // VITE_CLOUDFLARE_API_KEY intentionally removed: cloud auth is now an
  // HttpOnly session cookie minted by the Worker, and a VITE_* secret would be
  // inlined into the public bundle anyway.
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
