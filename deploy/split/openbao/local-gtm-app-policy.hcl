path "transit/encrypt/local-gtm-ai" {
  capabilities = ["update"]
}

path "transit/decrypt/local-gtm-ai" {
  capabilities = ["update"]
}

path "transit/encrypt/local-gtm-document-data-key" {
  capabilities = ["update"]
}

path "transit/decrypt/local-gtm-document-data-key" {
  capabilities = ["update"]
}

path "transit/keys/local-gtm-ai" {
  capabilities = ["read"]
}

path "transit/keys/local-gtm-document-data-key" {
  capabilities = ["read"]
}
