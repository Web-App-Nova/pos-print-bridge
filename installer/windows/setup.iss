; Inno Setup script — POS Printer Agent
; Requires: Inno Setup 6+, release/bin/win-x64/ payload, nssm.exe in installer/windows/vendor/

#define MyAppName "POS Printer Agent"
#define MyAppVersion "1.1.0"
#define MyAppPublisher "WEBAPPNOVA LLP"
#define MyServiceName "POSPrintBridge"

[Setup]
AppId={{A7C3E9D2-4F81-4B2A-9C10-POSPRINTBRIDGE}}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppCopyright=Copyright (C) 2026 WEBAPPNOVA LLP
DefaultDirName={autopf}\POS Printer Agent
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
LicenseFile=..\..\LICENSE
SetupIconFile=..\..\assets\app-icon.ico
OutputDir=..\..\release\windows
OutputBaseFilename=POS-Printer-Agent-Setup
Compression=lzma
SolidCompression=yes
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64compatible
WizardStyle=modern
UninstallDisplayIcon={app}\assets\app-icon.ico

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "..\..\release\bin\win-x64\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "vendor\nssm.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "install-service.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "uninstall-service.ps1"; DestDir: "{app}"; Flags: ignoreversion

[Dirs]
Name: "{commonappdata}\POS Print Bridge"
Name: "{commonappdata}\POS Print Bridge\logs"

[Run]
Filename: "powershell.exe"; \
  Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\install-service.ps1"" -InstallDir ""{app}"""; \
  StatusMsg: "Registering Printer Agent Windows Service…"; \
  Flags: runhidden waituntilterminated

[UninstallRun]
Filename: "powershell.exe"; \
  Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\uninstall-service.ps1"" -InstallDir ""{app}"""; \
  RunOnceId: "RemovePOSPrintBridgeService"; \
  Flags: runhidden waituntilterminated

[Code]
function InitializeSetup(): Boolean;
begin
  Result := True;
  if not FileExists(ExpandConstant('{#SourcePath}\..\..\release\bin\win-x64\node.exe')) then
  begin
    MsgBox('Missing release/bin/win-x64/node.exe. Run npm run package:windows first.', mbError, MB_OK);
    Result := False;
  end;
  if not FileExists(ExpandConstant('{#SourcePath}\vendor\nssm.exe')) then
  begin
    MsgBox('Missing installer/windows/vendor/nssm.exe. Download NSSM and place nssm.exe there.', mbError, MB_OK);
    Result := False;
  end;
end;
