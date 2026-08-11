import Link from "next/link";
import type { ReactNode } from "react";

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl border border-surface-border bg-white p-6 shadow-sm ${className}`}
    >
      {children}
    </div>
  );
}

// Service/ecosystem card (HOM-02/03) — used for the five destination cards and
// the six service-family summaries.
export function EcosystemCard({
  href,
  title,
  description,
}: {
  href: string;
  title: string;
  description?: string;
}) {
  return (
    <Link
      href={href}
      className="block rounded-xl border border-surface-border p-6 transition hover:border-brand-blue hover:shadow-md"
    >
      <h3 className="font-semibold text-brand-dark">{title}</h3>
      {description && <p className="mt-2 text-sm text-ink-muted">{description}</p>}
    </Link>
  );
}

// Project card (PSP-03) — name, reference code, agent, status, progress, dates.
export function ProjectCard({
  name,
  referenceCode,
  agent,
  statusBadge,
  progress,
  startDate,
  targetDate,
  href,
}: {
  name: string;
  referenceCode: string;
  agent?: string;
  statusBadge: ReactNode;
  progress: number;
  startDate?: string;
  targetDate?: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="block rounded-xl border border-surface-border p-5 transition hover:border-brand-blue"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-mono text-ink-muted">{referenceCode}</p>
          <h3 className="font-semibold text-brand-dark">{name}</h3>
        </div>
        {statusBadge}
      </div>
      <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-surface-light">
        <div
          className="h-full rounded-full bg-brand-blue"
          style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
        />
      </div>
      <div className="mt-3 flex flex-wrap justify-between gap-2 text-xs text-ink-muted">
        {agent && <span>Agent: {agent}</span>}
        {startDate && <span>Start: {startDate}</span>}
        {targetDate && <span>Target: {targetDate}</span>}
      </div>
    </Link>
  );
}

// Product card (STR-05).
export function ProductCard({
  href,
  name,
  price,
  imageAlt,
  statusBadge,
}: {
  href: string;
  name: string;
  price: string;
  imageAlt: string;
  statusBadge?: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="block overflow-hidden rounded-xl border border-surface-border transition hover:border-brand-blue"
    >
      <div
        role="img"
        aria-label={imageAlt}
        className="aspect-square bg-surface-light"
      />
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold text-brand-dark">{name}</h3>
          {statusBadge}
        </div>
        <p className="mt-1 font-bold text-brand-blue">{price}</p>
      </div>
    </Link>
  );
}

// Article/tutorial card (NWS-03, LRN taxonomy).
export function ArticleCard({
  href,
  title,
  category,
  summary,
  publishedAt,
}: {
  href: string;
  title: string;
  category: string;
  summary?: string;
  publishedAt?: string;
}) {
  return (
    <Link
      href={href}
      className="block rounded-xl border border-surface-border p-5 transition hover:border-brand-blue"
    >
      <p className="text-xs font-bold uppercase tracking-wide text-brand-blue">
        {category}
      </p>
      <h3 className="mt-2 font-semibold text-brand-dark">{title}</h3>
      {summary && <p className="mt-2 text-sm text-ink-muted">{summary}</p>}
      {publishedAt && <p className="mt-3 text-xs text-ink-muted">{publishedAt}</p>}
    </Link>
  );
}

// Team profile card (NWS-06/07) — photo omitted here (media pipeline is a
// later task); name/role/bio/expertise only, respecting NWS-09/10/11 consent
// and no-direct-contact-details rules.
export function TeamCard({
  name,
  role,
  bio,
  expertise,
}: {
  name: string;
  role: string;
  bio?: string;
  expertise?: string[];
}) {
  return (
    <Card>
      <div className="mb-4 h-16 w-16 rounded-full bg-surface-light" aria-hidden />
      <h3 className="font-semibold text-brand-dark">{name}</h3>
      <p className="text-sm text-brand-blue">{role}</p>
      {bio && <p className="mt-2 text-sm text-ink-muted">{bio}</p>}
      {expertise && expertise.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {expertise.map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-surface-light px-2.5 py-1 text-xs text-ink-muted"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </Card>
  );
}
