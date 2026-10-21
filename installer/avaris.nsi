; Avaris2 CS - Windows installer (NSIS 3)
Unicode true
SetCompressor /SOLID lzma
SetCompressorDictSize 64
ManifestDPIAware true

!define APPNAME "Avaris2 CS"
!define COMPANY "OSEMTEC"
!define VERSION "${VER}"
!define EXENAME "Avaris2CS.exe"
!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\Avaris2 CS"
!define OLDKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\Avaris2"

Name "${APPNAME} ${VERSION}"
OutFile "${OUTFILE}"
InstallDir "$PROGRAMFILES64\${APPNAME}"
InstallDirRegKey HKLM "Software\${COMPANY}\${APPNAME}" "InstallDir"
RequestExecutionLevel admin
BrandingText "${COMPANY} - ${APPNAME} ${VERSION}"

VIProductVersion "${VER}.0"
VIAddVersionKey "ProductName" "${APPNAME}"
VIAddVersionKey "CompanyName" "${COMPANY}"
VIAddVersionKey "FileDescription" "${APPNAME} Setup"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "(c) 2026 ${COMPANY}"

!include "MUI2.nsh"
!include "x64.nsh"
!include "LogicLib.nsh"

!define MUI_ICON "${ICON}"
!define MUI_UNICON "${ICON}"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Welcome to ${APPNAME} ${VERSION} Setup"
!define MUI_WELCOMEPAGE_TEXT "This will install ${APPNAME} on your computer.$\r$\n$\r$\nUrban drainage and sewer network modeling with 1D-2D surface flood simulation (formerly Avaris2 / OsemCM V2.0: an earlier Avaris2 installation is removed first, settings are kept; installs next to OsemCM V1.0). Opens Avaris DS and EPA SWMM 5 models.$\r$\n$\r$\nRequirements: Windows 10 or 11, 64-bit.$\r$\n$\r$\nClick Next to continue."
!define MUI_FINISHPAGE_RUN "$INSTDIR\${EXENAME}"
!define MUI_FINISHPAGE_RUN_TEXT "Launch ${APPNAME}"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "LICENSE.txt"
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "${APPNAME} requires 64-bit Windows 10 or 11."
    Abort
  ${EndIf}
  SetRegView 64
  ; an earlier "Avaris2" installation (renamed to Avaris2 CS in 2.1.0) is uninstalled silently; user settings are kept
  ReadRegStr $0 HKLM "${OLDKEY}" "UninstallString"
  ReadRegStr $1 HKLM "${OLDKEY}" "InstallLocation"
  ${If} $0 != ""
  ${AndIf} $1 != ""
    nsExec::Exec 'taskkill /F /IM Avaris2.exe'
    ExecWait '"$1\Uninstall.exe" /S _?=$1'
    Delete "$1\Uninstall.exe"
    RMDir /r "$1"
    DeleteRegKey HKLM "${OLDKEY}"
    DeleteRegKey HKLM "Software\${COMPANY}\Avaris2"
    SetShellVarContext all
    Delete "$DESKTOP\Avaris2.lnk"
    RMDir /r "$SMPROGRAMS\Avaris2"
  ${EndIf}
FunctionEnd

Section "${APPNAME} (required)" SecMain
  SectionIn RO
  ; close a running instance so files can be replaced
  nsExec::Exec 'taskkill /F /IM ${EXENAME}'
  nsExec::Exec 'taskkill /F /IM avaris_engine.exe'
  SetOutPath "$INSTDIR"
  File /r "${STAGE}\*.*"
  File "/oname=$INSTDIR\resources\app\icon.ico" "${ICON}"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKLM "Software\${COMPANY}\${APPNAME}" "InstallDir" "$INSTDIR"
  WriteRegStr HKLM "${UNINSTKEY}" "DisplayName" "${APPNAME}"
  WriteRegStr HKLM "${UNINSTKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKLM "${UNINSTKEY}" "Publisher" "${COMPANY}"
  WriteRegStr HKLM "${UNINSTKEY}" "DisplayIcon" "$INSTDIR\resources\app\icon.ico"
  WriteRegStr HKLM "${UNINSTKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "${UNINSTKEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKLM "${UNINSTKEY}" "NoModify" 1
  WriteRegDWORD HKLM "${UNINSTKEY}" "NoRepair" 1
  ; Start menu
  SetShellVarContext all
  CreateDirectory "$SMPROGRAMS\${APPNAME}"
  CreateShortCut "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk" "$INSTDIR\${EXENAME}" "" "$INSTDIR\resources\app\icon.ico" 0
  CreateShortCut "$SMPROGRAMS\${APPNAME}\Uninstall ${APPNAME}.lnk" "$INSTDIR\Uninstall.exe"
SectionEnd

Section "Desktop shortcut" SecDesktop
  SetShellVarContext all
  CreateShortCut "$DESKTOP\${APPNAME}.lnk" "$INSTDIR\${EXENAME}" "" "$INSTDIR\resources\app\icon.ico" 0
SectionEnd

Section /o "Open .inp files with Avaris2 CS (file association)" SecAssoc
  WriteRegStr HKCR ".inp\OpenWithProgids" "Avaris2.Model" ""
  WriteRegStr HKCR "Avaris2.Model" "" "Avaris2 CS / SWMM Model"
  WriteRegStr HKCR "Avaris2.Model\DefaultIcon" "" "$INSTDIR\resources\app\icon.ico"
  WriteRegStr HKCR "Avaris2.Model\shell\open\command" "" '"$INSTDIR\${EXENAME}" "%1"'
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
SectionEnd

!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SecMain} "Program files, Avaris engine and sample model."
  !insertmacro MUI_DESCRIPTION_TEXT ${SecDesktop} "Place a shortcut on the desktop."
  !insertmacro MUI_DESCRIPTION_TEXT ${SecAssoc} "Add Avaris2 CS to the 'Open with' list for .inp model files (does not replace EPA SWMM as the default)."
!insertmacro MUI_FUNCTION_DESCRIPTION_END

Section "Uninstall"
  SetRegView 64
  nsExec::Exec 'taskkill /F /IM ${EXENAME}'
  SetShellVarContext all
  Delete "$DESKTOP\${APPNAME}.lnk"
  RMDir /r "$SMPROGRAMS\${APPNAME}"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKLM "${UNINSTKEY}"
  DeleteRegKey HKLM "Software\${COMPANY}\${APPNAME}"
  DeleteRegValue HKCR ".inp\OpenWithProgids" "Avaris2.Model"
  DeleteRegKey HKCR "Avaris2.Model"
SectionEnd
