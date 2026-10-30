/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Gốc REST API, mặc định `/api` (cùng origin, qua proxy Vite/Nginx). */
  readonly VITE_API_BASE_URL?: string;
  /** Kênh liên hệ ở trang Hỗ trợ; bỏ trống thì ẩn thẻ tương ứng. */
  readonly VITE_SUPPORT_HOTLINE?: string;
  readonly VITE_SUPPORT_HOTLINE_HOURS?: string;
  readonly VITE_SUPPORT_EMAIL?: string;
  readonly VITE_SUPPORT_CHAT_URL?: string;
  readonly VITE_SUPPORT_CHAT_NAME?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
