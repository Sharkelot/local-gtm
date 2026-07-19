#Requires -RunAsAdministrator
[CmdletBinding(SupportsShouldProcess)]
param(
  [Parameter(Mandatory)] [Security.SecureString] $InferenceWorkerToken,
  [Parameter(Mandatory)] [Security.SecureString] $RedisPassword,
  [string] $InternalApiUrl = 'https://crm.example.com',
  [string] $InternalApiConnectHost = '192.0.2.70',
  [string] $RedisHost = '192.0.2.70',
  [int] $RedisPort = 6379,
  [string] $LmStudioBaseUrl = 'http://127.0.0.1:1234',
  [int] $HeartbeatIntervalMs = 30000,
  [string] $InstallRoot = "$env:ProgramData\LocalGtm\InferenceWorker",
  [string] $SourceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path,
  [switch] $SkipStart
)

$ErrorActionPreference = 'Stop'
$serviceId = 'LocalGtmInferenceWorker'
$winswVersion = '2.12.0'
$winswUrl = "https://github.com/winsw/winsw/releases/download/v$winswVersion/WinSW-x64.exe"
$winswSha256 = '05B82D46AD331CC16BDC00DE5C6332C1EF818DF8CEEFCD49C726553209B3A0DA'

if ([Uri]$InternalApiUrl -as [Uri] -eq $null -or ([Uri]$InternalApiUrl).Scheme -ne 'https') {
  throw 'InternalApiUrl must be a valid HTTPS URL.'
}
if (-not [Net.IPAddress]::TryParse($InternalApiConnectHost, [ref]([Net.IPAddress]$null))) {
  throw 'InternalApiConnectHost must be a literal private IP address.'
}
if ([Uri]$LmStudioBaseUrl -as [Uri] -eq $null -or ([Uri]$LmStudioBaseUrl).Host -notin @('127.0.0.1', 'localhost', '::1')) {
  throw 'LmStudioBaseUrl must use Windows loopback.'
}

$node = (Get-Command node -ErrorAction Stop).Source
$nodeVersion = (& $node --version).TrimStart('v').Split('.')[0]
if ($nodeVersion -ne '24') { throw "Node 24 is required; found $(& $node --version)." }
$pnpm = (Get-Command pnpm -ErrorAction Stop).Source

