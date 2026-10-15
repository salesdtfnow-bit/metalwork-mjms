import { redirect } from "next/navigation";
import { getActor } from "@/server/auth/next";
import { ActionForm, TextField } from "@/components/forms";
import { changePasswordAction } from "../actions";

export const metadata = { title: "Change password" };

export default async function ChangePasswordPage() {
  if (!(await getActor())) redirect("/login");
  return (
    <>
      <h1 className="plate text-[30px] leading-none text-ink">Change password</h1>
      <p className="mb-6 mt-2 text-steel">Set a personal password before continuing. You&apos;ll be asked to sign in again afterwards.</p>
      <ActionForm action={changePasswordAction} submitLabel="Change password" submitSize="lg">
        <TextField label="Current password" name="current" type="password" autoComplete="current-password" required />
        <TextField label="New password" name="password" type="password" autoComplete="new-password" required hint="At least 10 characters." />
        <TextField label="Confirm new password" name="confirm" type="password" autoComplete="new-password" required />
      </ActionForm>
    </>
  );
}
