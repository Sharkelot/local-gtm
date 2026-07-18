-- Tenant isolation is default-deny. Runtime transactions must set
-- app.current_tenant_id with SET LOCAL / set_config(..., true).
DO $$
DECLARE
  table_name text;
  tenant_tables text[] := ARRAY[
    'Membership', 'Organization', 'Contact', 'Deal', 'Note', 'AiJob', 'AiAttempt',
    'AiSuggestion', 'OutboxEvent', 'AuditEvent', 'ImportRun', 'DuplicateCandidate',
    'Matter', 'Document', 'DocumentVersion', 'IntegrationConnection', 'TimeEntry',
    'Invoice', 'LedgerAccount', 'LedgerEntry', 'LedgerLine', 'Reconciliation',
    'IdempotencyRecord'
  ];
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

-- Authentication may resolve only the memberships belonging to the already
-- authenticated OIDC identity before a tenant has been selected.
CREATE POLICY membership_identity_lookup ON "Membership"
  FOR SELECT
  USING (
    "identityId" = NULLIF(current_setting('app.current_identity_id', true), '')::uuid
  );

-- Audit history and posted financial records are append-only. Corrections are
-- represented as new audit events and linked ledger reversals.
CREATE OR REPLACE FUNCTION reject_immutable_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% records are immutable; append a correction or reversal', TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER audit_event_immutable
BEFORE UPDATE OR DELETE ON "AuditEvent"
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();

CREATE TRIGGER ledger_entry_immutable
BEFORE UPDATE OR DELETE ON "LedgerEntry"
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();

CREATE TRIGGER ledger_line_immutable
BEFORE UPDATE OR DELETE ON "LedgerLine"
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();

ALTER TABLE "LedgerLine"
  ADD CONSTRAINT ledger_line_one_positive_side CHECK (
    ("debitCents" > 0 AND "creditCents" = 0)
    OR ("creditCents" > 0 AND "debitCents" = 0)
  );

CREATE OR REPLACE FUNCTION validate_balanced_ledger_entry()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  affected_entry uuid;
  balance bigint;
BEGIN
  affected_entry := COALESCE(NEW."entryId", OLD."entryId");
  SELECT COALESCE(SUM("debitCents" - "creditCents"), 0)
    INTO balance
    FROM "LedgerLine"
   WHERE "entryId" = affected_entry;
  IF balance <> 0 THEN
    RAISE EXCEPTION 'ledger entry % is unbalanced by % cents', affected_entry, balance
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER ledger_entry_balanced
AFTER INSERT OR UPDATE OR DELETE ON "LedgerLine"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_balanced_ledger_entry();
