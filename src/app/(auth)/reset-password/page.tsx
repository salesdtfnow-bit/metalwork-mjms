import { ActionForm, TextField } from "@/components/forms";
import { Notice } from "@/components/ui";
import { resetPasswordAction } from "../actions";

export const metadata = { title: "Choose a new password" };

export default async function ResetPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <>
      <h1 className="plate text-[30px] leading-none text-ink">Choose a new password</h1>
      <p className="mb-6 mt-2 text-steel">At least 10 characters. A short phrase is easier to remember than a complex word.</p>
      {!token ? (
        <Notice tone="danger">This link is incomplete. Request a new reset link.</Notice>
      ) : (
        <ActionForm action={resetPasswordAction} submitLabel="Set new password" submitSize="lg">
          <input type="hidden" name="token" value={token} />
          <TextField label="New password" name="password" type="password" autoComplete="new-password" required />
          <TextField label="Confirm new password" name="confirm" type="password" autoComplete="new-password" required />
        </ActionForm>
      )}
    </>
  );
}
