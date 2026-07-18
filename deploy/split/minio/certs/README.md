# MinIO TLS material

Before starting the documents CT, an operator must provision these uncommitted files:

- `public.crt` and `private.key` for the private MinIO endpoint
- `CAs/inter-ct-ca.crt` for the CA trusted by MinIO clients and the bootstrap job

The certificate SAN must match the private MinIO DNS name configured on the application CT.
