; Screen Ping installer hooks (Tauri NSIS).
;
; This installer replaces the Electron app. Electron 1.0.73's updater
; downloads it like any other update, checks its hash and signature, and runs
; it with `--updated /S --force-run`. Our own updater runs it with
; `/S /UPDATE /R`. A double-clicked install goes through the same steps.

; electron-builder's id for appId com.screenping.app (UUID v5).
!define ELECTRON_GUID "6f36a674-e950-5e4d-802d-17937251d4d2"
!define ELECTRON_UNINSTALLER "Uninstall Screen Ping.exe"

!macro SP_UNINSTALL_AT dir uninstaller exe
  ${If} ${FileExists} "${dir}\${uninstaller}"
    DetailPrint "Removing the previous Screen Ping (${dir})"
    ; _?= keeps the uninstaller in place so ExecWait really waits.
    ExecWait '"${dir}\${uninstaller}" /currentuser /S _?=${dir}'
    ; Belt and braces: wait for its files to go (up to 15 s).
    StrCpy $R6 0
    ${DoWhile} ${FileExists} "${dir}\${exe}"
      ${If} $R6 >= 60
        ${Break}
      ${EndIf}
      Sleep 250
      IntOp $R6 $R6 + 1
    ${Loop}
    Delete "${dir}\${uninstaller}"
    RMDir "${dir}"
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREINSTALL
  ; Runs before our files and shortcuts are written: Electron's uninstaller
  ; deletes "Screen Ping.lnk", which is also the name of ours. It keeps
  ; %APPDATA%\screen-ping-desktop, where the app picks up the login.
  ReadRegStr $R5 HKCU "Software\${ELECTRON_GUID}" "InstallLocation"
  ${IfNot} ${FileExists} "$R5\${ELECTRON_UNINSTALLER}"
    StrCpy $R5 "$LOCALAPPDATA\Programs\screen-ping-desktop"
  ${EndIf}
  !insertmacro SP_UNINSTALL_AT "$R5" "${ELECTRON_UNINSTALLER}" "Screen Ping.exe"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.screenping.app"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "com.screenping.app"

  ; The "Screen Ping Tauri" test builds.
  !insertmacro SP_UNINSTALL_AT "$LOCALAPPDATA\Screen Ping Tauri" "uninstall.exe" "Screen Ping Tauri.exe"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Screen Ping Tauri"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Electron's updater asks for the app to come back up this way (ours uses /R).
  ClearErrors
  ${GetOptions} $CMDLINE "--force-run" $R0
  ${IfNot} ${Errors}
    Exec '"$INSTDIR\${MAINBINARYNAME}.exe"'
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    ; The app registers screenping:// itself on each launch.
    ReadRegStr $R0 HKCU "Software\Classes\screenping\shell\open\command" ""
    StrCpy $R1 "$\"$INSTDIR\"
    StrLen $R2 $R1
    StrCpy $R3 $R0 $R2
    ${If} $R3 == $R1
      DeleteRegKey HKCU "Software\Classes\screenping"
    ${EndIf}
  ${EndIf}
!macroend
