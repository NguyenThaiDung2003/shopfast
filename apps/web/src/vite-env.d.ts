/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Gốc REST API, mặc định `/api` (cùng origin, qua proxy Vite/Nginx). */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
