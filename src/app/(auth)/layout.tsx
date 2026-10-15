export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_minmax(420px,520px)]">
      <div className="relative hidden overflow-hidden bg-ink lg:block" aria-hidden>
        {/* Drawing-sheet grid with a title-block corner, as on an engineering drawing */}
        <div className="absolute inset-0 [background-image:linear-gradient(#ffffff0d_1px,transparent_1px),linear-gradient(90deg,#ffffff0d_1px,transparent_1px)] [background-size:28px_28px]" />
        <svg className="absolute left-1/2 top-1/2 w-[62%] -translate-x-1/2 -translate-y-1/2 opacity-80" viewBox="0 0 400 260" fill="none" stroke="#6f97de" strokeWidth="1.2">
          <rect x="40" y="70" width="320" height="120" />
          <circle cx="120" cy="130" r="34" />
          <circle cx="120" cy="130" r="14" />
          <circle cx="280" cy="130" r="22" />
          <path d="M40 130 H360" strokeDasharray="10 4 2 4" stroke="#8a97a6" />
          <path d="M120 60 V200 M280 60 V200" strokeDasharray="10 4 2 4" stroke="#8a97a6" />
          <path d="M40 215 H360 M40 210 V220 M360 210 V220" stroke="#c9d2dc" />
          <text x="200" y="232" fill="#c9d2dc" stroke="none" fontSize="11" textAnchor="middle" fontFamily="sans-serif">320.00 ±0.05</text>
        </svg>
        <div className="absolute bottom-0 right-0 border-l border-t border-[#ffffff33] bg-ink/80 px-5 py-3 text-[#c9d2dc]">
          <div className="text-[11px] text-[#8a97a6]">Manufacturing Job Management System</div>
          <div className="plate text-[28px] leading-none text-white">MJMS</div>
        </div>
      </div>
      <div className="flex items-center justify-center bg-paper px-6 py-12">
        <div className="w-full max-w-[380px]">{children}</div>
      </div>
    </div>
  );
}
