import type { DemoCtx } from "./seed";

type Rec = { id: string };

/**
 * Demo data for later modules (machines, materials, jobs …). Extended phase by phase —
 * each phase adds its section here using the real services.
 */
export async function seedDemoOperations(
  _demo: DemoCtx,
  _refs: { customers: Record<string, Rec>; suppliers: Record<string, Rec> },
): Promise<Record<string, number>> {
  return {};
}
