; Inno Setup script — build after: npm run package:binaries
; Requires Inno Setup 6+: https://jrsoftware.org/isinfo.php
; Compile:
;   iscc packaging/windows/installer.iss
;
; Output: dist/installers/POS-Print-Bridge-Setup.exe

#define MyAppName "POS Print Bridge"
#define MyAppVersion "1.2.0"
#define MyAppPublisher "POS Soft"
#define MyAppExeName "pos-print-bridge.exe"
#define StageDir "..\..\dist\stage-win"

[Setup]
AppId={{8F3C2A11-9B4E-4D6A-9C21-POSPRINTBRIDGE}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
; Per-user install (no admin) — silent background via Task Scheduler
DefaultDirName={localappdata}\POS Print Bridge
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputDir=..\..\dist\installers
OutputBaseFilename=POS-Print-Bridge-Setup
Compression=lzma
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayIcon={app}\{#MyAppExeName}
CloseApplications=force

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "{#StageDir}\pos-print-bridge.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#StageDir}\scripts\*"; DestDir: "{app}\scripts"; Flags: ignoreversion recursesubdirs
Source: "{#StageDir}\install-autostart.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#StageDir}\uninstall-autostart.ps1"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\Uninstall {#MyAppName}"; Filename: "{uninstallexe}"

[Run]
; Hidden PowerShell — installs Task Scheduler autostart and starts the bridge (no window)
Filename: "powershell.exe"; \
  Parameters: "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ""{app}\install-autostart.ps1"" -InstallDir ""{app}"""; \
  Flags: runhidden waituntilterminated; \
  StatusMsg: "Starting POS Print Bridge in the background..."

[UninstallRun]
Filename: "powershell.exe"; \
  Parameters: "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ""{app}\uninstall-autostart.ps1"" -InstallDir ""{app}"""; \
  Flags: runhidden waituntilterminated; RunOnceId: "StopBridge"

[UninstallDelete]
Type: filesandordirs; Name: "{app}"
