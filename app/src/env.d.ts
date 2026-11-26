/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 'on' only in a local build, where it compiles in /dev-seed. */
  readonly VITE_LOCAL_SEED?: string;
}
