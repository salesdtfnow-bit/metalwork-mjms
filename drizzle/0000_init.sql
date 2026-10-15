CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"meaning" text NOT NULL,
	"user_id" uuid NOT NULL,
	"user_name" text NOT NULL,
	"reauthenticated" boolean DEFAULT false NOT NULL,
	"comment" text,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid,
	"user_name" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"entity_ref" text,
	"job_id" uuid,
	"operation_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"reason" text,
	"approval_id" uuid,
	"exception_id" uuid,
	"ip_address" text,
	"outcome" text DEFAULT 'success' NOT NULL,
	"prev_hash" text,
	"hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"company_name" text DEFAULT 'Your Company Ltd' NOT NULL,
	"address_lines" text DEFAULT '' NOT NULL,
	"phone" text,
	"email" text,
	"website" text,
	"vat_number" text,
	"company_number" text,
	"timezone" text DEFAULT 'Europe/London' NOT NULL,
	"currency" text DEFAULT 'GBP' NOT NULL,
	"default_tax_rate" text DEFAULT '20' NOT NULL,
	"quote_validity_days" integer DEFAULT 30 NOT NULL,
	"default_quote_terms" text DEFAULT '' NOT NULL,
	"logo_file_id" uuid,
	"retention_years" integer DEFAULT 10 NOT NULL,
	"allow_self_inspection" boolean DEFAULT false NOT NULL,
	"require_independent_approval" boolean DEFAULT true NOT NULL,
	"boxhero_mode" text DEFAULT 'simulated' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "counters" (
	"key" text PRIMARY KEY NOT NULL,
	"value" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idempotency_key" text NOT NULL,
	"to" text[] NOT NULL,
	"subject" text NOT NULL,
	"html" text NOT NULL,
	"text" text,
	"attachment_file_ids" uuid[],
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"provider_message_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "file_access_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"file_id" uuid NOT NULL,
	"user_id" uuid,
	"action" text DEFAULT 'download' NOT NULL,
	"context" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"storage" text NOT NULL,
	"storage_key" text NOT NULL,
	"original_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text,
	"is_customer_original" boolean DEFAULT false NOT NULL,
	"uploaded_by" uuid,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gate_exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ref" text NOT NULL,
	"gate" text NOT NULL,
	"job_id" uuid NOT NULL,
	"operation_id" uuid,
	"reason" text NOT NULL,
	"requested_by" uuid NOT NULL,
	"status" text DEFAULT 'approved' NOT NULL,
	"approved_by" uuid,
	"approval_id" uuid,
	"valid_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "integration_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"integration" text NOT NULL,
	"direction" text NOT NULL,
	"action" text NOT NULL,
	"status" text NOT NULL,
	"message" text,
	"detail" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_state" (
	"key" text PRIMARY KEY NOT NULL,
	"last_success_at" timestamp with time zone,
	"last_error_at" timestamp with time zone,
	"last_error" text,
	"last_sync_cursor" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"in_app" boolean DEFAULT true NOT NULL,
	"email" boolean DEFAULT false NOT NULL,
	CONSTRAINT "notification_preferences_user_id_type_pk" PRIMARY KEY("user_id","type")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"link" text,
	"entity_type" text,
	"entity_id" text,
	"dedupe_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retention_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"record_type" text NOT NULL,
	"years" integer NOT NULL,
	"basis" text DEFAULT 'from record closure' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" uuid NOT NULL,
	"permission" text NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_pk" PRIMARY KEY("role_id","permission")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"ip_address" text,
	"user_agent" text,
	"reauth_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "status_transitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" text NOT NULL,
	"from_status" text NOT NULL,
	"to_status" text NOT NULL,
	"permission" text NOT NULL,
	"requires_reason" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	CONSTRAINT "user_roles_user_id_role_id_pk" PRIMARY KEY("user_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"employee_id" uuid,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"deactivated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid,
	"supplier_id" uuid,
	"kind" text DEFAULT 'delivery' NOT NULL,
	"label" text,
	"line1" text NOT NULL,
	"line2" text,
	"city" text,
	"county" text,
	"postcode" text,
	"country" text DEFAULT 'United Kingdom' NOT NULL,
	"delivery_instructions" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid,
	"supplier_id" uuid,
	"name" text NOT NULL,
	"job_title" text,
	"email" text,
	"phone" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"description" text NOT NULL,
	"mandatory" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"website" text,
	"vat_number" text,
	"account_ref" text,
	"payment_terms" text,
	"currency" text DEFAULT 'GBP' NOT NULL,
	"delivery_preferences" text,
	"quality_requirements" text,
	"required_certificates" text,
	"packaging_requirements" text,
	"notes" text,
	"credit_limit" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "party_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid,
	"supplier_id" uuid,
	"file_id" uuid NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"website" text,
	"vat_number" text,
	"account_ref" text,
	"payment_terms" text,
	"currency" text DEFAULT 'GBP' NOT NULL,
	"categories" text[] DEFAULT '{}' NOT NULL,
	"approval_status" text DEFAULT 'pending' NOT NULL,
	"approval_scope" text,
	"approval_expires_on" date,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"certifications" text,
	"notes" text,
	"boxhero_partner_id" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "controlled_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doc_number" text NOT NULL,
	"title" text NOT NULL,
	"doc_type" text NOT NULL,
	"customer_id" uuid,
	"supplier_id" uuid,
	"machine_id" uuid,
	"part_id" uuid,
	"is_customer_supplied" boolean DEFAULT false NOT NULL,
	"current_revision_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"revision" text NOT NULL,
	"file_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"change_description" text,
	"author_id" uuid,
	"reviewer_id" uuid,
	"reviewed_at" timestamp with time zone,
	"approver_id" uuid,
	"approved_at" timestamp with time zone,
	"released_by" uuid,
	"released_at" timestamp with time zone,
	"effective_date" date,
	"supersedes_id" uuid,
	"superseded_by_id" uuid,
	"superseded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "part_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"part_id" uuid NOT NULL,
	"revision" text NOT NULL,
	"drawing_revision_id" uuid,
	"is_current" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"part_number" text NOT NULL,
	"customer_id" uuid,
	"description" text NOT NULL,
	"material_spec_id" uuid,
	"traceability_level" text DEFAULT 'job' NOT NULL,
	"drawing_document_id" uuid,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ref" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"customer_po_number" text NOT NULL,
	"po_date" date,
	"po_file_id" uuid,
	"quotation_revision_id" uuid,
	"delivery_address_id" uuid,
	"required_date" date,
	"currency" text DEFAULT 'GBP' NOT NULL,
	"order_value" numeric(14, 2),
	"commercial_terms" text,
	"status" text DEFAULT 'received' NOT NULL,
	"discrepancies" text,
	"received_by" uuid,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verified_by" uuid,
	"verified_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "enquiries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ref" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"contact_id" uuid,
	"subject" text NOT NULL,
	"description" text,
	"received_at" timestamp with time zone NOT NULL,
	"received_via" text DEFAULT 'email' NOT NULL,
	"customer_reference" text,
	"requested_delivery_date" date,
	"owner_id" uuid,
	"status" text DEFAULT 'new' NOT NULL,
	"closed_reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "enquiry_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"enquiry_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"kind" text DEFAULT 'other' NOT NULL,
	"inbound_email_id" uuid,
	"document_revision_id" uuid,
	"note" text,
	"added_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "enquiry_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"enquiry_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"part_id" uuid,
	"part_number" text NOT NULL,
	"description" text NOT NULL,
	"quantity" numeric(14, 4) NOT NULL,
	"drawing_number" text,
	"drawing_revision" text,
	"material_grade" text,
	"tolerances" text,
	"surface_finish" text,
	"special_requirements" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbound_email_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inbound_email_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"content_type" text
);
--> statement-breakpoint
CREATE TABLE "inbound_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"provider_message_id" text NOT NULL,
	"message_id_header" text,
	"from_address" text NOT NULL,
	"from_name" text,
	"to_addresses" text[] DEFAULT '{}' NOT NULL,
	"cc_addresses" text[] DEFAULT '{}' NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"text_body" text,
	"html_body" text,
	"raw_file_id" uuid,
	"status" text DEFAULT 'unassigned' NOT NULL,
	"enquiry_id" uuid,
	"linked_by" uuid,
	"linked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotation_line_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"line_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"operation_type_id" uuid,
	"description" text NOT NULL,
	"setup_minutes" numeric(14, 4) DEFAULT '0' NOT NULL,
	"cycle_minutes" numeric(14, 4) DEFAULT '0' NOT NULL,
	"rate_per_hour" numeric(14, 4) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotation_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"revision_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"part_id" uuid,
	"part_number" text NOT NULL,
	"description" text NOT NULL,
	"drawing_number" text,
	"drawing_revision" text,
	"drawing_revision_id" uuid,
	"material_spec" text,
	"quantity" numeric(14, 4) NOT NULL,
	"batch_size" numeric(14, 4),
	"material_cost_per_unit" numeric(14, 4) DEFAULT '0' NOT NULL,
	"material_wastage_pct" numeric(14, 4) DEFAULT '0' NOT NULL,
	"programming_cost" numeric(14, 2) DEFAULT '0' NOT NULL,
	"setup_cost_per_batch" numeric(14, 2) DEFAULT '0' NOT NULL,
	"labour_cost" numeric(14, 2) DEFAULT '0' NOT NULL,
	"tooling_cost" numeric(14, 2) DEFAULT '0' NOT NULL,
	"consumables_cost" numeric(14, 2) DEFAULT '0' NOT NULL,
	"subcontract_cost" numeric(14, 2) DEFAULT '0' NOT NULL,
	"finishing_cost" numeric(14, 2) DEFAULT '0' NOT NULL,
	"inspection_cost" numeric(14, 2) DEFAULT '0' NOT NULL,
	"certification_cost" numeric(14, 2) DEFAULT '0' NOT NULL,
	"packaging_cost" numeric(14, 2) DEFAULT '0' NOT NULL,
	"delivery_cost" numeric(14, 2) DEFAULT '0' NOT NULL,
	"other_cost" numeric(14, 2) DEFAULT '0' NOT NULL,
	"margin_pct" numeric(14, 4),
	"price_override_per_unit" numeric(14, 4),
	"price_override_reason" text,
	"machining_cost" numeric(14, 2) DEFAULT '0' NOT NULL,
	"total_cost" numeric(14, 2) DEFAULT '0' NOT NULL,
	"unit_cost" numeric(14, 4) DEFAULT '0' NOT NULL,
	"unit_price" numeric(14, 4) DEFAULT '0' NOT NULL,
	"line_total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "quotation_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quotation_id" uuid NOT NULL,
	"revision_no" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"currency" text DEFAULT 'GBP' NOT NULL,
	"tax_treatment" text DEFAULT 'standard' NOT NULL,
	"tax_rate" numeric(14, 4) DEFAULT '20' NOT NULL,
	"default_margin_pct" numeric(14, 4) DEFAULT '25' NOT NULL,
	"validity_days" integer DEFAULT 30 NOT NULL,
	"valid_until" date,
	"lead_time" text,
	"commercial_terms" text,
	"delivery_terms" text,
	"notes" text,
	"internal_notes" text,
	"subtotal" numeric(14, 2) DEFAULT '0' NOT NULL,
	"tax_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"total_cost" numeric(14, 2) DEFAULT '0' NOT NULL,
	"prepared_by" uuid,
	"submitted_for_review_at" timestamp with time zone,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_approval_id" uuid,
	"sent_at" timestamp with time zone,
	"sent_by" uuid,
	"sent_to" text,
	"pdf_file_id" uuid,
	"customer_feedback" text,
	"responded_at" timestamp with time zone,
	"acceptance_evidence_file_id" uuid,
	"acceptance_recorded_by" uuid,
	"acceptance_recorded_at" timestamp with time zone,
	"acceptance_verified_by" uuid,
	"acceptance_verified_at" timestamp with time zone,
	"acceptance_reference" text,
	"is_locked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ref" text NOT NULL,
	"enquiry_id" uuid,
	"customer_id" uuid NOT NULL,
	"contact_id" uuid,
	"title" text NOT NULL,
	"owner_id" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"latest_revision_no" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_line_id" uuid NOT NULL,
	"batch_no" text NOT NULL,
	"quantity" numeric(14, 4) NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "downtime_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"machine_id" uuid NOT NULL,
	"operation_id" uuid,
	"reason_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"reported_by" uuid,
	"notes" text,
	"maintenance_work_order_id" uuid,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"part_id" uuid NOT NULL,
	"part_revision_id" uuid,
	"part_number" text NOT NULL,
	"description" text NOT NULL,
	"drawing_revision_id" uuid,
	"quotation_line_id" uuid,
	"quantity" numeric(14, 4) NOT NULL,
	"unit_price" numeric(14, 4),
	"material_spec" text,
	"traceability_level" text DEFAULT 'job' NOT NULL,
	"route_status" text DEFAULT 'draft' NOT NULL,
	"route_released_by" uuid,
	"route_released_at" timestamp with time zone,
	"qty_good" numeric(14, 4) DEFAULT '0' NOT NULL,
	"qty_rejected" numeric(14, 4) DEFAULT '0' NOT NULL,
	"qty_scrapped" numeric(14, 4) DEFAULT '0' NOT NULL,
	"qty_accepted" numeric(14, 4) DEFAULT '0' NOT NULL,
	"qty_released" numeric(14, 4) DEFAULT '0' NOT NULL,
	"qty_dispatched" numeric(14, 4) DEFAULT '0' NOT NULL,
	"drawing_review_required" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_number" text NOT NULL,
	"title" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"customer_order_id" uuid,
	"quotation_revision_id" uuid,
	"repeat_of_job_id" uuid,
	"status" text DEFAULT 'order_confirmed' NOT NULL,
	"status_before_hold" text,
	"priority" integer DEFAULT 3 NOT NULL,
	"owner_id" uuid,
	"required_date" date,
	"promised_date" date,
	"delivery_address_id" uuid,
	"material_requirements" text,
	"inspection_requirements" text,
	"certification_requirements" text,
	"packaging_requirements" text,
	"delivery_requirements" text,
	"commercial_terms" text,
	"next_action" text,
	"hold_reason" text,
	"notes" text,
	"authorised_by" uuid,
	"authorised_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operation_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"role" text DEFAULT 'operator' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"assigned_by" uuid,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"unassigned_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "operation_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"material_lot_id" uuid,
	"program_revision_id" uuid,
	"drawing_revision_id" uuid,
	"value" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operation_dependencies" (
	"operation_id" uuid NOT NULL,
	"depends_on_id" uuid NOT NULL,
	CONSTRAINT "operation_dependencies_operation_id_depends_on_id_pk" PRIMARY KEY("operation_id","depends_on_id")
);
--> statement-breakpoint
CREATE TABLE "operation_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_id" uuid NOT NULL,
	"document_revision_id" uuid NOT NULL,
	"purpose" text DEFAULT 'reference' NOT NULL,
	"pinned_by" uuid,
	"pinned_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operation_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"message" text NOT NULL,
	"user_id" uuid,
	"employee_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "operation_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"category" text DEFAULT 'machining' NOT NULL,
	"requires_machine" boolean DEFAULT true NOT NULL,
	"requires_program_default" boolean DEFAULT false NOT NULL,
	"requires_first_off_default" boolean DEFAULT false NOT NULL,
	"is_subcontract" boolean DEFAULT false NOT NULL,
	"is_inspection" boolean DEFAULT false NOT NULL,
	"default_competency_id" uuid,
	"default_rate_per_hour" numeric(14, 4),
	"sort_order" integer DEFAULT 100 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"job_line_id" uuid NOT NULL,
	"batch_id" uuid,
	"sequence" integer NOT NULL,
	"op_number" text NOT NULL,
	"operation_type_id" uuid NOT NULL,
	"title" text NOT NULL,
	"instructions" text,
	"machine_group_id" uuid,
	"machine_id" uuid,
	"planned_start" timestamp with time zone,
	"planned_end" timestamp with time zone,
	"setup_minutes_est" numeric(14, 4) DEFAULT '0' NOT NULL,
	"cycle_minutes_est" numeric(14, 4) DEFAULT '0' NOT NULL,
	"planned_qty" numeric(14, 4) NOT NULL,
	"qty_good" numeric(14, 4) DEFAULT '0' NOT NULL,
	"qty_rejected" numeric(14, 4) DEFAULT '0' NOT NULL,
	"qty_scrapped" numeric(14, 4) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"status_before_hold" text,
	"setup_status" text DEFAULT 'not_started' NOT NULL,
	"requires_material" boolean DEFAULT false NOT NULL,
	"requires_program" boolean DEFAULT false NOT NULL,
	"requires_first_off" boolean DEFAULT false NOT NULL,
	"first_off_status" text DEFAULT 'not_required' NOT NULL,
	"required_competency_id" uuid,
	"program_revision_id" uuid,
	"drawing_revision_id" uuid,
	"inspection_plan_id" uuid,
	"tooling_requirements" text,
	"fixture_requirements" text,
	"review_required" boolean DEFAULT false NOT NULL,
	"review_reason" text,
	"allow_parallel" boolean DEFAULT false NOT NULL,
	"is_rework" boolean DEFAULT false NOT NULL,
	"ncr_id" uuid,
	"split_from_id" uuid,
	"repeat_of_id" uuid,
	"actual_start" timestamp with time zone,
	"actual_end" timestamp with time zone,
	"signed_off_by" uuid,
	"signed_off_at" timestamp with time zone,
	"sign_off_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedule_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_id" uuid NOT NULL,
	"old_machine_id" uuid,
	"new_machine_id" uuid,
	"old_start" timestamp with time zone,
	"new_start" timestamp with time zone,
	"old_end" timestamp with time zone,
	"new_end" timestamp with time zone,
	"reason" text,
	"changed_by" uuid,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "serials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_line_id" uuid NOT NULL,
	"batch_id" uuid,
	"serial_no" text NOT NULL,
	"status" text DEFAULT 'in_process' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"machine_id" uuid,
	"kind" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"qty_good" numeric(14, 4) DEFAULT '0' NOT NULL,
	"qty_rejected" numeric(14, 4) DEFAULT '0' NOT NULL,
	"qty_scrapped" numeric(14, 4) DEFAULT '0' NOT NULL,
	"program_revision_id" uuid,
	"material_lot_id" uuid,
	"batch_id" uuid,
	"source" text DEFAULT 'manual' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"calendar_id" uuid NOT NULL,
	"date" date NOT NULL,
	"is_working" boolean DEFAULT false NOT NULL,
	"start_time" time,
	"end_time" time,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "calendar_shifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"calendar_id" uuid NOT NULL,
	"day_of_week" integer NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"label" text
);
--> statement-breakpoint
CREATE TABLE "competencies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"operation_type_id" uuid,
	"machine_type_id" uuid,
	"machine_id" uuid,
	"requires_expiry" boolean DEFAULT false NOT NULL,
	"validity_months" integer,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "downtime_reasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"category" text DEFAULT 'unplanned' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_competencies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"competency_id" uuid NOT NULL,
	"level" text DEFAULT 'competent' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"verified_by" uuid,
	"verified_at" timestamp with time zone,
	"expires_on" date,
	"evidence_file_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_no" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"email" text,
	"phone" text,
	"job_title" text,
	"department" text,
	"supervisor_id" uuid,
	"calendar_id" uuid,
	"shift" text,
	"badge_code" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"start_date" date,
	"left_date" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "machine_capabilities" (
	"machine_id" uuid NOT NULL,
	"operation_type_id" uuid NOT NULL,
	CONSTRAINT "machine_capabilities_machine_id_operation_type_id_pk" PRIMARY KEY("machine_id","operation_type_id")
);
--> statement-breakpoint
CREATE TABLE "machine_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text
);
--> statement-breakpoint
CREATE TABLE "machine_status_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"machine_id" uuid NOT NULL,
	"status" text NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"reason" text,
	"operation_id" uuid,
	"user_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "machine_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"custom_field_defs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "machines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"machine_type_id" uuid NOT NULL,
	"machine_group_id" uuid,
	"manufacturer" text,
	"model" text,
	"serial_number" text,
	"year_of_manufacture" integer,
	"controller" text,
	"axes" text,
	"capabilities" text,
	"work_envelope" text,
	"max_weight_kg" numeric(14, 4),
	"spindle_speed_max" integer,
	"permitted_materials" text,
	"accessories" text,
	"location" text,
	"responsible_employee_id" uuid,
	"calendar_id" uuid,
	"hourly_rate" numeric(14, 4),
	"allows_concurrent" boolean DEFAULT false NOT NULL,
	"current_status" text DEFAULT 'available' NOT NULL,
	"current_status_source" text DEFAULT 'manual' NOT NULL,
	"current_status_at" timestamp with time zone,
	"current_status_by" uuid,
	"safety_notes" text,
	"setup_requirements" text,
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "maintenance_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"machine_id" uuid NOT NULL,
	"title" text NOT NULL,
	"interval_days" integer NOT NULL,
	"checklist" text,
	"estimated_hours" numeric(14, 4),
	"responsible_employee_id" uuid,
	"service_provider_id" uuid,
	"last_done_on" date,
	"next_due_on" date,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "maintenance_work_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ref" text NOT NULL,
	"machine_id" uuid NOT NULL,
	"plan_id" uuid,
	"kind" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"priority" integer DEFAULT 3 NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"reported_by" uuid,
	"reported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"scheduled_start" timestamp with time zone,
	"scheduled_end" timestamp with time zone,
	"locks_machine" boolean DEFAULT true NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"completed_by" uuid,
	"service_provider_id" uuid,
	"findings" text,
	"cost" numeric(14, 2),
	"report_file_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operation_tools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_id" uuid NOT NULL,
	"tool_id" uuid NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "tool_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tool_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"operation_id" uuid,
	"quantity" numeric(14, 4),
	"notes" text,
	"user_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_machines" (
	"tool_id" uuid NOT NULL,
	"machine_id" uuid NOT NULL,
	CONSTRAINT "tool_machines_tool_id_machine_id_pk" PRIMARY KEY("tool_id","machine_id")
);
--> statement-breakpoint
CREATE TABLE "tools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_no" text NOT NULL,
	"description" text NOT NULL,
	"tool_type" text NOT NULL,
	"location" text,
	"status" text DEFAULT 'available' NOT NULL,
	"ownership" text DEFAULT 'mjms' NOT NULL,
	"boxhero_item_id" uuid,
	"life_unit" text DEFAULT 'none' NOT NULL,
	"life_limit" numeric(14, 4),
	"life_used" numeric(14, 4) DEFAULT '0' NOT NULL,
	"inspection_required" boolean DEFAULT false NOT NULL,
	"inspection_interval_days" integer,
	"next_inspection_due" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"title" text NOT NULL,
	"provider" text,
	"completed_on" date NOT NULL,
	"expires_on" date,
	"file_id" uuid,
	"notes" text,
	"recorded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_calendars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cnc_program_machines" (
	"program_id" uuid NOT NULL,
	"machine_id" uuid NOT NULL,
	CONSTRAINT "cnc_program_machines_program_id_machine_id_pk" PRIMARY KEY("program_id","machine_id")
);
--> statement-breakpoint
CREATE TABLE "cnc_program_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_id" uuid NOT NULL,
	"revision" text NOT NULL,
	"file_id" uuid NOT NULL,
	"checksum" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"change_description" text NOT NULL,
	"programmer_id" uuid,
	"submitted_at" timestamp with time zone,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"approval_id" uuid,
	"released_by" uuid,
	"released_at" timestamp with time zone,
	"rejected_by" uuid,
	"rejected_at" timestamp with time zone,
	"rejection_reason" text,
	"verification_status" text DEFAULT 'pending' NOT NULL,
	"verification_notes" text,
	"drawing_revision_id" uuid,
	"setup_sheet_revision_id" uuid,
	"previous_revision_id" uuid,
	"superseded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cnc_programs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_number" text NOT NULL,
	"name" text NOT NULL,
	"part_id" uuid,
	"job_id" uuid,
	"operation_type_id" uuid,
	"op_number" text,
	"description" text,
	"current_released_revision_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "batch_materials" (
	"batch_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"quantity" numeric(14, 4),
	CONSTRAINT "batch_materials_batch_id_lot_id_pk" PRIMARY KEY("batch_id","lot_id")
);
--> statement-breakpoint
CREATE TABLE "boxhero_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"boxhero_item_id" text NOT NULL,
	"name" text NOT NULL,
	"sku" text,
	"barcode" text,
	"cost" text,
	"quantity_total" numeric(14, 4),
	"quantities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"attrs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "boxhero_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"boxhero_location_id" text NOT NULL,
	"name" text NOT NULL,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "material_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lot_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"job_line_id" uuid,
	"quantity" numeric(14, 4) NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"allocated_by" uuid,
	"allocated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text
);
--> statement-breakpoint
CREATE TABLE "material_certificates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cert_number" text,
	"cert_type" text NOT NULL,
	"heat_number" text,
	"issued_by" text,
	"file_id" uuid NOT NULL,
	"verification_result" text,
	"verified_by" uuid,
	"verified_at" timestamp with time zone,
	"verification_notes" text,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "material_lot_certificates" (
	"lot_id" uuid NOT NULL,
	"certificate_id" uuid NOT NULL,
	CONSTRAINT "material_lot_certificates_lot_id_certificate_id_pk" PRIMARY KEY("lot_id","certificate_id")
);
--> statement-breakpoint
CREATE TABLE "material_lots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lot_no" text NOT NULL,
	"receipt_id" uuid NOT NULL,
	"purchase_order_line_id" uuid NOT NULL,
	"material_spec_id" uuid,
	"supplier_id" uuid NOT NULL,
	"heat_number" text NOT NULL,
	"supplier_batch_no" text,
	"form" text,
	"dimensions" text,
	"qty_received" numeric(14, 4) NOT NULL,
	"uom" text DEFAULT 'pcs' NOT NULL,
	"status" text DEFAULT 'awaiting_inspection' NOT NULL,
	"certificate_status" text DEFAULT 'pending' NOT NULL,
	"inspection_result" text,
	"inspected_by" uuid,
	"inspected_at" timestamp with time zone,
	"released_by" uuid,
	"released_at" timestamp with time zone,
	"release_approval_id" uuid,
	"quarantine_reason" text,
	"boxhero_item_id" uuid,
	"boxhero_location_id" text,
	"stock_in_sync_id" uuid,
	"storage_location" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "material_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ref" text NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"delivery_note_no" text,
	"delivery_note_file_id" uuid,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"received_by" uuid NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "material_spec_items" (
	"material_spec_id" uuid NOT NULL,
	"boxhero_item_id" uuid NOT NULL,
	"dimensions" text,
	"notes" text,
	"linked_by" uuid,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "material_spec_items_material_spec_id_boxhero_item_id_pk" PRIMARY KEY("material_spec_id","boxhero_item_id")
);
--> statement-breakpoint
CREATE TABLE "material_specs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"grade" text NOT NULL,
	"standard" text,
	"material_family" text,
	"form" text NOT NULL,
	"description" text,
	"cert_requirement" text DEFAULT '3.1' NOT NULL,
	"uom" text DEFAULT 'mm' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "material_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ref" text NOT NULL,
	"kind" text NOT NULL,
	"lot_id" uuid NOT NULL,
	"job_id" uuid,
	"job_line_id" uuid,
	"operation_id" uuid,
	"batch_id" uuid,
	"allocation_id" uuid,
	"quantity" numeric(14, 4) NOT NULL,
	"uom" text DEFAULT 'pcs' NOT NULL,
	"reason" text,
	"idempotency_key" text NOT NULL,
	"stock_sync_id" uuid,
	"approval_id" uuid,
	"performed_by" uuid NOT NULL,
	"performed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reverses_id" uuid
);
--> statement-breakpoint
CREATE TABLE "purchase_order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"job_id" uuid,
	"material_spec_id" uuid,
	"boxhero_item_id" uuid,
	"description" text NOT NULL,
	"form" text,
	"dimensions" text,
	"quantity" numeric(14, 4) NOT NULL,
	"uom" text DEFAULT 'pcs' NOT NULL,
	"unit_price" numeric(14, 4) DEFAULT '0' NOT NULL,
	"required_date" date,
	"cert_requirement" text,
	"qty_received" numeric(14, 4) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ref" text NOT NULL,
	"supplier_id" uuid NOT NULL,
	"kind" text DEFAULT 'material' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"order_date" date,
	"required_date" date,
	"supplier_reference" text,
	"currency" text DEFAULT 'GBP' NOT NULL,
	"total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"delivery_instructions" text,
	"notes" text,
	"created_by" uuid,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_requisitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ref" text NOT NULL,
	"job_id" uuid,
	"job_line_id" uuid,
	"material_spec_id" uuid,
	"description" text NOT NULL,
	"dimensions" text,
	"quantity" numeric(14, 4) NOT NULL,
	"uom" text DEFAULT 'pcs' NOT NULL,
	"required_date" date,
	"status" text DEFAULT 'open' NOT NULL,
	"purchase_order_line_id" uuid,
	"requested_by" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "simulated_boxhero_transactions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "simulated_boxhero_transactions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"type" text NOT NULL,
	"item_id" text NOT NULL,
	"location_id" text,
	"quantity" numeric(14, 4) NOT NULL,
	"memo" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_sync_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idempotency_key" text NOT NULL,
	"kind" text NOT NULL,
	"boxhero_item_id" text NOT NULL,
	"location_id" text,
	"from_location_id" text,
	"quantity" numeric(14, 4) NOT NULL,
	"memo" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"boxhero_tx_id" text,
	"mode" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"job_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calibration_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instrument_id" uuid NOT NULL,
	"calibrated_on" date NOT NULL,
	"due_on" date NOT NULL,
	"result" text NOT NULL,
	"as_found_in_tolerance" boolean DEFAULT true NOT NULL,
	"certificate_no" text,
	"provider_id" uuid,
	"performed_by" text,
	"file_id" uuid,
	"notes" text,
	"recorded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "corrective_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ref" text NOT NULL,
	"ncr_id" uuid,
	"title" text NOT NULL,
	"problem" text NOT NULL,
	"root_cause" text,
	"action" text,
	"owner_id" uuid,
	"due_date" date,
	"status" text DEFAULT 'open' NOT NULL,
	"implemented_at" timestamp with time zone,
	"verification_method" text,
	"verification_due_date" date,
	"verified_by" uuid,
	"verified_at" timestamp with time zone,
	"effective" boolean,
	"verification_notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "final_release_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"release_id" uuid NOT NULL,
	"source" text NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"detail" text,
	"checked_by" uuid,
	"checked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "final_releases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"job_line_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"qty_released" numeric(14, 4),
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"approval_id" uuid,
	"comments" text,
	"coc_file_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_type" text NOT NULL,
	"job_id" uuid,
	"operation_id" uuid,
	"batch_id" uuid,
	"lot_id" uuid,
	"ncr_id" uuid,
	"reason" text NOT NULL,
	"qty_held" numeric(14, 4),
	"placed_by" uuid NOT NULL,
	"placed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_by" uuid,
	"released_at" timestamp with time zone,
	"release_reason" text
);
--> statement-breakpoint
CREATE TABLE "inspection_characteristics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"balloon_no" text,
	"name" text NOT NULL,
	"char_type" text DEFAULT 'dimensional' NOT NULL,
	"specification" text,
	"nominal" numeric(18, 6),
	"tol_minus" numeric(18, 6),
	"tol_plus" numeric(18, 6),
	"unit" text,
	"method" text,
	"instrument_type" text,
	"sample_size" text DEFAULT '1' NOT NULL,
	"frequency" text,
	"acceptance_criteria" text,
	"evidence_required" boolean DEFAULT false NOT NULL,
	"is_critical" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inspection_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inspection_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"caption" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inspection_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"stage" text NOT NULL,
	"part_id" uuid,
	"customer_id" uuid,
	"material_spec_id" uuid,
	"operation_type_id" uuid,
	"job_id" uuid,
	"drawing_revision_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"inspector_role" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inspection_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inspection_id" uuid NOT NULL,
	"characteristic_id" uuid,
	"sample_no" integer DEFAULT 1 NOT NULL,
	"serial_id" uuid,
	"measured_value" numeric(18, 6),
	"attribute_result" text,
	"result" text NOT NULL,
	"instrument_id" uuid,
	"instrument_calibration_valid" boolean,
	"comment" text,
	"recorded_by" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"under_review" boolean DEFAULT false NOT NULL,
	"review_outcome" text
);
--> statement-breakpoint
CREATE TABLE "inspections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ref" text NOT NULL,
	"stage" text NOT NULL,
	"plan_id" uuid,
	"job_id" uuid,
	"job_line_id" uuid,
	"operation_id" uuid,
	"batch_id" uuid,
	"serial_id" uuid,
	"lot_id" uuid,
	"subcontract_order_id" uuid,
	"drawing_revision_id" uuid,
	"program_revision_id" uuid,
	"machine_id" uuid,
	"setup_operator_id" uuid,
	"status" text DEFAULT 'open' NOT NULL,
	"result" text,
	"sample_qty" numeric(14, 4),
	"qty_inspected" numeric(14, 4),
	"qty_accepted" numeric(14, 4),
	"qty_rejected" numeric(14, 4),
	"requested_by" uuid,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"inspector_id" uuid,
	"completed_at" timestamp with time zone,
	"approval_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "measuring_instruments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_no" text NOT NULL,
	"description" text NOT NULL,
	"instrument_type" text NOT NULL,
	"manufacturer" text,
	"serial_number" text,
	"range" text,
	"resolution" text,
	"location" text,
	"status" text DEFAULT 'in_service' NOT NULL,
	"calibration_required" boolean DEFAULT true NOT NULL,
	"calibration_interval_days" integer DEFAULT 365 NOT NULL,
	"last_calibrated_on" date,
	"calibration_due_on" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ncr_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ncr_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"caption" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ncrs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ref" text NOT NULL,
	"source" text DEFAULT 'internal' NOT NULL,
	"category" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"job_id" uuid,
	"job_line_id" uuid,
	"operation_id" uuid,
	"batch_id" uuid,
	"lot_id" uuid,
	"inspection_id" uuid,
	"supplier_id" uuid,
	"customer_id" uuid,
	"part_id" uuid,
	"heat_number" text,
	"qty_affected" numeric(14, 4) NOT NULL,
	"description" text NOT NULL,
	"containment_action" text,
	"disposition" text,
	"disposition_notes" text,
	"customer_concession_ref" text,
	"disposition_by" uuid,
	"disposition_at" timestamp with time zone,
	"disposition_approval_id" uuid,
	"root_cause" text,
	"raised_by" uuid NOT NULL,
	"raised_at" timestamp with time zone DEFAULT now() NOT NULL,
	"owner_id" uuid,
	"reinspection_id" uuid,
	"closed_by" uuid,
	"closed_at" timestamp with time zone,
	"closure_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "release_checklist_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text NOT NULL,
	"guidance" text,
	"required" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 100 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dispatch_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dispatch_id" uuid NOT NULL,
	"job_line_id" uuid NOT NULL,
	"batch_id" uuid,
	"quantity" numeric(14, 4) NOT NULL,
	"description" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dispatch_serials" (
	"dispatch_line_id" uuid NOT NULL,
	"serial_id" uuid NOT NULL,
	CONSTRAINT "dispatch_serials_dispatch_line_id_serial_id_pk" PRIMARY KEY("dispatch_line_id","serial_id")
);
--> statement-breakpoint
CREATE TABLE "dispatches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ref" text NOT NULL,
	"job_id" uuid NOT NULL,
	"customer_order_id" uuid,
	"customer_id" uuid NOT NULL,
	"delivery_address_id" uuid,
	"delivery_address_text" text NOT NULL,
	"customer_po_number" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"delivery_method" text,
	"carrier" text,
	"tracking_ref" text,
	"packaging_notes" text,
	"package_count" text,
	"gross_weight_kg" text,
	"certificates_included" text,
	"dispatched_at" timestamp with time zone,
	"dispatched_by" uuid,
	"delivered_at" timestamp with time zone,
	"proof_of_delivery_file_id" uuid,
	"delivery_note_file_id" uuid,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subcontract_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subcontract_order_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"kind" text DEFAULT 'certificate' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subcontract_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ref" text NOT NULL,
	"purchase_order_id" uuid,
	"supplier_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"job_line_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"batch_id" uuid,
	"process" text NOT NULL,
	"specification" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"qty_sent" numeric(14, 4),
	"dispatched_at" timestamp with time zone,
	"dispatched_by" uuid,
	"dispatch_note_ref" text,
	"required_return_date" date,
	"qty_returned" numeric(14, 4),
	"returned_at" timestamp with time zone,
	"received_by" uuid,
	"supplier_delivery_note" text,
	"qty_accepted" numeric(14, 4),
	"qty_rejected" numeric(14, 4),
	"incoming_inspection_id" uuid,
	"estimated_cost" numeric(14, 2),
	"actual_cost" numeric(14, 2),
	"accepted_by" uuid,
	"accepted_at" timestamp with time zone,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_access_log" ADD CONSTRAINT "file_access_log_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_access_log" ADD CONSTRAINT "file_access_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gate_exceptions" ADD CONSTRAINT "gate_exceptions_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gate_exceptions" ADD CONSTRAINT "gate_exceptions_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gate_exceptions" ADD CONSTRAINT "gate_exceptions_approval_id_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approvals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_requirements" ADD CONSTRAINT "customer_requirements_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_files" ADD CONSTRAINT "party_files_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_files" ADD CONSTRAINT "party_files_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_files" ADD CONSTRAINT "party_files_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "controlled_documents" ADD CONSTRAINT "controlled_documents_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "controlled_documents" ADD CONSTRAINT "controlled_documents_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "controlled_documents" ADD CONSTRAINT "controlled_documents_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "controlled_documents" ADD CONSTRAINT "controlled_documents_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "controlled_documents" ADD CONSTRAINT "controlled_documents_current_revision_id_document_revisions_id_fk" FOREIGN KEY ("current_revision_id") REFERENCES "public"."document_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "controlled_documents" ADD CONSTRAINT "controlled_documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_revisions" ADD CONSTRAINT "document_revisions_document_id_controlled_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."controlled_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_revisions" ADD CONSTRAINT "document_revisions_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_revisions" ADD CONSTRAINT "document_revisions_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_revisions" ADD CONSTRAINT "document_revisions_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_revisions" ADD CONSTRAINT "document_revisions_approver_id_users_id_fk" FOREIGN KEY ("approver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_revisions" ADD CONSTRAINT "document_revisions_released_by_users_id_fk" FOREIGN KEY ("released_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_revisions" ADD CONSTRAINT "document_revisions_supersedes_id_document_revisions_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."document_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_revisions" ADD CONSTRAINT "document_revisions_superseded_by_id_document_revisions_id_fk" FOREIGN KEY ("superseded_by_id") REFERENCES "public"."document_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_revisions" ADD CONSTRAINT "part_revisions_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_revisions" ADD CONSTRAINT "part_revisions_drawing_revision_id_document_revisions_id_fk" FOREIGN KEY ("drawing_revision_id") REFERENCES "public"."document_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parts" ADD CONSTRAINT "parts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parts" ADD CONSTRAINT "parts_drawing_document_id_controlled_documents_id_fk" FOREIGN KEY ("drawing_document_id") REFERENCES "public"."controlled_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_orders" ADD CONSTRAINT "customer_orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_orders" ADD CONSTRAINT "customer_orders_po_file_id_files_id_fk" FOREIGN KEY ("po_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_orders" ADD CONSTRAINT "customer_orders_quotation_revision_id_quotation_revisions_id_fk" FOREIGN KEY ("quotation_revision_id") REFERENCES "public"."quotation_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_orders" ADD CONSTRAINT "customer_orders_delivery_address_id_addresses_id_fk" FOREIGN KEY ("delivery_address_id") REFERENCES "public"."addresses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_orders" ADD CONSTRAINT "customer_orders_received_by_users_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_orders" ADD CONSTRAINT "customer_orders_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiry_attachments" ADD CONSTRAINT "enquiry_attachments_enquiry_id_enquiries_id_fk" FOREIGN KEY ("enquiry_id") REFERENCES "public"."enquiries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiry_attachments" ADD CONSTRAINT "enquiry_attachments_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiry_attachments" ADD CONSTRAINT "enquiry_attachments_inbound_email_id_inbound_emails_id_fk" FOREIGN KEY ("inbound_email_id") REFERENCES "public"."inbound_emails"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiry_attachments" ADD CONSTRAINT "enquiry_attachments_document_revision_id_document_revisions_id_fk" FOREIGN KEY ("document_revision_id") REFERENCES "public"."document_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiry_attachments" ADD CONSTRAINT "enquiry_attachments_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiry_lines" ADD CONSTRAINT "enquiry_lines_enquiry_id_enquiries_id_fk" FOREIGN KEY ("enquiry_id") REFERENCES "public"."enquiries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiry_lines" ADD CONSTRAINT "enquiry_lines_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_email_attachments" ADD CONSTRAINT "inbound_email_attachments_inbound_email_id_inbound_emails_id_fk" FOREIGN KEY ("inbound_email_id") REFERENCES "public"."inbound_emails"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_email_attachments" ADD CONSTRAINT "inbound_email_attachments_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_emails" ADD CONSTRAINT "inbound_emails_raw_file_id_files_id_fk" FOREIGN KEY ("raw_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_emails" ADD CONSTRAINT "inbound_emails_enquiry_id_enquiries_id_fk" FOREIGN KEY ("enquiry_id") REFERENCES "public"."enquiries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_emails" ADD CONSTRAINT "inbound_emails_linked_by_users_id_fk" FOREIGN KEY ("linked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_line_operations" ADD CONSTRAINT "quotation_line_operations_line_id_quotation_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."quotation_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_line_operations" ADD CONSTRAINT "quotation_line_operations_operation_type_id_operation_types_id_fk" FOREIGN KEY ("operation_type_id") REFERENCES "public"."operation_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_lines" ADD CONSTRAINT "quotation_lines_revision_id_quotation_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."quotation_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_lines" ADD CONSTRAINT "quotation_lines_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_lines" ADD CONSTRAINT "quotation_lines_drawing_revision_id_document_revisions_id_fk" FOREIGN KEY ("drawing_revision_id") REFERENCES "public"."document_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_revisions" ADD CONSTRAINT "quotation_revisions_quotation_id_quotations_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."quotations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_revisions" ADD CONSTRAINT "quotation_revisions_prepared_by_users_id_fk" FOREIGN KEY ("prepared_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_revisions" ADD CONSTRAINT "quotation_revisions_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_revisions" ADD CONSTRAINT "quotation_revisions_sent_by_users_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_revisions" ADD CONSTRAINT "quotation_revisions_pdf_file_id_files_id_fk" FOREIGN KEY ("pdf_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_revisions" ADD CONSTRAINT "quotation_revisions_acceptance_evidence_file_id_files_id_fk" FOREIGN KEY ("acceptance_evidence_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_revisions" ADD CONSTRAINT "quotation_revisions_acceptance_recorded_by_users_id_fk" FOREIGN KEY ("acceptance_recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_revisions" ADD CONSTRAINT "quotation_revisions_acceptance_verified_by_users_id_fk" FOREIGN KEY ("acceptance_verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_enquiry_id_enquiries_id_fk" FOREIGN KEY ("enquiry_id") REFERENCES "public"."enquiries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_job_line_id_job_lines_id_fk" FOREIGN KEY ("job_line_id") REFERENCES "public"."job_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "downtime_events" ADD CONSTRAINT "downtime_events_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "downtime_events" ADD CONSTRAINT "downtime_events_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "downtime_events" ADD CONSTRAINT "downtime_events_reason_id_downtime_reasons_id_fk" FOREIGN KEY ("reason_id") REFERENCES "public"."downtime_reasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "downtime_events" ADD CONSTRAINT "downtime_events_reported_by_users_id_fk" FOREIGN KEY ("reported_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_lines" ADD CONSTRAINT "job_lines_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_lines" ADD CONSTRAINT "job_lines_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_lines" ADD CONSTRAINT "job_lines_part_revision_id_part_revisions_id_fk" FOREIGN KEY ("part_revision_id") REFERENCES "public"."part_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_lines" ADD CONSTRAINT "job_lines_drawing_revision_id_document_revisions_id_fk" FOREIGN KEY ("drawing_revision_id") REFERENCES "public"."document_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_lines" ADD CONSTRAINT "job_lines_quotation_line_id_quotation_lines_id_fk" FOREIGN KEY ("quotation_line_id") REFERENCES "public"."quotation_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_lines" ADD CONSTRAINT "job_lines_route_released_by_users_id_fk" FOREIGN KEY ("route_released_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_customer_order_id_customer_orders_id_fk" FOREIGN KEY ("customer_order_id") REFERENCES "public"."customer_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_quotation_revision_id_quotation_revisions_id_fk" FOREIGN KEY ("quotation_revision_id") REFERENCES "public"."quotation_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_repeat_of_job_id_jobs_id_fk" FOREIGN KEY ("repeat_of_job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_delivery_address_id_addresses_id_fk" FOREIGN KEY ("delivery_address_id") REFERENCES "public"."addresses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_authorised_by_users_id_fk" FOREIGN KEY ("authorised_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_assignments" ADD CONSTRAINT "operation_assignments_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_assignments" ADD CONSTRAINT "operation_assignments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_assignments" ADD CONSTRAINT "operation_assignments_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_checks" ADD CONSTRAINT "operation_checks_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_checks" ADD CONSTRAINT "operation_checks_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_checks" ADD CONSTRAINT "operation_checks_material_lot_id_material_lots_id_fk" FOREIGN KEY ("material_lot_id") REFERENCES "public"."material_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_checks" ADD CONSTRAINT "operation_checks_program_revision_id_cnc_program_revisions_id_fk" FOREIGN KEY ("program_revision_id") REFERENCES "public"."cnc_program_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_checks" ADD CONSTRAINT "operation_checks_drawing_revision_id_document_revisions_id_fk" FOREIGN KEY ("drawing_revision_id") REFERENCES "public"."document_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_dependencies" ADD CONSTRAINT "operation_dependencies_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_dependencies" ADD CONSTRAINT "operation_dependencies_depends_on_id_operations_id_fk" FOREIGN KEY ("depends_on_id") REFERENCES "public"."operations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_documents" ADD CONSTRAINT "operation_documents_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_documents" ADD CONSTRAINT "operation_documents_document_revision_id_document_revisions_id_fk" FOREIGN KEY ("document_revision_id") REFERENCES "public"."document_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_documents" ADD CONSTRAINT "operation_documents_pinned_by_users_id_fk" FOREIGN KEY ("pinned_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_events" ADD CONSTRAINT "operation_events_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_events" ADD CONSTRAINT "operation_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_events" ADD CONSTRAINT "operation_events_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_events" ADD CONSTRAINT "operation_events_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_types" ADD CONSTRAINT "operation_types_default_competency_id_competencies_id_fk" FOREIGN KEY ("default_competency_id") REFERENCES "public"."competencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_job_line_id_job_lines_id_fk" FOREIGN KEY ("job_line_id") REFERENCES "public"."job_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_operation_type_id_operation_types_id_fk" FOREIGN KEY ("operation_type_id") REFERENCES "public"."operation_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_machine_group_id_machine_groups_id_fk" FOREIGN KEY ("machine_group_id") REFERENCES "public"."machine_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_required_competency_id_competencies_id_fk" FOREIGN KEY ("required_competency_id") REFERENCES "public"."competencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_program_revision_id_cnc_program_revisions_id_fk" FOREIGN KEY ("program_revision_id") REFERENCES "public"."cnc_program_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_drawing_revision_id_document_revisions_id_fk" FOREIGN KEY ("drawing_revision_id") REFERENCES "public"."document_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_inspection_plan_id_inspection_plans_id_fk" FOREIGN KEY ("inspection_plan_id") REFERENCES "public"."inspection_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_split_from_id_operations_id_fk" FOREIGN KEY ("split_from_id") REFERENCES "public"."operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_repeat_of_id_operations_id_fk" FOREIGN KEY ("repeat_of_id") REFERENCES "public"."operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_signed_off_by_users_id_fk" FOREIGN KEY ("signed_off_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_changes" ADD CONSTRAINT "schedule_changes_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_changes" ADD CONSTRAINT "schedule_changes_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serials" ADD CONSTRAINT "serials_job_line_id_job_lines_id_fk" FOREIGN KEY ("job_line_id") REFERENCES "public"."job_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serials" ADD CONSTRAINT "serials_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_program_revision_id_cnc_program_revisions_id_fk" FOREIGN KEY ("program_revision_id") REFERENCES "public"."cnc_program_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_material_lot_id_material_lots_id_fk" FOREIGN KEY ("material_lot_id") REFERENCES "public"."material_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_exceptions" ADD CONSTRAINT "calendar_exceptions_calendar_id_work_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."work_calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_shifts" ADD CONSTRAINT "calendar_shifts_calendar_id_work_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."work_calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competencies" ADD CONSTRAINT "competencies_operation_type_id_operation_types_id_fk" FOREIGN KEY ("operation_type_id") REFERENCES "public"."operation_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competencies" ADD CONSTRAINT "competencies_machine_type_id_machine_types_id_fk" FOREIGN KEY ("machine_type_id") REFERENCES "public"."machine_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competencies" ADD CONSTRAINT "competencies_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_competencies" ADD CONSTRAINT "employee_competencies_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_competencies" ADD CONSTRAINT "employee_competencies_competency_id_competencies_id_fk" FOREIGN KEY ("competency_id") REFERENCES "public"."competencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_competencies" ADD CONSTRAINT "employee_competencies_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_competencies" ADD CONSTRAINT "employee_competencies_evidence_file_id_files_id_fk" FOREIGN KEY ("evidence_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_supervisor_id_employees_id_fk" FOREIGN KEY ("supervisor_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_calendar_id_work_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."work_calendars"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine_capabilities" ADD CONSTRAINT "machine_capabilities_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine_capabilities" ADD CONSTRAINT "machine_capabilities_operation_type_id_operation_types_id_fk" FOREIGN KEY ("operation_type_id") REFERENCES "public"."operation_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine_status_events" ADD CONSTRAINT "machine_status_events_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine_status_events" ADD CONSTRAINT "machine_status_events_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine_status_events" ADD CONSTRAINT "machine_status_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machines" ADD CONSTRAINT "machines_machine_type_id_machine_types_id_fk" FOREIGN KEY ("machine_type_id") REFERENCES "public"."machine_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machines" ADD CONSTRAINT "machines_machine_group_id_machine_groups_id_fk" FOREIGN KEY ("machine_group_id") REFERENCES "public"."machine_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machines" ADD CONSTRAINT "machines_responsible_employee_id_employees_id_fk" FOREIGN KEY ("responsible_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machines" ADD CONSTRAINT "machines_calendar_id_work_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."work_calendars"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machines" ADD CONSTRAINT "machines_current_status_by_users_id_fk" FOREIGN KEY ("current_status_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plans_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plans_responsible_employee_id_employees_id_fk" FOREIGN KEY ("responsible_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plans_service_provider_id_suppliers_id_fk" FOREIGN KEY ("service_provider_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_work_orders" ADD CONSTRAINT "maintenance_work_orders_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_work_orders" ADD CONSTRAINT "maintenance_work_orders_plan_id_maintenance_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."maintenance_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_work_orders" ADD CONSTRAINT "maintenance_work_orders_reported_by_users_id_fk" FOREIGN KEY ("reported_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_work_orders" ADD CONSTRAINT "maintenance_work_orders_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_work_orders" ADD CONSTRAINT "maintenance_work_orders_service_provider_id_suppliers_id_fk" FOREIGN KEY ("service_provider_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_work_orders" ADD CONSTRAINT "maintenance_work_orders_report_file_id_files_id_fk" FOREIGN KEY ("report_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_tools" ADD CONSTRAINT "operation_tools_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_tools" ADD CONSTRAINT "operation_tools_tool_id_tools_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."tools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_events" ADD CONSTRAINT "tool_events_tool_id_tools_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."tools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_events" ADD CONSTRAINT "tool_events_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_events" ADD CONSTRAINT "tool_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_machines" ADD CONSTRAINT "tool_machines_tool_id_tools_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."tools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_machines" ADD CONSTRAINT "tool_machines_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tools" ADD CONSTRAINT "tools_boxhero_item_id_boxhero_items_id_fk" FOREIGN KEY ("boxhero_item_id") REFERENCES "public"."boxhero_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_records" ADD CONSTRAINT "training_records_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_records" ADD CONSTRAINT "training_records_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_records" ADD CONSTRAINT "training_records_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cnc_program_machines" ADD CONSTRAINT "cnc_program_machines_program_id_cnc_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."cnc_programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cnc_program_machines" ADD CONSTRAINT "cnc_program_machines_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cnc_program_revisions" ADD CONSTRAINT "cnc_program_revisions_program_id_cnc_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."cnc_programs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cnc_program_revisions" ADD CONSTRAINT "cnc_program_revisions_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cnc_program_revisions" ADD CONSTRAINT "cnc_program_revisions_programmer_id_users_id_fk" FOREIGN KEY ("programmer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cnc_program_revisions" ADD CONSTRAINT "cnc_program_revisions_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cnc_program_revisions" ADD CONSTRAINT "cnc_program_revisions_released_by_users_id_fk" FOREIGN KEY ("released_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cnc_program_revisions" ADD CONSTRAINT "cnc_program_revisions_rejected_by_users_id_fk" FOREIGN KEY ("rejected_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cnc_program_revisions" ADD CONSTRAINT "cnc_program_revisions_drawing_revision_id_document_revisions_id_fk" FOREIGN KEY ("drawing_revision_id") REFERENCES "public"."document_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cnc_program_revisions" ADD CONSTRAINT "cnc_program_revisions_setup_sheet_revision_id_document_revisions_id_fk" FOREIGN KEY ("setup_sheet_revision_id") REFERENCES "public"."document_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cnc_program_revisions" ADD CONSTRAINT "cnc_program_revisions_previous_revision_id_cnc_program_revisions_id_fk" FOREIGN KEY ("previous_revision_id") REFERENCES "public"."cnc_program_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cnc_programs" ADD CONSTRAINT "cnc_programs_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cnc_programs" ADD CONSTRAINT "cnc_programs_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cnc_programs" ADD CONSTRAINT "cnc_programs_operation_type_id_operation_types_id_fk" FOREIGN KEY ("operation_type_id") REFERENCES "public"."operation_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cnc_programs" ADD CONSTRAINT "cnc_programs_current_released_revision_id_cnc_program_revisions_id_fk" FOREIGN KEY ("current_released_revision_id") REFERENCES "public"."cnc_program_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cnc_programs" ADD CONSTRAINT "cnc_programs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_materials" ADD CONSTRAINT "batch_materials_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_materials" ADD CONSTRAINT "batch_materials_lot_id_material_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."material_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_allocations" ADD CONSTRAINT "material_allocations_lot_id_material_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."material_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_allocations" ADD CONSTRAINT "material_allocations_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_allocations" ADD CONSTRAINT "material_allocations_job_line_id_job_lines_id_fk" FOREIGN KEY ("job_line_id") REFERENCES "public"."job_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_allocations" ADD CONSTRAINT "material_allocations_allocated_by_users_id_fk" FOREIGN KEY ("allocated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_certificates" ADD CONSTRAINT "material_certificates_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_certificates" ADD CONSTRAINT "material_certificates_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_certificates" ADD CONSTRAINT "material_certificates_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_lot_certificates" ADD CONSTRAINT "material_lot_certificates_lot_id_material_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."material_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_lot_certificates" ADD CONSTRAINT "material_lot_certificates_certificate_id_material_certificates_id_fk" FOREIGN KEY ("certificate_id") REFERENCES "public"."material_certificates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_lots" ADD CONSTRAINT "material_lots_receipt_id_material_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."material_receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_lots" ADD CONSTRAINT "material_lots_purchase_order_line_id_purchase_order_lines_id_fk" FOREIGN KEY ("purchase_order_line_id") REFERENCES "public"."purchase_order_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_lots" ADD CONSTRAINT "material_lots_material_spec_id_material_specs_id_fk" FOREIGN KEY ("material_spec_id") REFERENCES "public"."material_specs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_lots" ADD CONSTRAINT "material_lots_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_lots" ADD CONSTRAINT "material_lots_inspected_by_users_id_fk" FOREIGN KEY ("inspected_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_lots" ADD CONSTRAINT "material_lots_released_by_users_id_fk" FOREIGN KEY ("released_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_lots" ADD CONSTRAINT "material_lots_release_approval_id_approvals_id_fk" FOREIGN KEY ("release_approval_id") REFERENCES "public"."approvals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_lots" ADD CONSTRAINT "material_lots_boxhero_item_id_boxhero_items_id_fk" FOREIGN KEY ("boxhero_item_id") REFERENCES "public"."boxhero_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_lots" ADD CONSTRAINT "material_lots_stock_in_sync_id_stock_sync_transactions_id_fk" FOREIGN KEY ("stock_in_sync_id") REFERENCES "public"."stock_sync_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_receipts" ADD CONSTRAINT "material_receipts_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_receipts" ADD CONSTRAINT "material_receipts_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_receipts" ADD CONSTRAINT "material_receipts_delivery_note_file_id_files_id_fk" FOREIGN KEY ("delivery_note_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_receipts" ADD CONSTRAINT "material_receipts_received_by_users_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_spec_items" ADD CONSTRAINT "material_spec_items_material_spec_id_material_specs_id_fk" FOREIGN KEY ("material_spec_id") REFERENCES "public"."material_specs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_spec_items" ADD CONSTRAINT "material_spec_items_boxhero_item_id_boxhero_items_id_fk" FOREIGN KEY ("boxhero_item_id") REFERENCES "public"."boxhero_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_spec_items" ADD CONSTRAINT "material_spec_items_linked_by_users_id_fk" FOREIGN KEY ("linked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_transactions" ADD CONSTRAINT "material_transactions_lot_id_material_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."material_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_transactions" ADD CONSTRAINT "material_transactions_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_transactions" ADD CONSTRAINT "material_transactions_job_line_id_job_lines_id_fk" FOREIGN KEY ("job_line_id") REFERENCES "public"."job_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_transactions" ADD CONSTRAINT "material_transactions_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_transactions" ADD CONSTRAINT "material_transactions_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_transactions" ADD CONSTRAINT "material_transactions_allocation_id_material_allocations_id_fk" FOREIGN KEY ("allocation_id") REFERENCES "public"."material_allocations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_transactions" ADD CONSTRAINT "material_transactions_stock_sync_id_stock_sync_transactions_id_fk" FOREIGN KEY ("stock_sync_id") REFERENCES "public"."stock_sync_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_transactions" ADD CONSTRAINT "material_transactions_approval_id_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approvals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_transactions" ADD CONSTRAINT "material_transactions_performed_by_users_id_fk" FOREIGN KEY ("performed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_transactions" ADD CONSTRAINT "material_transactions_reverses_id_material_transactions_id_fk" FOREIGN KEY ("reverses_id") REFERENCES "public"."material_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_material_spec_id_material_specs_id_fk" FOREIGN KEY ("material_spec_id") REFERENCES "public"."material_specs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_boxhero_item_id_boxhero_items_id_fk" FOREIGN KEY ("boxhero_item_id") REFERENCES "public"."boxhero_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_job_line_id_job_lines_id_fk" FOREIGN KEY ("job_line_id") REFERENCES "public"."job_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_material_spec_id_material_specs_id_fk" FOREIGN KEY ("material_spec_id") REFERENCES "public"."material_specs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_purchase_order_line_id_purchase_order_lines_id_fk" FOREIGN KEY ("purchase_order_line_id") REFERENCES "public"."purchase_order_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_sync_transactions" ADD CONSTRAINT "stock_sync_transactions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibration_records" ADD CONSTRAINT "calibration_records_instrument_id_measuring_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."measuring_instruments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibration_records" ADD CONSTRAINT "calibration_records_provider_id_suppliers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibration_records" ADD CONSTRAINT "calibration_records_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibration_records" ADD CONSTRAINT "calibration_records_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corrective_actions" ADD CONSTRAINT "corrective_actions_ncr_id_ncrs_id_fk" FOREIGN KEY ("ncr_id") REFERENCES "public"."ncrs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corrective_actions" ADD CONSTRAINT "corrective_actions_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corrective_actions" ADD CONSTRAINT "corrective_actions_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corrective_actions" ADD CONSTRAINT "corrective_actions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "final_release_items" ADD CONSTRAINT "final_release_items_release_id_final_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."final_releases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "final_release_items" ADD CONSTRAINT "final_release_items_checked_by_users_id_fk" FOREIGN KEY ("checked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "final_releases" ADD CONSTRAINT "final_releases_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "final_releases" ADD CONSTRAINT "final_releases_job_line_id_job_lines_id_fk" FOREIGN KEY ("job_line_id") REFERENCES "public"."job_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "final_releases" ADD CONSTRAINT "final_releases_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "final_releases" ADD CONSTRAINT "final_releases_approval_id_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approvals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "final_releases" ADD CONSTRAINT "final_releases_coc_file_id_files_id_fk" FOREIGN KEY ("coc_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "final_releases" ADD CONSTRAINT "final_releases_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holds" ADD CONSTRAINT "holds_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holds" ADD CONSTRAINT "holds_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holds" ADD CONSTRAINT "holds_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holds" ADD CONSTRAINT "holds_lot_id_material_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."material_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holds" ADD CONSTRAINT "holds_ncr_id_ncrs_id_fk" FOREIGN KEY ("ncr_id") REFERENCES "public"."ncrs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holds" ADD CONSTRAINT "holds_placed_by_users_id_fk" FOREIGN KEY ("placed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holds" ADD CONSTRAINT "holds_released_by_users_id_fk" FOREIGN KEY ("released_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_characteristics" ADD CONSTRAINT "inspection_characteristics_plan_id_inspection_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."inspection_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_evidence" ADD CONSTRAINT "inspection_evidence_inspection_id_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_evidence" ADD CONSTRAINT "inspection_evidence_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_plans" ADD CONSTRAINT "inspection_plans_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_plans" ADD CONSTRAINT "inspection_plans_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_plans" ADD CONSTRAINT "inspection_plans_material_spec_id_material_specs_id_fk" FOREIGN KEY ("material_spec_id") REFERENCES "public"."material_specs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_plans" ADD CONSTRAINT "inspection_plans_operation_type_id_operation_types_id_fk" FOREIGN KEY ("operation_type_id") REFERENCES "public"."operation_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_plans" ADD CONSTRAINT "inspection_plans_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_plans" ADD CONSTRAINT "inspection_plans_drawing_revision_id_document_revisions_id_fk" FOREIGN KEY ("drawing_revision_id") REFERENCES "public"."document_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_plans" ADD CONSTRAINT "inspection_plans_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_results" ADD CONSTRAINT "inspection_results_inspection_id_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_results" ADD CONSTRAINT "inspection_results_characteristic_id_inspection_characteristics_id_fk" FOREIGN KEY ("characteristic_id") REFERENCES "public"."inspection_characteristics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_results" ADD CONSTRAINT "inspection_results_serial_id_serials_id_fk" FOREIGN KEY ("serial_id") REFERENCES "public"."serials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_results" ADD CONSTRAINT "inspection_results_instrument_id_measuring_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."measuring_instruments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_results" ADD CONSTRAINT "inspection_results_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_plan_id_inspection_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."inspection_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_job_line_id_job_lines_id_fk" FOREIGN KEY ("job_line_id") REFERENCES "public"."job_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_serial_id_serials_id_fk" FOREIGN KEY ("serial_id") REFERENCES "public"."serials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_lot_id_material_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."material_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_drawing_revision_id_document_revisions_id_fk" FOREIGN KEY ("drawing_revision_id") REFERENCES "public"."document_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_program_revision_id_cnc_program_revisions_id_fk" FOREIGN KEY ("program_revision_id") REFERENCES "public"."cnc_program_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_setup_operator_id_employees_id_fk" FOREIGN KEY ("setup_operator_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_inspector_id_users_id_fk" FOREIGN KEY ("inspector_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_approval_id_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approvals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ncr_files" ADD CONSTRAINT "ncr_files_ncr_id_ncrs_id_fk" FOREIGN KEY ("ncr_id") REFERENCES "public"."ncrs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ncr_files" ADD CONSTRAINT "ncr_files_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ncrs" ADD CONSTRAINT "ncrs_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ncrs" ADD CONSTRAINT "ncrs_job_line_id_job_lines_id_fk" FOREIGN KEY ("job_line_id") REFERENCES "public"."job_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ncrs" ADD CONSTRAINT "ncrs_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ncrs" ADD CONSTRAINT "ncrs_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ncrs" ADD CONSTRAINT "ncrs_lot_id_material_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."material_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ncrs" ADD CONSTRAINT "ncrs_inspection_id_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ncrs" ADD CONSTRAINT "ncrs_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ncrs" ADD CONSTRAINT "ncrs_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ncrs" ADD CONSTRAINT "ncrs_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ncrs" ADD CONSTRAINT "ncrs_disposition_by_users_id_fk" FOREIGN KEY ("disposition_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ncrs" ADD CONSTRAINT "ncrs_disposition_approval_id_approvals_id_fk" FOREIGN KEY ("disposition_approval_id") REFERENCES "public"."approvals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ncrs" ADD CONSTRAINT "ncrs_raised_by_users_id_fk" FOREIGN KEY ("raised_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ncrs" ADD CONSTRAINT "ncrs_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ncrs" ADD CONSTRAINT "ncrs_reinspection_id_inspections_id_fk" FOREIGN KEY ("reinspection_id") REFERENCES "public"."inspections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ncrs" ADD CONSTRAINT "ncrs_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_lines" ADD CONSTRAINT "dispatch_lines_dispatch_id_dispatches_id_fk" FOREIGN KEY ("dispatch_id") REFERENCES "public"."dispatches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_lines" ADD CONSTRAINT "dispatch_lines_job_line_id_job_lines_id_fk" FOREIGN KEY ("job_line_id") REFERENCES "public"."job_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_lines" ADD CONSTRAINT "dispatch_lines_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_serials" ADD CONSTRAINT "dispatch_serials_dispatch_line_id_dispatch_lines_id_fk" FOREIGN KEY ("dispatch_line_id") REFERENCES "public"."dispatch_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_serials" ADD CONSTRAINT "dispatch_serials_serial_id_serials_id_fk" FOREIGN KEY ("serial_id") REFERENCES "public"."serials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_customer_order_id_customer_orders_id_fk" FOREIGN KEY ("customer_order_id") REFERENCES "public"."customer_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_delivery_address_id_addresses_id_fk" FOREIGN KEY ("delivery_address_id") REFERENCES "public"."addresses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_dispatched_by_users_id_fk" FOREIGN KEY ("dispatched_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_proof_of_delivery_file_id_files_id_fk" FOREIGN KEY ("proof_of_delivery_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_delivery_note_file_id_files_id_fk" FOREIGN KEY ("delivery_note_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontract_files" ADD CONSTRAINT "subcontract_files_subcontract_order_id_subcontract_orders_id_fk" FOREIGN KEY ("subcontract_order_id") REFERENCES "public"."subcontract_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontract_files" ADD CONSTRAINT "subcontract_files_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontract_orders" ADD CONSTRAINT "subcontract_orders_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontract_orders" ADD CONSTRAINT "subcontract_orders_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontract_orders" ADD CONSTRAINT "subcontract_orders_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontract_orders" ADD CONSTRAINT "subcontract_orders_job_line_id_job_lines_id_fk" FOREIGN KEY ("job_line_id") REFERENCES "public"."job_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontract_orders" ADD CONSTRAINT "subcontract_orders_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontract_orders" ADD CONSTRAINT "subcontract_orders_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontract_orders" ADD CONSTRAINT "subcontract_orders_dispatched_by_users_id_fk" FOREIGN KEY ("dispatched_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontract_orders" ADD CONSTRAINT "subcontract_orders_received_by_users_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontract_orders" ADD CONSTRAINT "subcontract_orders_incoming_inspection_id_inspections_id_fk" FOREIGN KEY ("incoming_inspection_id") REFERENCES "public"."inspections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontract_orders" ADD CONSTRAINT "subcontract_orders_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontract_orders" ADD CONSTRAINT "subcontract_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approvals_entity_idx" ON "approvals" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_job_idx" ON "audit_events" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "audit_user_idx" ON "audit_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_time_idx" ON "audit_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "email_outbox_idem_uq" ON "email_outbox" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "file_access_file_idx" ON "file_access_log" USING btree ("file_id");--> statement-breakpoint
CREATE UNIQUE INDEX "files_key_uq" ON "files" USING btree ("storage","storage_key");--> statement-breakpoint
CREATE INDEX "gate_exc_op_idx" ON "gate_exceptions" USING btree ("operation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gate_exc_ref_uq" ON "gate_exceptions" USING btree ("ref");--> statement-breakpoint
CREATE INDEX "integ_events_idx" ON "integration_events" USING btree ("integration","at");--> statement-breakpoint
CREATE INDEX "notif_user_idx" ON "notifications" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notif_dedupe_uq" ON "notifications" USING btree ("user_id","dedupe_key");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_key_uq" ON "roles" USING btree ("key");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "status_tr_uq" ON "status_transitions" USING btree ("entity_type","from_status","to_status");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "addr_cust_idx" ON "addresses" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "contacts_cust_idx" ON "contacts" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "contacts_supp_idx" ON "contacts" USING btree ("supplier_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_code_uq" ON "customers" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_code_uq" ON "suppliers" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "cdoc_number_uq" ON "controlled_documents" USING btree ("doc_number");--> statement-breakpoint
CREATE INDEX "cdoc_part_idx" ON "controlled_documents" USING btree ("part_id");--> statement-breakpoint
CREATE UNIQUE INDEX "docrev_doc_rev_uq" ON "document_revisions" USING btree ("document_id","revision");--> statement-breakpoint
CREATE INDEX "docrev_status_idx" ON "document_revisions" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "partrev_uq" ON "part_revisions" USING btree ("part_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "parts_cust_pn_uq" ON "parts" USING btree ("customer_id","part_number");--> statement-breakpoint
CREATE UNIQUE INDEX "co_ref_uq" ON "customer_orders" USING btree ("ref");--> statement-breakpoint
CREATE UNIQUE INDEX "co_cust_po_uq" ON "customer_orders" USING btree ("customer_id","customer_po_number");--> statement-breakpoint
CREATE UNIQUE INDEX "enq_ref_uq" ON "enquiries" USING btree ("ref");--> statement-breakpoint
CREATE INDEX "enq_cust_idx" ON "enquiries" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "enq_status_idx" ON "enquiries" USING btree ("status");--> statement-breakpoint
CREATE INDEX "enq_att_enq_idx" ON "enquiry_attachments" USING btree ("enquiry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inbound_provider_msg_uq" ON "inbound_emails" USING btree ("provider","provider_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "quorev_uq" ON "quotation_revisions" USING btree ("quotation_id","revision_no");--> statement-breakpoint
CREATE UNIQUE INDEX "quo_ref_uq" ON "quotations" USING btree ("ref");--> statement-breakpoint
CREATE INDEX "quo_cust_idx" ON "quotations" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "batch_no_uq" ON "batches" USING btree ("batch_no");--> statement-breakpoint
CREATE INDEX "downtime_machine_idx" ON "downtime_events" USING btree ("machine_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "jobline_uq" ON "job_lines" USING btree ("job_id","line_no");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_number_uq" ON "jobs" USING btree ("job_number");--> statement-breakpoint
CREATE INDEX "jobs_status_idx" ON "jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "jobs_cust_idx" ON "jobs" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "opassign_op_idx" ON "operation_assignments" USING btree ("operation_id");--> statement-breakpoint
CREATE INDEX "opassign_emp_idx" ON "operation_assignments" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "opcheck_op_idx" ON "operation_checks" USING btree ("operation_id");--> statement-breakpoint
CREATE INDEX "opevent_op_idx" ON "operation_events" USING btree ("operation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "optype_code_uq" ON "operation_types" USING btree ("code");--> statement-breakpoint
CREATE INDEX "ops_job_idx" ON "operations" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "ops_line_idx" ON "operations" USING btree ("job_line_id","sequence");--> statement-breakpoint
CREATE INDEX "ops_machine_idx" ON "operations" USING btree ("machine_id","planned_start");--> statement-breakpoint
CREATE INDEX "ops_status_idx" ON "operations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sched_op_idx" ON "schedule_changes" USING btree ("operation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "serial_no_uq" ON "serials" USING btree ("serial_no");--> statement-breakpoint
CREATE INDEX "time_op_idx" ON "time_entries" USING btree ("operation_id");--> statement-breakpoint
CREATE INDEX "time_emp_idx" ON "time_entries" USING btree ("employee_id","started_at");--> statement-breakpoint
CREATE INDEX "time_machine_idx" ON "time_entries" USING btree ("machine_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "comp_code_uq" ON "competencies" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "dtreason_code_uq" ON "downtime_reasons" USING btree ("code");--> statement-breakpoint
CREATE INDEX "empcomp_emp_idx" ON "employee_competencies" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "emp_no_uq" ON "employees" USING btree ("employee_no");--> statement-breakpoint
CREATE UNIQUE INDEX "mgroup_code_uq" ON "machine_groups" USING btree ("code");--> statement-breakpoint
CREATE INDEX "mstatus_machine_idx" ON "machine_status_events" USING btree ("machine_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "mtype_code_uq" ON "machine_types" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "machines_code_uq" ON "machines" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "mwo_ref_uq" ON "maintenance_work_orders" USING btree ("ref");--> statement-breakpoint
CREATE INDEX "mwo_machine_idx" ON "maintenance_work_orders" USING btree ("machine_id");--> statement-breakpoint
CREATE INDEX "toolev_tool_idx" ON "tool_events" USING btree ("tool_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tools_asset_uq" ON "tools" USING btree ("asset_no");--> statement-breakpoint
CREATE UNIQUE INDEX "progrev_uq" ON "cnc_program_revisions" USING btree ("program_id","revision");--> statement-breakpoint
CREATE INDEX "progrev_status_idx" ON "cnc_program_revisions" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "prog_number_uq" ON "cnc_programs" USING btree ("program_number");--> statement-breakpoint
CREATE UNIQUE INDEX "bh_item_uq" ON "boxhero_items" USING btree ("boxhero_item_id");--> statement-breakpoint
CREATE INDEX "bh_item_sku_idx" ON "boxhero_items" USING btree ("sku");--> statement-breakpoint
CREATE UNIQUE INDEX "bh_loc_uq" ON "boxhero_locations" USING btree ("boxhero_location_id");--> statement-breakpoint
CREATE INDEX "alloc_lot_idx" ON "material_allocations" USING btree ("lot_id");--> statement-breakpoint
CREATE INDEX "alloc_job_idx" ON "material_allocations" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "cert_heat_idx" ON "material_certificates" USING btree ("heat_number");--> statement-breakpoint
CREATE UNIQUE INDEX "lot_no_uq" ON "material_lots" USING btree ("lot_no");--> statement-breakpoint
CREATE INDEX "lot_heat_idx" ON "material_lots" USING btree ("heat_number");--> statement-breakpoint
CREATE INDEX "lot_status_idx" ON "material_lots" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "grn_ref_uq" ON "material_receipts" USING btree ("ref");--> statement-breakpoint
CREATE UNIQUE INDEX "matspec_code_uq" ON "material_specs" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "mattx_ref_uq" ON "material_transactions" USING btree ("ref");--> statement-breakpoint
CREATE UNIQUE INDEX "mattx_idem_uq" ON "material_transactions" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "mattx_lot_idx" ON "material_transactions" USING btree ("lot_id");--> statement-breakpoint
CREATE INDEX "mattx_job_idx" ON "material_transactions" USING btree ("job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pol_uq" ON "purchase_order_lines" USING btree ("purchase_order_id","line_no");--> statement-breakpoint
CREATE UNIQUE INDEX "po_ref_uq" ON "purchase_orders" USING btree ("ref");--> statement-breakpoint
CREATE INDEX "po_supplier_idx" ON "purchase_orders" USING btree ("supplier_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pr_ref_uq" ON "purchase_requisitions" USING btree ("ref");--> statement-breakpoint
CREATE UNIQUE INDEX "stocksync_idem_uq" ON "stock_sync_transactions" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "stocksync_status_idx" ON "stock_sync_transactions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "calrec_instr_idx" ON "calibration_records" USING btree ("instrument_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ca_ref_uq" ON "corrective_actions" USING btree ("ref");--> statement-breakpoint
CREATE INDEX "frel_job_idx" ON "final_releases" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "holds_job_idx" ON "holds" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "holds_op_idx" ON "holds" USING btree ("operation_id");--> statement-breakpoint
CREATE INDEX "holds_lot_idx" ON "holds" USING btree ("lot_id");--> statement-breakpoint
CREATE INDEX "ichar_plan_idx" ON "inspection_characteristics" USING btree ("plan_id");--> statement-breakpoint
CREATE UNIQUE INDEX "iplan_code_ver_uq" ON "inspection_plans" USING btree ("code","version");--> statement-breakpoint
CREATE INDEX "iresult_insp_idx" ON "inspection_results" USING btree ("inspection_id");--> statement-breakpoint
CREATE INDEX "iresult_instr_idx" ON "inspection_results" USING btree ("instrument_id");--> statement-breakpoint
CREATE UNIQUE INDEX "insp_ref_uq" ON "inspections" USING btree ("ref");--> statement-breakpoint
CREATE INDEX "insp_op_idx" ON "inspections" USING btree ("operation_id");--> statement-breakpoint
CREATE INDEX "insp_job_idx" ON "inspections" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "insp_lot_idx" ON "inspections" USING btree ("lot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "instr_asset_uq" ON "measuring_instruments" USING btree ("asset_no");--> statement-breakpoint
CREATE UNIQUE INDEX "ncr_ref_uq" ON "ncrs" USING btree ("ref");--> statement-breakpoint
CREATE INDEX "ncr_job_idx" ON "ncrs" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "ncr_status_idx" ON "ncrs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "dsp_ref_uq" ON "dispatches" USING btree ("ref");--> statement-breakpoint
CREATE INDEX "dsp_job_idx" ON "dispatches" USING btree ("job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sco_ref_uq" ON "subcontract_orders" USING btree ("ref");--> statement-breakpoint
CREATE INDEX "sco_job_idx" ON "subcontract_orders" USING btree ("job_id");