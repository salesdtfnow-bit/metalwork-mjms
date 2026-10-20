import Link from "next/link";
import { requirePageCtx } from "@/server/auth/next";
import { aiConfigured } from "@/server/ai/claude";
import { Notice, PageHeader, Panel } from "@/components/ui";
import { ActionForm, FileField } from "@/components/forms";
import { readPoAction } from "../actions";

export const metadata = { title: "Create order from a PO file" };
/** Reading a PO with the assistant can take up to a minute for long documents. */
export const maxDuration = 120;

export default async function ImportPoPage() {
  await requirePageCtx("orders.manage");
  return (
    <>
      <PageHeader
        title="Create order from a PO file"
        description={
          <>
            Upload the customer&apos;s purchase order. The assistant reads it and fills in the order for you to check — nothing is saved until you confirm.{" "}
            <Link href="/orders/new" className="link">
              Enter it manually instead
            </Link>
          </>
        }
      />
      {!aiConfigured() ? (
        <Notice tone="warning" title="The document assistant is not set up">
          An administrator needs to add an Anthropic API key (ANTHROPIC_API_KEY) in the hosting settings. Until then, register POs manually.
        </Notice>
      ) : (
        <Panel className="max-w-2xl p-4">
          <ActionForm action={readPoAction} submitLabel="Read PO" submitSize="lg">
            <FileField label="Customer PO" name="poFile" required accept=".pdf,image/png,image/jpeg,image/webp" hint="PDF, or a photo/scan (PNG, JPEG). Up to 4 MB. The file is kept unaltered as the customer original." />
            <p className="text-[12.5px] text-steel">
              Reading usually takes 10–40 seconds. The assistant can misread scans or unusual layouts, so check every part number, quantity, price and date on the next screen.
            </p>
          </ActionForm>
        </Panel>
      )}
    </>
  );
}
