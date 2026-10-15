import Link from "next/link";
import { redirect } from "next/navigation";
import { getActor } from "@/server/auth/next";
import { ActionForm, TextField } from "@/components/forms";
import { Notice } from "@/components/ui";
import { loginAction } from "../actions";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (await getActor()) redirect("/");
  const sp = await searchParams;
  return (
    <>
      <h1 className="plate text-[30px] leading-none text-ink">Sign in</h1>
      <p className="mb-6 mt-2 text-steel">Use your workshop account. Shop-floor terminals sign out automatically after a period of inactivity.</p>
      {sp.reset && <Notice tone="success">Password changed. Sign in with your new password.</Notice>}
      {sp.changed && <Notice tone="success">Password updated. Sign in again.</Notice>}
      <ActionForm action={loginAction} submitLabel="Sign in" submitSize="lg">
        <input type="hidden" name="next" value={sp.next ?? "/"} />
        <TextField label="Email" name="email" type="email" autoComplete="username" required autoFocus />
        <TextField label="Password" name="password" type="password" autoComplete="current-password" required />
      </ActionForm>
      <p className="mt-5 text-[13px]">
        <Link href="/forgot-password" className="link">
          Forgotten your password?
        </Link>
      </p>
    </>
  );
}
