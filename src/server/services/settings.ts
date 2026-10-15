import { eq } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "../db/client";
import { companySettings } from "../db/schema";
import { audit } from "../audit";
import { mutate, requirePermission, type Ctx } from "../context";

export type CompanySettings = typeof companySettings.$inferSelect;

export async function getSettings(db: DB): Promise<CompanySettings> {
  const [s] = await db.select().from(companySettings).where(eq(companySettings.id, 1)).limit(1);
  if (s) return s;
  const [created] = await db.insert(companySettings).values({ id: 1 }).onConflictDoNothing().returning();
  return created ?? (await db.select().from(companySettings).where(eq(companySettings.id, 1)))[0];
}

export const settingsInput = z.object({
  companyName: z.string().trim().min(1),
  addressLines: z.string().default(""),
  phone: z.string().nullish(),
  email: z.string().nullish(),
  website: z.string().nullish(),
  vatNumber: z.string().nullish(),
  companyNumber: z.string().nullish(),
  timezone: z.string().refine((tz) => {
    try {
      new Intl.DateTimeFormat("en-GB", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, "Unknown timezone."),
  currency: z.string().length(3),
  defaultTaxRate: z.string().regex(/^\d+(\.\d+)?$/),
  quoteValidityDays: z.number().int().min(1).max(365),
  defaultQuoteTerms: z.string().default(""),
  retentionYears: z.number().int().min(1).max(100),
  allowSelfInspection: z.boolean(),
  requireIndependentApproval: z.boolean(),
  boxheroMode: z.enum(["simulated", "api", "manual"]),
});

export async function updateSettings(ctx: Ctx, input: z.input<typeof settingsInput>) {
  requirePermission(ctx, "admin.settings");
  const data = settingsInput.parse(input);
  return mutate(ctx, async (tx) => {
    const before = await getSettings(tx.db);
    await tx.db.update(companySettings).set(data).where(eq(companySettings.id, 1));
    await audit(tx, { action: "settings.update", entityType: "company_settings", entityId: "1", before, after: data });
  });
}
