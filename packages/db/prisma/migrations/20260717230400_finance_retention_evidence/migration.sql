CREATE TYPE "AccountingPeriodStatus" AS ENUM ('OPEN', 'CLOSED');
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED');

CREATE TABLE "AccountingPeriod" (
  "id" uuid NOT NULL,
  "tenantId" uuid NOT NULL,
  "startsAt" timestamp(3) NOT NULL,
  "endsAt" timestamp(3) NOT NULL,
  "status" "AccountingPeriodStatus" NOT NULL DEFAULT 'OPEN',
  "closedBy" text,
  "closedAt" timestamp(3),
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AccountingPeriod_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AccountingPeriod_valid_range" CHECK ("startsAt" < "endsAt")
);

CREATE TABLE "PeriodLock" (
  "id" uuid NOT NULL,
  "tenantId" uuid NOT NULL,
  "accountingPeriodId" uuid NOT NULL,
  "ledgerAccountId" uuid,
  "lockedBy" text NOT NULL,
  "lockedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reason" text,
  CONSTRAINT "PeriodLock_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InvoiceLine" (
  "id" uuid NOT NULL,
  "tenantId" uuid NOT NULL,
  "invoiceId" uuid NOT NULL,
  "timeEntryId" uuid NOT NULL,
  "description" text NOT NULL,
  "minutes" integer NOT NULL,
  "rateCents" integer NOT NULL,
  "amountCents" integer NOT NULL,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InvoiceLine_positive_amounts" CHECK ("minutes" > 0 AND "rateCents" >= 0 AND "amountCents" >= 0)
);

CREATE TABLE "Payment" (
  "id" uuid NOT NULL,
  "tenantId" uuid NOT NULL,
  "invoiceId" uuid NOT NULL,
  "provider" text NOT NULL DEFAULT 'LAWPAY',
  "lawPayPaymentId" text NOT NULL,
  "lawPayTransactionId" text,
  "providerEventId" text,
  "idempotencyKey" text NOT NULL,
  "amountCents" integer NOT NULL,
  "status" "PaymentStatus" NOT NULL,
  "verifiedAt" timestamp(3) NOT NULL,
  "receivedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Payment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Payment_lawpay_only" CHECK ("provider" = 'LAWPAY'),
  CONSTRAINT "Payment_nonnegative_amount" CHECK ("amountCents" >= 0)
);

CREATE TABLE "RetentionPolicy" (
  "id" uuid NOT NULL,
  "tenantId" uuid NOT NULL,
  "recordType" text NOT NULL,
  "retentionDays" integer NOT NULL,
  "legalHold" boolean NOT NULL DEFAULT false,
  "active" boolean NOT NULL DEFAULT true,
  "createdBy" text NOT NULL,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) NOT NULL,
  CONSTRAINT "RetentionPolicy_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RetentionPolicy_nonnegative_days" CHECK ("retentionDays" >= 0)
);

CREATE TABLE "EvidenceRecord" (
  "id" uuid NOT NULL,
  "tenantId" uuid NOT NULL,
  "recordType" text NOT NULL,
  "recordId" uuid NOT NULL,
  "evidenceType" text NOT NULL,
  "sha256" text NOT NULL,
  "objectKey" text,
  "objectVersion" text,
  "capturedBy" text NOT NULL,
  "capturedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EvidenceRecord_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EvidenceRecord_sha256" CHECK ("sha256" ~ '^[A-Fa-f0-9]{64}$')
);

CREATE UNIQUE INDEX "AccountingPeriod_id_tenantId_key" ON "AccountingPeriod"("id", "tenantId");
CREATE UNIQUE INDEX "AccountingPeriod_tenantId_startsAt_endsAt_key" ON "AccountingPeriod"("tenantId", "startsAt", "endsAt");
CREATE INDEX "AccountingPeriod_tenantId_status_endsAt_idx" ON "AccountingPeriod"("tenantId", "status", "endsAt");
CREATE UNIQUE INDEX "PeriodLock_tenantId_accountingPeriodId_ledgerAccountId_key" ON "PeriodLock"("tenantId", "accountingPeriodId", "ledgerAccountId");
CREATE UNIQUE INDEX "PeriodLock_one_global_lock_per_period_key"
  ON "PeriodLock"("tenantId", "accountingPeriodId")
  WHERE "ledgerAccountId" IS NULL;
