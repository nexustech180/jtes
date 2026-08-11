// Status clarity design principle (blueprint 16.1): text + icon + color, never
// color alone, so status is legible without relying on color perception.
export type StatusTone = "neutral" | "info" | "success" | "warning" | "danger";

const toneClasses: Record<StatusTone, string> = {
  neutral: "bg-slate-100 text-slate-700",
  info: "bg-blue-100 text-blue-700",
  success: "bg-emerald-100 text-emerald-700",
  warning: "bg-amber-100 text-amber-800",
  danger: "bg-red-100 text-red-700",
};

const toneDot: Record<StatusTone, string> = {
  neutral: "bg-slate-500",
  info: "bg-blue-600",
  success: "bg-emerald-600",
  warning: "bg-amber-600",
  danger: "bg-red-600",
};

export default function StatusBadge({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: StatusTone;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${toneClasses[tone]}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${toneDot[tone]}`} aria-hidden />
      {label}
    </span>
  );
}
