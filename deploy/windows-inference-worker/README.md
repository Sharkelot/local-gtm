# Windows inference worker

The worker runs only on the Windows LM Studio host. It consumes BullMQ jobs
containing `aiJobId`, fetches the scoped prompt through the authenticated
internal API, and submits raw model output for server-side Zod validation.

Run the installer from an elevated PowerShell 7 prompt. Obtain the two secret
values from the protected Proxmox deployment environment; do not place them on
the command line or in source control.

```powershell
$workerToken = Read-Host 'Inference worker token' -AsSecureString
$redisPassword = Read-Host 'Redis password' -AsSecureString
./deploy/windows-inference-worker/Install-LocalGtmInferenceWorker.ps1 `
  -InferenceWorkerToken $workerToken `
  -RedisPassword $redisPassword
```

The installer:

- requires Node 24 and pnpm;
- builds and deploys a production-only worker bundle;
- downloads WinSW 2.12.0 from its official GitHub release and verifies the
  pinned SHA-256 before use;
- stores the two service secrets with machine-scope Windows DPAPI;
- restricts the install directory to `SYSTEM` and local administrators;
- connects to the application CT private address while keeping the public CRM
  hostname as the HTTPS Host/SNI name, so certificate verification remains enabled
  without public exposure or a hosts-file change;
- runs as LocalSystem with automatic delayed start and bounded log rotation.

LM Studio must expose its OpenAI-compatible server only on
`http://127.0.0.1:1234`, with the server-selected model loaded. Redis TCP/6379
must be reachable only from this Windows host. If LM Studio is off, the worker
records `WAITING_FOR_INFERENCE` and moves the same BullMQ job to delayed retry;
it does not recreate or discard the PostgreSQL `AiJob`.
