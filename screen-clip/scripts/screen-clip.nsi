!include "MUI2.nsh"
!include "FileFunc.nsh"

Name "Screen Clip"
OutFile "/workspace/screen-clip/release/ScreenClip-Setup-1.0.3.exe"
Unicode True
InstallDir "$LOCALAPPDATA\Programs\Screen Clip"
InstallDirRegKey HKCU "Software\Screen Clip" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma

!define MUI_ABORTWARNING

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

Section "Install"
  SetOutPath "$INSTDIR"
  File /r "/workspace/screen-clip/release/win-unpacked\*.*"

  CreateDirectory "$SMPROGRAMS\Screen Clip"
  CreateShortCut "$SMPROGRAMS\Screen Clip\Screen Clip.lnk" "$INSTDIR\Screen Clip.exe"
  CreateShortCut "$DESKTOP\Screen Clip.lnk" "$INSTDIR\Screen Clip.exe"

  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "Software\Screen Clip" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ScreenClip" "DisplayName" "Screen Clip"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ScreenClip" "UninstallString" "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ScreenClip" "DisplayIcon" "$INSTDIR\Screen Clip.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ScreenClip" "Publisher" "Screen Clip"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ScreenClip" "DisplayVersion" "1.0.3"
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ScreenClip" "EstimatedSize" "$0"
SectionEnd

Section "Uninstall"
  Delete "$DESKTOP\Screen Clip.lnk"
  Delete "$SMPROGRAMS\Screen Clip\Screen Clip.lnk"
  RMDir "$SMPROGRAMS\Screen Clip"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "Software\Screen Clip"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ScreenClip"
SectionEnd
