CREATE TABLE "ClientMatterShare" (
  "id" uuid NOT NULL,
  "tenantId" uuid NOT NULL,
  "membershipId" uuid NOT NULL,
  "matterId" uuid NOT NULL,
  "sharedBy" text NOT NULL,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClientMatterShare_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ClientDocumentShare" (
  "id" uuid NOT NULL,
  "tenantId" uuid NOT NULL,
  "membershipId" uuid NOT NULL,
  "documentId" uuid NOT NULL,
  "sharedBy" text NOT NULL,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClientDocumentShare_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Membership_id_tenantId_key" ON "Membership"("id", "tenantId");
CREATE UNIQUE INDEX "Document_id_tenantId_key" ON "Document"("id", "tenantId");
CREATE UNIQUE INDEX "ClientMatterShare_tenantId_membershipId_matterId_key"
  ON "ClientMatterShare"("tenantId", "membershipId", "matterId");
CREATE INDEX "ClientMatterShare_tenantId_membershipId_createdAt_idx"
  ON "ClientMatterShare"("tenantId", "membershipId", "createdAt");
CREATE UNIQUE INDEX "ClientDocumentShare_tenantId_membershipId_documentId_key"
  ON "ClientDocumentShare"("tenantId", "membershipId", "documentId");
CREATE INDEX "ClientDocumentShare_tenantId_membershipId_createdAt_idx"
  ON "ClientDocumentShare"("tenantId", "membershipId", "createdAt");

ALTER TABLE "ClientMatterShare" ADD CONSTRAINT "ClientMatterShare_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Document" DROP CONSTRAINT "Document_matterId_fkey";
ALTER TABLE "Document" ADD CONSTRAINT "Document_matterId_tenantId_fkey"
  FOREIGN KEY ("matterId", "tenantId") REFERENCES "Matter"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DocumentVersion" DROP CONSTRAINT "DocumentVersion_documentId_fkey";
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_documentId_tenantId_fkey"
  FOREIGN KEY ("documentId", "tenantId") REFERENCES "Document"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClientMatterShare" ADD CONSTRAINT "ClientMatterShare_membershipId_tenantId_fkey"
  FOREIGN KEY ("membershipId", "tenantId") REFERENCES "Membership"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClientMatterShare" ADD CONSTRAINT "ClientMatterShare_matterId_tenantId_fkey"
  FOREIGN KEY ("matterId", "tenantId") REFERENCES "Matter"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClientDocumentShare" ADD CONSTRAINT "ClientDocumentShare_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClientDocumentShare" ADD CONSTRAINT "ClientDocumentShare_membershipId_tenantId_fkey"
  FOREIGN KEY ("membershipId", "tenantId") REFERENCES "Membership"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClientDocumentShare" ADD CONSTRAINT "ClientDocumentShare_documentId_tenantId_fkey"
  FOREIGN KEY ("documentId", "tenantId") REFERENCES "Document"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ClientMatterShare" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ClientMatterShare" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ClientMatterShare"
  USING ("tenantId" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
ALTER TABLE "ClientDocumentShare" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ClientDocumentShare" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ClientDocumentShare"
  USING ("tenantId" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
