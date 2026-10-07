import type { HemisphereApi } from '../shared/ipc'

declare global {
  interface Window {
    hemisphere: HemisphereApi
  }
}
