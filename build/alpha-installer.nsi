!ifndef APP_SOURCE
  !error "APP_SOURCE define is required"
!endif

!ifndef APP_EXECUTABLE
  !error "APP_EXECUTABLE define is required"
!endif

!ifndef OUTPUT_FILE
  !error "OUTPUT_FILE define is required"
!endif

!ifndef PRODUCT_NAME
  !error "PRODUCT_NAME define is required"
!endif

!ifndef PRODUCT_VERSION
  !error "PRODUCT_VERSION define is required"
!endif

!ifndef INSTALL_DIR_NAME
  !error "INSTALL_DIR_NAME define is required"
!endif

!ifndef UNINSTALL_REGISTRY_KEY
  !error "UNINSTALL_REGISTRY_KEY define is required"
!endif

!ifndef APP_ICON
  !error "APP_ICON define is required"
!endif

Unicode true
RequestExecutionLevel user

Name "${PRODUCT_NAME}"
OutFile "${OUTPUT_FILE}"
Icon "${APP_ICON}"
UninstallIcon "${APP_ICON}"
InstallDir "$LOCALAPPDATA\Programs\${INSTALL_DIR_NAME}"
InstallDirRegKey HKCU "${UNINSTALL_REGISTRY_KEY}" "InstallLocation"
ShowInstDetails show
ShowUninstDetails show

Page directory
Page instfiles
UninstPage uninstConfirm
UninstPage instfiles

Section "Install"
  IfFileExists "$INSTDIR\${APP_EXECUTABLE}" 0 +2
    RMDir /r "$INSTDIR"

  SetOutPath "$INSTDIR"
  File /r "${APP_SOURCE}\*.*"
  File "/oname=icon.ico" "${APP_ICON}"

  WriteUninstaller "$INSTDIR\Uninstall ${PRODUCT_NAME}.exe"

  CreateDirectory "$SMPROGRAMS\${PRODUCT_NAME}"
  CreateShortCut "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk" "$INSTDIR\${APP_EXECUTABLE}" "" "$INSTDIR\icon.ico" 0
  CreateShortCut "$SMPROGRAMS\${PRODUCT_NAME}\Uninstall ${PRODUCT_NAME}.lnk" "$INSTDIR\Uninstall ${PRODUCT_NAME}.exe" "" "$INSTDIR\icon.ico" 0

  WriteRegStr HKCU "${UNINSTALL_REGISTRY_KEY}" "DisplayName" "${PRODUCT_NAME}"
  WriteRegStr HKCU "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion" "${PRODUCT_VERSION}"
  WriteRegStr HKCU "${UNINSTALL_REGISTRY_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_REGISTRY_KEY}" "DisplayIcon" "$INSTDIR\${APP_EXECUTABLE},0"
  WriteRegStr HKCU "${UNINSTALL_REGISTRY_KEY}" "Publisher" "${PRODUCT_NAME}"
  WriteRegStr HKCU "${UNINSTALL_REGISTRY_KEY}" "UninstallString" '"$INSTDIR\Uninstall ${PRODUCT_NAME}.exe"'
  WriteRegStr HKCU "${UNINSTALL_REGISTRY_KEY}" "QuietUninstallString" '"$INSTDIR\Uninstall ${PRODUCT_NAME}.exe" /S'
  WriteRegDWORD HKCU "${UNINSTALL_REGISTRY_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_REGISTRY_KEY}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  Delete "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk"
  Delete "$SMPROGRAMS\${PRODUCT_NAME}\Uninstall ${PRODUCT_NAME}.lnk"
  RMDir "$SMPROGRAMS\${PRODUCT_NAME}"

  RMDir /r "$INSTDIR"

  DeleteRegKey HKCU "${UNINSTALL_REGISTRY_KEY}"
SectionEnd
