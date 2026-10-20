CREATE TABLE "quote_acceptance_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"revision_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"view_until" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"responded_at" timestamp with time zone,
	"last_viewed_at" timestamp with time zone,
	"view_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "quotation_revisions" ADD COLUMN "acceptance_channel" text;--> statement-breakpoint
ALTER TABLE "quotation_revisions" ADD COLUMN "accepted_by_name" text;--> statement-breakpoint
ALTER TABLE "quotation_revisions" ADD COLUMN "accepted_by_position" text;--> statement-breakpoint
ALTER TABLE "quotation_revisions" ADD COLUMN "accepted_by_email" text;--> statement-breakpoint
ALTER TABLE "quotation_revisions" ADD COLUMN "acceptance_ip" text;--> statement-breakpoint
ALTER TABLE "quotation_revisions" ADD COLUMN "acceptance_user_agent" text;--> statement-breakpoint
ALTER TABLE "quotation_revisions" ADD COLUMN "accepted_pdf_sha256" text;--> statement-breakpoint
ALTER TABLE "quotation_revisions" ADD COLUMN "acceptance_confirmation_file_id" uuid;--> statement-breakpoint
ALTER TABLE "quote_acceptance_links" ADD CONSTRAINT "quote_acceptance_links_revision_id_quotation_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."quotation_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_acceptance_links" ADD CONSTRAINT "quote_acceptance_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "qal_token_uq" ON "quote_acceptance_links" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "qal_rev_idx" ON "quote_acceptance_links" USING btree ("revision_id");--> statement-breakpoint
ALTER TABLE "quotation_revisions" ADD CONSTRAINT "quotation_revisions_acceptance_confirmation_file_id_files_id_fk" FOREIGN KEY ("acceptance_confirmation_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;