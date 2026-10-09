; Herald-Setup.exe: Herald's own install window (the launcher's HemiSplash plugin built with Herald's texts and
; colours: tools/installer-splash/herald.mjs) in place of NSIS's small progress box. Silent installs (Herald
; updates) show nothing.

; electron-builder only includes these when there's no customCheckAppRunning
!include "getProcessInfo.nsh"
Var pid

; The very first thing the installer does (.onInit): the splash, before NSIS opens its small progress box (which the
; splash covers and hides). Earlier than the launcher's, which starts with the "is it running?" check.
!macro customInit
  ${IfNot} ${Silent}
    InitPluginsDir
    File /oname=$PLUGINSDIR\heraldsplash.bmp "${BUILD_RESOURCES_DIR}\installerSplash.bmp"
    HeraldSplash::show "$PLUGINSDIR\heraldsplash.bmp"
  ${EndIf}
!macroend

; electron-builder's usual "is Herald running?" check (defining it is what includes getProcessInfo.nsh above)
!macro customCheckAppRunning
  !insertmacro IS_POWERSHELL_AVAILABLE
  !insertmacro _CHECK_APP_RUNNING
!macroend
