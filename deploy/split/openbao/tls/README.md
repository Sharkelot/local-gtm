# OpenBao TLS material

Before starting the documents CT, an operator must provision these uncommitted files:

- `tls.crt` and `tls.key` for the private OpenBao endpoint
- `ca.crt` for the CA trusted by the application CT

The certificate SAN must match the private OpenBao DNS name configured on the application CT.