function ConvertTo-PlainText([Security.SecureString] $value) {
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($value)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

function Protect-MachineSecret([Security.SecureString] $value) {
  $plain = ConvertTo-PlainText $value
  $bytes = [Text.Encoding]::UTF8.GetBytes($plain)
  try {
    $cipher = [Security.Cryptography.ProtectedData]::Protect(
      $bytes,
      $null,
      [Security.Cryptography.DataProtectionScope]::LocalMachine
    )
    return [Convert]::ToBase64String($cipher)
  } finally {
    [Array]::Clear($bytes, 0, $bytes.Length)
    $plain = $null
  }
}

if (-not $PSCmdlet.ShouldProcess($InstallRoot, 'Install the Local GTM inference worker service')) { return }

& $pnpm --dir $SourceRoot --filter '@local-gtm/inference-worker' build
if ($LASTEXITCODE -ne 0) { throw 'Inference worker build failed.' }

New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
$serviceExe = Join-Path $InstallRoot "$serviceId.exe"
if (Test-Path -LiteralPath $serviceExe) {
  & $serviceExe stop | Out-Null
  & $serviceExe uninstall | Out-Null
}

$appRoot = Join-Path $InstallRoot 'app'
$archive = $null
if (Test-Path -LiteralPath $appRoot) {
  $archive = Join-Path $InstallRoot ('app.previous.' + [DateTimeOffset]::UtcNow.ToUnixTimeSeconds())
  Move-Item -LiteralPath $appRoot -Destination $archive
}
$previousImportMethod = [Environment]::GetEnvironmentVariable('npm_config_package_import_method', 'Process')
try {
  # Deploy directly to the final path because pnpm's Windows junctions contain
  # absolute targets. Copy import mode prevents the content-addressable store
  # and workspace packages from being hardlinked into the hardened service tree.
  $env:npm_config_package_import_method = 'copy'
  & $pnpm --dir $SourceRoot --filter '@local-gtm/inference-worker' --prod deploy --legacy $appRoot
  if ($LASTEXITCODE -ne 0) { throw 'Inference worker deployment bundle failed.' }
  $resolvedAppRoot = [IO.Path]::GetFullPath($appRoot).TrimEnd('\')
  $appPrefix = $resolvedAppRoot + '\'
  Get-ChildItem -LiteralPath $resolvedAppRoot -File -Recurse -Force |
    Where-Object { -not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) } |
    ForEach-Object {
      $sourceFile = [IO.Path]::GetFullPath($_.FullName)
      if (-not $sourceFile.StartsWith($appPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to detach a bundle file outside app root: $sourceFile"
      }
      $detachedFile = $sourceFile + '.detached.' + [Guid]::NewGuid()
      try {
        [IO.File]::Copy($sourceFile, $detachedFile, $false)
        [IO.File]::Move($detachedFile, $sourceFile, $true)
      } finally {
        if (Test-Path -LiteralPath $detachedFile) {
          Remove-Item -LiteralPath $detachedFile -Force
        }
      }
    }
  Push-Location $appRoot
  try {
    & $node -e "require('bullmq')"
    if ($LASTEXITCODE -ne 0) { throw 'Inference worker BullMQ bundle smoke check failed.' }
  } finally {
    Pop-Location
  }
} catch {
  $resolvedAppRoot = [IO.Path]::GetFullPath($appRoot)
  $expectedAppRoot = [IO.Path]::GetFullPath((Join-Path $InstallRoot 'app'))
  if ($resolvedAppRoot -eq $expectedAppRoot -and (Test-Path -LiteralPath $resolvedAppRoot)) {
    Remove-Item -LiteralPath $resolvedAppRoot -Recurse -Force
  }
  if ($archive -and (Test-Path -LiteralPath $archive)) {
    Move-Item -LiteralPath $archive -Destination $appRoot
  }
  throw
} finally {
  if ($null -eq $previousImportMethod) {
    Remove-Item Env:npm_config_package_import_method -ErrorAction SilentlyContinue
  } else {
    $env:npm_config_package_import_method = $previousImportMethod
  }
}

# Rollback bundles contain application code only and are needed only while the
# replacement is being assembled. Legacy bundles may contain pnpm hardlinks;
# keeping them under the recursively hardened install root would mutate source
# and package-store ACLs again.
$resolvedInstallRoot = [IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')
Get-ChildItem -LiteralPath $resolvedInstallRoot -Directory -Filter 'app.previous.*' |
  Where-Object {
    [IO.Path]::GetFullPath($_.Parent.FullName).TrimEnd('\') -eq $resolvedInstallRoot -and
    $_.Name.StartsWith('app.previous.', [StringComparison]::Ordinal)
  } |
  Remove-Item -Recurse -Force

$download = Join-Path $env:TEMP "WinSW-x64-$winswVersion.exe"
if (-not (Test-Path -LiteralPath $download) -or (Get-FileHash -Algorithm SHA256 -LiteralPath $download).Hash -ne $winswSha256) {
  Invoke-WebRequest -Uri $winswUrl -OutFile $download
}
if ((Get-FileHash -Algorithm SHA256 -LiteralPath $download).Hash -ne $winswSha256) {
  throw 'WinSW hash verification failed.'
}
Copy-Item -LiteralPath $download -Destination $serviceExe -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Start-LocalGtmInferenceWorker.ps1') -Destination $InstallRoot -Force

@{
  nodePath = $node
  appEntry = (Join-Path $appRoot 'dist\index.js')
  internalApiUrl = $InternalApiUrl.TrimEnd('/')
  internalApiConnectHost = $InternalApiConnectHost
  internalApiCaPath = $null
  redisHost = $RedisHost
  redisPort = $RedisPort
  lmStudioBaseUrl = $LmStudioBaseUrl.TrimEnd('/')
  heartbeatIntervalMs = $HeartbeatIntervalMs
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $InstallRoot 'worker.config.json') -Encoding utf8

@{
  inferenceWorkerToken = Protect-MachineSecret $InferenceWorkerToken
  redisPassword = Protect-MachineSecret $RedisPassword
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $InstallRoot 'worker.secrets.json') -Encoding utf8

$pwsh = (Get-Command pwsh -ErrorAction Stop).Source
$escapedPwsh = [Security.SecurityElement]::Escape($pwsh)
$launcher = [Security.SecurityElement]::Escape((Join-Path $InstallRoot 'Start-LocalGtmInferenceWorker.ps1'))
$working = [Security.SecurityElement]::Escape($appRoot)
@"
<service>
  <id>$serviceId</id>
  <name>Local GTM Inference Worker</name>
  <description>Consumes identifier-only BullMQ jobs and calls Windows-local LM Studio.</description>
  <executable>$escapedPwsh</executable>
  <arguments>-NoProfile -NonInteractive -File &quot;$launcher&quot;</arguments>
  <workingdirectory>$working</workingdirectory>
  <startmode>Automatic</startmode>
  <delayedAutoStart>true</delayedAutoStart>
  <stoptimeout>30 sec</stoptimeout>
  <onfailure action="restart" delay="10 sec" />
  <onfailure action="restart" delay="30 sec" />
  <onfailure action="restart" delay="60 sec" />
  <resetfailure>1 hour</resetfailure>
  <logpath>$([Security.SecurityElement]::Escape((Join-Path $InstallRoot 'logs')))</logpath>
  <log mode="roll-by-size">
    <sizeThreshold>10485760</sizeThreshold>
    <keepFiles>5</keepFiles>
  </log>
  <serviceaccount>
    <username>LocalSystem</username>
  </serviceaccount>
</service>
"@ | Set-Content -LiteralPath (Join-Path $InstallRoot "$serviceId.xml") -Encoding utf8

icacls $InstallRoot /inheritance:r /grant:r 'SYSTEM:(OI)(CI)F' 'BUILTIN\Administrators:(OI)(CI)F' | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $InstallRoot 'logs') | Out-Null
& $serviceExe install
if ($LASTEXITCODE -ne 0) { throw 'Windows service installation failed.' }
if (-not $SkipStart) {
  & $serviceExe start
  if ($LASTEXITCODE -ne 0) { throw 'Windows service start failed.' }
}

Get-Service -Name $serviceId | Select-Object Name, Status, StartType
