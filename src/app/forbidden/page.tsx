import Link from "next/link";

export const metadata = { title: "Access denied" };

export default function Forbidden() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-paper p-6">
      <div className="max-w-md border border-ink/80 bg-sheet">
        <div className="border-b border-ink/80 px-5 py-3">
          <div className="text-[11px] text-steel">Error 403</div>
          <h1 className="plate text-[28px] leading-none">Access denied</h1>
        </div>
        <div className="px-5 py-4 text-[13.5px] text-ink-2">
          <p>Your account doesn&apos;t have permission to open this page. If you need access, ask your system administrator to add the right role.</p>
          <p className="mt-3">
            <Link href="/" className="link">
              Go to your dashboard
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
