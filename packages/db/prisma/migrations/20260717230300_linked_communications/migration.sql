CREATE TABLE "LinkedCommunication" (
  "id" uuid NOT NULL,
  "tenantId" uuid NOT NULL,
  "connectionId" uuid NOT NULL,
  "provider" text NOT NULL,
  "itemType" text NOT NULL,
  "providerItemId" text NOT NULL,
  "matterId" uuid,
  "organizationId" uuid,
  "subject" text,
  "occurredAt" timestamp(3),
  "linkedBy" text NOT NULL,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LinkedCommunication_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Organization_id_tenantId_key" ON "Organization"("id", "tenantId");
CREATE UNIQUE INDEX "Matter_id_tenantId_key" ON "Matter"("id", "tenantId");
CREATE UNIQUE INDEX "IntegrationConnection_id_tenantId_key" ON "IntegrationConnection"("id", "tenantId");
CREATE UNIQUE INDEX "LinkedCommunication_tenantId_provider_itemType_providerItemId_key"
  ON "LinkedCommunication"("tenantId", "provider", "itemType", "providerItemId");
CREATE INDEX "LinkedCommunication_tenantId_matterId_occurredAt_idx"
  ON "LinkedCommunication"("tenantId", "matterId", "occurredAt");
CREATE INDEX "LinkedCommunication_tenantId_organizationId_occurredAt_idx"
  ON "LinkedCommunication"("tenantId", "organizationId", "occurredAt");

ALTER TABLE "LinkedCommunication"
  ADD CONSTRAINT "LinkedCommunication_connectionId_tenantId_fkey"
  FOREIGN KEY ("connectionId", "tenantId") REFERENCES "IntegrationConnection"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LinkedCommunication"
  ADD CONSTRAINT "LinkedCommunication_matterId_tenantId_fkey"
  FOREIGN KEY ("matterId", "tenantId") REFERENCES "Matter"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LinkedCommunication"
  ADD CONSTRAINT "LinkedCommunication_organizationId_tenantId_fkey"
  FOREIGN KEY ("organizationId", "tenantId") REFERENCES "Organization"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LinkedCommunication" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LinkedCommunication" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "LinkedCommunication"
  USING ("tenantId" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
