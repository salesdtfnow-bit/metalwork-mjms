import Link from "next/link";
import { ActionForm, TextField } from "@/components/forms";
import { requestResetAction } from "../actions";

export const metadata = { title: "Reset password" };

export default function ForgotPage() {
  return (
    <>
      <h1 className="plate text-[30px] leading-none text-ink">Reset password</h1>
      <p className="mb-6 mt-2 text-steel">Enter your account email. We&apos;ll send a link that lets you choose a new password.</p>
      <ActionForm action={requestResetAction} submitLabel="Send reset link" submitSize="lg">
        <TextField label="Email" name="email" type="email" autoComplete="username" required />
      </ActionForm>
      <p className="mt-5 text-[13px]">
        <Link href="/login" className="link">
          Back to sign in
        </Link>
      </p>
    </>
  );
}
