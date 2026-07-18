# PostgreSQL CA

Provision `root.crt` out of band from the CT601 PostgreSQL certificate authority. It must validate the hostname in `KEYCLOAK_DATABASE_URL`; do not commit certificate or key material here.
