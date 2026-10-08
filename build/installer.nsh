; Setup.exe: Hemisphere's own install window (HemiSplash plugin, built by tools/installer-splash/build.sh)
; in place of NSIS's small progress box. Silent installs (launcher updates) show nothing, as before.

; electron-builder only includes these when there's no customCheckAppRunning
!include "getProcessInfo.nsh"
Var pid

; Runs right after the installer starts (before the files are extracted): splash first, then
; electron-builder's usual "is the launcher running?" check.
!macro customCheckAppRunning
  !ifndef BUILD_UNINSTALLER
    ${IfNot} ${Silent}
      File /oname=$PLUGINSDIR\hemisplash.bmp "${BUILD_RESOURCES_DIR}\installerSplash.bmp"
      HemiSplash::show "$PLUGINSDIR\hemisplash.bmp"
    ${EndIf}
  !endif
  !insertmacro IS_POWERSHELL_AVAILABLE
  !insertmacro _CHECK_APP_RUNNING
!macroend
