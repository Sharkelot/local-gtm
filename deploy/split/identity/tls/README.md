# CT603 private HTTPS certificates

This directory is a mount point only. Do not commit certificate or private-key
material. Deliver the following files out of band with owner-only host access:

- `keycloak.crt` and `keycloak.key`: a leaf certificate and key for
  `KEYCLOAK_HOSTNAME`, `KEYCLOAK_ADMIN_HOSTNAME`, and the hostname in CT600's
  `KEYCLOAK_UPSTREAM` (for example, `keycloak.private.example.invalid`).
- `grafana.crt` and `grafana.key`: a leaf certificate and key for
  `GRAFANA_ROOT_URL` and the hostname in CT600's `GRAFANA_UPSTREAM` (for
  example, `grafana.private.example.invalid`).
- `otel.crt` and `otel.key`: a leaf certificate and key for the private CT603
  hostname or IP in CT600's `OTEL_EXPORTER_OTLP_ENDPOINT`.

Certificates must chain to the private CA bundle mounted by CT600 Caddy through
`PRIVATE_CA_BUNDLE_PATH`. Use PEM files, include required intermediates in each
certificate file, and set private-key mode to `0600`. Verify hostname/SAN and
expiry before deployment. Keycloak listens only on private HTTPS port `8443`;
Grafana listens only on private HTTPS port `3000`; OTLP/HTTP listens only on
private HTTPS port `4318`.

Do not place CA keys, leaf keys, or generated certificates in this repository.
