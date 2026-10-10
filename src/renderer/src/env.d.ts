/// <reference types="vite/client" />
/// <reference path="../../preload/index.d.ts" />

/** Electron's <webview> (the web pages of shared/webPages.ts only; main/security.ts decides what it may load) */
interface PageWebview extends HTMLElement {
  executeJavaScript(code: string): Promise<unknown>
  insertCSS(css: string): Promise<string>
  reload(): void
  getURL(): string
}
declare namespace React.JSX {
  interface IntrinsicElements {
    webview: React.DetailedHTMLProps<React.HTMLAttributes<PageWebview>, PageWebview> & { src: string; partition: string }
  }
}
