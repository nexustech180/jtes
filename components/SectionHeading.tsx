export default function SectionHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
}) {
  return (
    <div className="mb-8 max-w-2xl">
      {eyebrow && (
        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-brand-blue">
          {eyebrow}
        </p>
      )}
      <h2 className="text-2xl font-bold text-brand-dark md:text-3xl">{title}</h2>
      {description && <p className="mt-3 text-ink-muted">{description}</p>}
    </div>
  );
}
