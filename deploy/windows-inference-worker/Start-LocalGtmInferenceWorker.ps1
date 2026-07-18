$ErrorActionPreference = 'Stop'

$installRoot = Split-Path -Parent $PSCommandPath
$config = Get-Content -Raw -LiteralPath (Join-Path $installRoot 'worker.config.json') | ConvertFrom-Json
$protected = Get-Content -Raw -LiteralPath (Join-Path $installRoot 'worker.secrets.json') | ConvertFrom-Json

function Unprotect-MachineSecret([string] $value) {
  $cipher = [Convert]::FromBase64String($value)
  $bytes = [Security.Cryptography.ProtectedData]::Unprotect(
    $cipher,
    $null,
    [Security.Cryptography.DataProtectionScope]::LocalMachine
  )
  try {
    return [Text.Encoding]::UTF8.GetString($bytes)
  } finally {
    [Array]::Clear($bytes, 0, $bytes.Length)
  }
}

$env:INTERNAL_API_URL = $config.internalApiUrl
$env:INTERNAL_API_CONNECT_HOST = $config.internalApiConnectHost
if ($config.internalApiCaPath) { $env:INTERNAL_API_CA_PATH = $config.internalApiCaPath }
$env:REDIS_HOST = $config.redisHost
$env:REDIS_PORT = [string]$config.redisPort
$env:LM_STUDIO_BASE_URL = $config.lmStudioBaseUrl
$env:HEARTBEAT_INTERVAL_MS = [string]$config.heartbeatIntervalMs
$env:INFERENCE_WORKER_TOKEN = Unprotect-MachineSecret $protected.inferenceWorkerToken
$env:REDIS_PASSWORD = Unprotect-MachineSecret $protected.redisPassword

try {
  & $config.nodePath $config.appEntry
  exit $LASTEXITCODE
} finally {
  Remove-Item Env:INFERENCE_WORKER_TOKEN, Env:REDIS_PASSWORD -ErrorAction SilentlyContinue
}
