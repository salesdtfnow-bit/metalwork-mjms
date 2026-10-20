CREATE TABLE "ai_extractions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"source_file_ids" uuid[] NOT NULL,
	"model" text NOT NULL,
	"result" jsonb NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"customer_order_id" uuid,
	"quotation_id" uuid
);
--> statement-breakpoint
ALTER TABLE "ai_extractions" ADD CONSTRAINT "ai_extractions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_extractions" ADD CONSTRAINT "ai_extractions_customer_order_id_customer_orders_id_fk" FOREIGN KEY ("customer_order_id") REFERENCES "public"."customer_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_extractions" ADD CONSTRAINT "ai_extractions_quotation_id_quotations_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."quotations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "aix_created_idx" ON "ai_extractions" USING btree ("created_at");