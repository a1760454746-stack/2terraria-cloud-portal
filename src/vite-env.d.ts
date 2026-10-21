/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SERVER_IP?: string;
  readonly VITE_SERVER_PORT?: string;
  readonly VITE_API_PROTOCOL?: string;
  readonly VITE_WS_PROTOCOL?: string;
  readonly VITE_DIRECT_CONNECT_TIMEOUT_MS?: string;
  readonly VITE_TURN_SERVER_IP?: string;
  readonly VITE_TURN_SERVER_PORT?: string;
  readonly VITE_TURN_USERNAME?: string;
  readonly VITE_TURN_CREDENTIAL?: string;
  readonly VITE_FORCE_RELAY_ONLY?: string;
  readonly VITE_TURN_TRANSPORT?: string;
  readonly VITE_STREAM_BACKEND?: string;
  readonly VITE_SRS_WHEP_URL?: string;
  readonly VITE_SRS_WHEP_URL_1080?: string;
  readonly VITE_SRS_WHEP_URL_720?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
