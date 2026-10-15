-- Append-only protection for audit evidence. Normal application workflows (and any
-- SQL issued through the application role) cannot alter or remove these records.
-- A database superuser can still disable triggers; the audit hash chain makes such
-- tampering detectable (see /admin/audit → "Verify chain").
CREATE OR REPLACE FUNCTION mjms_reject_modification() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Table % is append-only: % is not permitted', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION mjms_reject_modification();
--> statement-breakpoint
CREATE TRIGGER audit_events_no_truncate BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION mjms_reject_modification();
--> statement-breakpoint
CREATE TRIGGER approvals_append_only BEFORE UPDATE OR DELETE ON approvals
  FOR EACH ROW EXECUTE FUNCTION mjms_reject_modification();
--> statement-breakpoint
CREATE TRIGGER approvals_no_truncate BEFORE TRUNCATE ON approvals
  FOR EACH STATEMENT EXECUTE FUNCTION mjms_reject_modification();
--> statement-breakpoint
CREATE TRIGGER file_access_log_append_only BEFORE UPDATE OR DELETE ON file_access_log
  FOR EACH ROW EXECUTE FUNCTION mjms_reject_modification();
--> statement-breakpoint
-- Files are immutable once stored (content identity must not change under a reference).
CREATE OR REPLACE FUNCTION mjms_files_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'files are retained: DELETE is not permitted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.storage_key IS DISTINCT FROM OLD.storage_key OR NEW.sha256 IS DISTINCT FROM OLD.sha256 AND OLD.sha256 IS NOT NULL
     OR NEW.size_bytes IS DISTINCT FROM OLD.size_bytes THEN
    RAISE EXCEPTION 'file content identity is immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER files_immutable BEFORE UPDATE OR DELETE ON files
  FOR EACH ROW EXECUTE FUNCTION mjms_files_immutable();
--> statement-breakpoint
-- Released CNC program revisions and released document revisions keep their file.
CREATE OR REPLACE FUNCTION mjms_revision_file_locked() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '% rows are retained: DELETE is not permitted', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status NOT IN ('draft') AND NEW.file_id IS DISTINCT FROM OLD.file_id THEN
    RAISE EXCEPTION 'file of a non-draft revision cannot be replaced; create a new revision' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER cnc_program_revisions_locked BEFORE UPDATE OR DELETE ON cnc_program_revisions
  FOR EACH ROW EXECUTE FUNCTION mjms_revision_file_locked();
--> statement-breakpoint
CREATE TRIGGER document_revisions_locked BEFORE UPDATE OR DELETE ON document_revisions
  FOR EACH ROW EXECUTE FUNCTION mjms_revision_file_locked();
