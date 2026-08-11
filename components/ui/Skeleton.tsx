export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-surface-light ${className}`} />;
}

export function SkeletonCard() {
  return (
    <div className="rounded-xl border border-surface-border p-6">
      <Skeleton className="h-5 w-2/3" />
      <Skeleton className="mt-3 h-4 w-full" />
      <Skeleton className="mt-2 h-4 w-5/6" />
    </div>
  );
}
