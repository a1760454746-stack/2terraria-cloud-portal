param(
  [string]$PortalHost = "root@146.56.217.146",
  [string]$RemoteDir = "/root/2terraria-cloud-portal",
  [int]$PortalSshPort = 22,
  [switch]$SkipRestart
)

$ErrorActionPreference = "Stop"

function Require-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Missing command: $Name"
  }
}

Require-Command "scp"
Require-Command "ssh"

$ProjectRoot = $PSScriptRoot
$FilesToUpload = @(
  "server.ts",
  "src/App.tsx",
  "src/main.tsx",
  "src/StreamingView.tsx",
  "src/index.css"
)

Write-Host "Project root: $ProjectRoot"
Write-Host "Target host: $PortalHost"
Write-Host "Target dir:  $RemoteDir"
Write-Host "SSH port:    $PortalSshPort"

foreach ($relPath in $FilesToUpload) {
  $localPath = Join-Path $ProjectRoot $relPath
  if (-not (Test-Path -LiteralPath $localPath)) {
    throw "File not found: $localPath"
  }

  $remotePath = "$PortalHost`:$RemoteDir/$($relPath -replace '\\','/')"
  Write-Host "Uploading $relPath ..."
  & scp -P $PortalSshPort -o StrictHostKeyChecking=accept-new $localPath $remotePath
  if ($LASTEXITCODE -ne 0) {
    throw "Upload failed: $relPath"
  }
}

if (-not $SkipRestart) {
  Write-Host "Restarting portal service on server ..."
  $escapedRemoteDir = $RemoteDir.Replace('"', '\"')
  $remoteScript = @"
set -e
cd "$escapedRemoteDir"
npm install --silent
pkill -f "tsx server.ts" || true
nohup npm run dev > portal.log 2>&1 &
sleep 2
ss -lntp | grep 3000 || true
echo "Portal restarted"
"@

  $remoteScript | & ssh -p $PortalSshPort -o StrictHostKeyChecking=accept-new $PortalHost "bash -s"
  if ($LASTEXITCODE -ne 0) {
    throw "Remote restart failed."
  }
}

Write-Host "Done."
