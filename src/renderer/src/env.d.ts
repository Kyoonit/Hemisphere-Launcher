/// <reference types="vite/client" />
/// <reference path="../../preload/index.d.ts" />

/** Electron's <webview> (the Map screen's BlueMap only; main/security.ts decides what it may load) */
interface MapWebview extends HTMLElement {
  executeJavaScript(code: string): Promise<unknown>
  reload(): void
  getURL(): string
}
declare namespace React.JSX {
  interface IntrinsicElements {
    webview: React.DetailedHTMLProps<React.HTMLAttributes<MapWebview>, MapWebview> & { src: string; partition: string }
  }
}
