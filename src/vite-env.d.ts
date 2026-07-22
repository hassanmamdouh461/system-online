/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CLOUDFLARE_WORKER_URL?: string;
  readonly VITE_CLOUDFLARE_API_KEY?: string;
  readonly VITE_PUBLIC_MENU_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
