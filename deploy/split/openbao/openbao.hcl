ui = false

storage "file" {
  path = "/openbao/file"
}

listener "tcp" {
  address = "0.0.0.0:8200"
  tls_disable = 0
  tls_cert_file = "/openbao/tls/tls.crt"
  tls_key_file = "/openbao/tls/tls.key"
  tls_client_ca_file = "/openbao/tls/ca.crt"
}

# Workloads use their configured private HTTPS endpoint directly. Initialization, unsealing,
# KV/Transit enablement, and workload-auth configuration are intentional operator actions.
