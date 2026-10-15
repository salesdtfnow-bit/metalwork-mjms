import { numeric, timestamp, uuid } from "drizzle-orm/pg-core";

/** UUID primary key (gen_random_uuid()). */
export const pk = () => uuid().primaryKey().defaultRandom();

/** timestamptz stored in UTC; displayed in the company timezone. */
export const ts = () => timestamp({ withTimezone: true, mode: "date" });

export const createdAt = () => ts().notNull().defaultNow();
export const updatedAt = () =>
  ts()
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

/** Quantities: up to 10 integer digits, 4 decimals (mm, kg, pcs). Returned as string — use decimal.js. */
export const qty = () => numeric({ precision: 14, scale: 4 });
/** Money totals: 2 decimals. */
export const money = () => numeric({ precision: 14, scale: 2 });
/** Unit costs / rates: 4 decimals. */
export const rate = () => numeric({ precision: 14, scale: 4 });
/** Measurement values for inspection (6 decimals for µm on mm units). */
export const measure = () => numeric({ precision: 18, scale: 6 });
