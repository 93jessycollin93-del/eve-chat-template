import type { LucideIcon } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

type Variant = "primary" | "soft" | "ghost" | "danger" | "solid-danger";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-black font-semibold hover:brightness-110",
  soft: "bg-accent/15 text-accent border border-accent/25 hover:bg-accent/25",
  ghost: "bg-white/[0.06] border border-white/10 hover:bg-white/[0.1] text-white/90",
  danger: "bg-danger/10 text-red-300 border border-danger/25 hover:bg-danger/20",
  "solid-danger": "bg-danger text-black font-semibold hover:brightness-110",
};

export function Btn({
  variant = "ghost",
  icon: Icon,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; icon?: LucideIcon }) {
  return (
    <button
      type="button"
      {...rest}
      className={cx(
        "mono inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-[8px] px-3 text-[11px] transition disabled:cursor-not-allowed disabled:opacity-40",
        VARIANTS[variant],
        className,
      )}
    >
      {Icon && <Icon size={12} aria-hidden />}
      {children}
    </button>
  );
}

/** Small label naming the real mechanism behind a feature (e.g. "IndexedDB"). */
export function SourceChip({ children, tone = "accent" }: { children: ReactNode; tone?: "accent" | "muted" | "warn" | "danger" }) {
  const tones = {
    accent: "bg-accent/12 text-accent border-accent/25",
    muted: "bg-white/[0.06] text-white/60 border-white/10",
    warn: "bg-gold/12 text-gold border-gold/25",
    danger: "bg-danger/12 text-red-300 border-danger/30",
  };
  return <span className={cx("mono rounded border px-1.5 py-0.5 text-[9px] whitespace-nowrap", tones[tone])}>{children}</span>;
}

export function ProgramHeader({
  icon: Icon,
  color,
  title,
  chip,
  children,
}: {
  icon: LucideIcon;
  color: string;
  title: string;
  chip?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="mono flex min-w-0 items-center gap-2 text-[11px] font-semibold tracking-wide">
        <Icon size={13} color={color} aria-hidden />
        <span className="truncate">{title}</span>
      </div>
      <div className="flex items-center gap-1.5">
        {children}
        {chip}
      </div>
    </div>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx("rounded-[12px] border border-white/10 bg-white/[0.04] p-3", className)}>{children}</div>;
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mono min-w-0 rounded-[10px] border border-white/10 bg-black/50 p-2.5">
      <div className="text-[9px] tracking-wide text-white/50 uppercase">{label}</div>
      <div className="mt-1 truncate text-[14px] font-semibold">{value}</div>
      {hint && <div className="mt-1 text-[9px] text-white/40">{hint}</div>}
    </div>
  );
}

export function Notice({ tone = "accent", children }: { tone?: "accent" | "warn" | "danger" | "muted"; children: ReactNode }) {
  const tones = {
    accent: "bg-accent/10 border-accent/25 text-accent",
    warn: "bg-gold/10 border-gold/25 text-gold",
    danger: "bg-danger/10 border-danger/30 text-red-300",
    muted: "bg-white/[0.04] border-white/10 text-white/60",
  };
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cx("mono rounded-[10px] border px-2.5 py-1.5 text-[10px] leading-4 whitespace-pre-wrap", tones[tone])}>
      {children}
    </div>
  );
}

export const inputClass =
  "mono h-8 rounded-[8px] border border-white/10 bg-black px-2.5 text-[12px] text-white outline-none focus:border-accent/50 placeholder:text-white/30";

export function Spinner({ label = "Working…" }: { label?: string }) {
  return (
    <span className="mono inline-flex items-center gap-2 text-[11px] text-white/60">
      <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/20 border-t-accent" aria-hidden />
      {label}
    </span>
  );
}
