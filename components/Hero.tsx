import Link from "next/link";

// HOM-01: hero states the JTES value proposition; one primary CTA per section
// (HOM-11 / design principle in blueprint 16.1).
export default function Hero({
  title,
  description,
  ctaLabel,
  ctaHref,
}: {
  title: string;
  description?: string;
  ctaLabel: string;
  ctaHref: string;
}) {
  return (
    <section className="bg-brand-dark py-24 text-white">
      <div className="mx-auto max-w-4xl px-6 text-center">
        <h1 className="text-4xl font-black md:text-5xl">{title}</h1>
        {description && <p className="mt-4 text-white/70">{description}</p>}
        <Link
          href={ctaHref}
          className="mt-8 inline-block rounded-lg bg-brand-blue px-6 py-3 font-semibold text-white transition hover:bg-brand-blue-dark"
        >
          {ctaLabel}
        </Link>
      </div>
    </section>
  );
}