CREATE INDEX "PeriodLock_tenantId_lockedAt_idx" ON "PeriodLock"("tenantId", "lockedAt");
CREATE UNIQUE INDEX "InvoiceLine_tenantId_timeEntryId_key" ON "InvoiceLine"("tenantId", "timeEntryId");
CREATE INDEX "InvoiceLine_tenantId_invoiceId_idx" ON "InvoiceLine"("tenantId", "invoiceId");
CREATE UNIQUE INDEX "Payment_tenantId_lawPayPaymentId_key" ON "Payment"("tenantId", "lawPayPaymentId");
CREATE UNIQUE INDEX "Payment_tenantId_providerEventId_key" ON "Payment"("tenantId", "providerEventId");
CREATE UNIQUE INDEX "Payment_tenantId_idempotencyKey_key" ON "Payment"("tenantId", "idempotencyKey");
CREATE INDEX "Payment_tenantId_invoiceId_receivedAt_idx" ON "Payment"("tenantId", "invoiceId", "receivedAt");
CREATE UNIQUE INDEX "RetentionPolicy_tenantId_recordType_key" ON "RetentionPolicy"("tenantId", "recordType");
CREATE INDEX "RetentionPolicy_tenantId_active_idx" ON "RetentionPolicy"("tenantId", "active");
CREATE UNIQUE INDEX "EvidenceRecord_tenantId_recordType_recordId_evidenceType_sha256_key" ON "EvidenceRecord"("tenantId", "recordType", "recordId", "evidenceType", "sha256");
CREATE INDEX "EvidenceRecord_tenantId_recordType_recordId_capturedAt_idx" ON "EvidenceRecord"("tenantId", "recordType", "recordId", "capturedAt");

CREATE UNIQUE INDEX "TimeEntry_id_tenantId_key" ON "TimeEntry"("id", "tenantId");
CREATE UNIQUE INDEX "Invoice_id_tenantId_key" ON "Invoice"("id", "tenantId");
CREATE UNIQUE INDEX "LedgerAccount_id_tenantId_key" ON "LedgerAccount"("id", "tenantId");
CREATE UNIQUE INDEX "LedgerEntry_id_tenantId_key" ON "LedgerEntry"("id", "tenantId");
CREATE UNIQUE INDEX "LedgerEntry_tenantId_reversedEntryId_key" ON "LedgerEntry"("tenantId", "reversedEntryId");

ALTER TABLE "AccountingPeriod" ADD CONSTRAINT "AccountingPeriod_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PeriodLock" ADD CONSTRAINT "PeriodLock_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PeriodLock" ADD CONSTRAINT "PeriodLock_accountingPeriodId_tenantId_fkey" FOREIGN KEY ("accountingPeriodId", "tenantId") REFERENCES "AccountingPeriod"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PeriodLock" ADD CONSTRAINT "PeriodLock_ledgerAccountId_tenantId_fkey" FOREIGN KEY ("ledgerAccountId", "tenantId") REFERENCES "LedgerAccount"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoiceId_tenantId_fkey" FOREIGN KEY ("invoiceId", "tenantId") REFERENCES "Invoice"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_timeEntryId_tenantId_fkey" FOREIGN KEY ("timeEntryId", "tenantId") REFERENCES "TimeEntry"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_invoiceId_tenantId_fkey" FOREIGN KEY ("invoiceId", "tenantId") REFERENCES "Invoice"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RetentionPolicy" ADD CONSTRAINT "RetentionPolicy_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EvidenceRecord" ADD CONSTRAINT "EvidenceRecord_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_reversedEntryId_tenantId_fkey" FOREIGN KEY ("reversedEntryId", "tenantId") REFERENCES "LedgerEntry"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

DO $$
DECLARE
  table_name text;
  tenant_tables text[] := ARRAY['AccountingPeriod', 'PeriodLock', 'InvoiceLine', 'Payment', 'RetentionPolicy', 'EvidenceRecord'];
BEGIN
  FOREACH table_name IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING ("tenantId" = NULLIF(current_setting(''app.current_tenant_id'', true), '''')::uuid) WITH CHECK ("tenantId" = NULLIF(current_setting(''app.current_tenant_id'', true), '''')::uuid)',
      table_name
    );
  END LOOP;
END $$;

CREATE TRIGGER invoice_line_immutable BEFORE UPDATE OR DELETE ON "InvoiceLine"
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER payment_immutable BEFORE UPDATE OR DELETE ON "Payment"
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER period_lock_immutable BEFORE UPDATE OR DELETE ON "PeriodLock"
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER evidence_record_immutable BEFORE UPDATE OR DELETE ON "EvidenceRecord"
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();

CREATE OR REPLACE FUNCTION prevent_closed_accounting_period_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."status" = 'CLOSED' AND (
    NEW."status" <> 'CLOSED'
    OR NEW."startsAt" IS DISTINCT FROM OLD."startsAt"
    OR NEW."endsAt" IS DISTINCT FROM OLD."endsAt"
  ) THEN
    RAISE EXCEPTION 'closed accounting periods cannot be reopened or retimed'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER accounting_period_closed_immutable
BEFORE UPDATE ON "AccountingPeriod"
FOR EACH ROW EXECUTE FUNCTION prevent_closed_accounting_period_change();
