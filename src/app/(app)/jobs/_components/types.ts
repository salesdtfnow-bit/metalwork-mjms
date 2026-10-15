import type { Ctx } from "@/server/context";
import type { getJob } from "@/server/services/jobs";

export type JobData = Awaited<ReturnType<typeof getJob>>;
export type TabProps = { ctx: Ctx; data: JobData };
export const TERMINAL_JOB = ["completed", "cancelled"];
