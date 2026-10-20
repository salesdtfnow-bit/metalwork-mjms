CREATE TABLE "customer_order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"part_number" text NOT NULL,
	"description" text NOT NULL,
	"drawing_revision" text,
	"material_spec" text,
	"quantity" numeric(14, 4) NOT NULL,
	"unit_price" numeric(14, 4),
	"line_total" numeric(14, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "quote_approval_mode" text DEFAULT 'single_step' NOT NULL;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "quote_acceptance_mode" text DEFAULT 'single_step' NOT NULL;--> statement-breakpoint
ALTER TABLE "job_lines" ADD COLUMN "customer_order_line_id" uuid;--> statement-breakpoint
ALTER TABLE "customer_order_lines" ADD CONSTRAINT "customer_order_lines_order_id_customer_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."customer_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "col_order_line_uq" ON "customer_order_lines" USING btree ("order_id","line_no");--> statement-breakpoint
ALTER TABLE "job_lines" ADD CONSTRAINT "job_lines_customer_order_line_id_customer_order_lines_id_fk" FOREIGN KEY ("customer_order_line_id") REFERENCES "public"."customer_order_lines"("id") ON DELETE no action ON UPDATE no action;