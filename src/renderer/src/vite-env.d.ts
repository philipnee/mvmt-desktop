/// <reference types="vite/client" />

import type { MvmtDesktopApi } from '../../shared/types';

declare global {
  interface Window {
    mvmtDesktop: MvmtDesktopApi;
  }
}
