; Steam 折扣雷达 的 Windows 安装程序（NSIS 3，Unicode，按用户安装，不需要管理员权限）。
;
; 这个脚本用于在 Linux 上交叉生成 setup.exe（electron-builder 自带的 NSIS 流程需要 wine
; 来生成卸载器，这里改成直接编译，不依赖 wine）。在 Windows 上也可以用 makensis 编译：
;   makensis -DAPP_DIR=..\..\release\win-unpacked -DOUT_FILE=SteamDealRadar-Setup.exe installer.nsi

Unicode true
!include "MUI2.nsh"
!include "FileFunc.nsh"

!ifndef APP_DIR
  !define APP_DIR "..\..\release\win-unpacked"
!endif
!ifndef OUT_FILE
  !define OUT_FILE "..\..\release\SteamDealRadar-Setup.exe"
!endif
!ifndef APP_VERSION
  !define APP_VERSION "1.2.0"
!endif
!ifndef APP_ICON
  !define APP_ICON "${__FILEDIR__}/icon.ico"
!endif
!ifndef LICENSE_FILE
  !define LICENSE_FILE "${__FILEDIR__}/../../../LICENSE"
!endif

!define APP_NAME "Steam 折扣雷达"
!define APP_EXE "Steam 折扣雷达.exe"
!define APP_PUBLISHER "Steam Deal Radar"
!define APP_ID "com.steamdealradar.app"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}"

Name "${APP_NAME}"
OutFile "${OUT_FILE}"
InstallDir "$LOCALAPPDATA\Programs\SteamDealRadar"
InstallDirRegKey HKCU "Software\${APP_ID}" "Install_Dir"
RequestExecutionLevel user
SetCompressor /SOLID zlib
SetCompressorDictSize 32
BrandingText "${APP_NAME} ${APP_VERSION}"

VIProductVersion "${APP_VERSION}.0"
VIAddVersionKey "ProductName" "${APP_NAME}"
VIAddVersionKey "FileDescription" "${APP_NAME} 安装程序"
VIAddVersionKey "FileVersion" "${APP_VERSION}"
VIAddVersionKey "ProductVersion" "${APP_VERSION}"
VIAddVersionKey "CompanyName" "${APP_PUBLISHER}"
VIAddVersionKey "LegalCopyright" "MIT License"

!define MUI_ICON "${APP_ICON}"
!define MUI_UNICON "${APP_ICON}"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\${APP_EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "立即启动 Steam 折扣雷达"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "${LICENSE_FILE}"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro MUI_LANGUAGE "English"

Section "Install"
  SetOutPath "$INSTDIR"
  ; 覆盖安装前先结束正在运行的旧版本
  nsExec::Exec 'taskkill /F /IM "${APP_EXE}"'
  Pop $0

  File /r "${APP_DIR}/*"

  WriteUninstaller "$INSTDIR\Uninstall.exe"

  CreateDirectory "$SMPROGRAMS\${APP_NAME}"
  CreateShortcut "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}"
  CreateShortcut "$SMPROGRAMS\${APP_NAME}\卸载 Steam 折扣雷达.lnk" "$INSTDIR\Uninstall.exe"
  CreateShortcut "$DESKTOP\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}"

  WriteRegStr HKCU "Software\${APP_ID}" "Install_Dir" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayName" "${APP_NAME}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\${APP_EXE}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKCU "${UNINST_KEY}" "Publisher" "${APP_PUBLISHER}"
  WriteRegStr HKCU "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "${UNINST_KEY}" "QuietUninstallString" '"$INSTDIR\Uninstall.exe" /S'
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1

  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKCU "${UNINST_KEY}" "EstimatedSize" "$0"
SectionEnd

Section "Uninstall"
  nsExec::Exec 'taskkill /F /IM "${APP_EXE}"'
  Pop $0

  Delete "$DESKTOP\${APP_NAME}.lnk"
  RMDir /r "$SMPROGRAMS\${APP_NAME}"
  DeleteRegKey HKCU "${UNINST_KEY}"
  DeleteRegKey HKCU "Software\${APP_ID}"
  RMDir /r "$INSTDIR"

  ; 静默卸载默认保留数据；交互式卸载询问是否删除
  IfSilent keep_data
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 \
    "是否同时删除本地数据？$\r$\n$\r$\n选择「是」将删除设置、关注列表、价格历史、图片缓存和更新缓存；$\r$\n选择「否」则保留，重新安装后可继续使用。" \
    IDNO keep_data
  RMDir /r "$APPDATA\${APP_NAME}"
  RMDir /r "$LOCALAPPDATA\${APP_NAME}"
  RMDir /r "$LOCALAPPDATA\@radardesktop-updater"

  keep_data:
SectionEnd
