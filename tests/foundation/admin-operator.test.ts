import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { setupDb, makeUser } from "../helpers/db";
import { loadActor } from "@/server/auth/session";
import { createEmployeeForUser } from "@/server/services/users";
import { myWork } from "@/server/services/production";
import { visibleNav } from "@/lib/nav";
import { employees } from "@/server/db/schema";
import { AppError } from "@/server/errors";

describe("administrator who also works on the shop floor", () => {
  it("sees My work, and gets a working My work once an employee record is created and linked", async () => {
    const db = await setupDb();
    const admin = await makeUser(db, ["admin"], { name: "Workshop Owner", employee: false });

    const nav = visibleNav(admin.actor.permissions).flatMap((g) => g.items.map((i) => i.href));
    expect(nav).toContain("/shopfloor");

    // Not linked yet: My work explains rather than showing assignments.
    await expect(myWork(admin.ctx)).rejects.toMatchObject({ code: "forbidden" });

    const e = await createEmployeeForUser(admin.ctx, admin.userId, { employeeNo: "E001", firstName: "Workshop", lastName: "Owner", jobTitle: "Director / machinist" });
    const [row] = await db.select().from(employees).where(eq(employees.id, e.id));
    expect(row.email).toBe(admin.email);

    const actor = (await loadActor(db, admin.userId))!;
    expect(actor.employeeId).toBe(e.id);
    expect(actor.roles).toEqual(["admin"]);
    const work = await myWork({ db, actor });
    expect(work.employee?.employeeNo).toBe("E001");

    await expect(createEmployeeForUser({ db, actor }, admin.userId, { employeeNo: "E002", firstName: "A", lastName: "B" })).rejects.toThrow(/already linked/);
  });

  it("is refused for users without user administration and employee management", async () => {
    const db = await setupDb();
    const planner = await makeUser(db, ["production_manager"]);
    const target = await makeUser(db, ["operator"], { employee: false });
    await expect(createEmployeeForUser(planner.ctx, target.userId, { employeeNo: "E009", firstName: "X", lastName: "Y" })).rejects.toBeInstanceOf(AppError);
  });
});
