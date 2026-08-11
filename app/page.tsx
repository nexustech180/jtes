import Hero from "@/components/Hero";
import SectionHeading from "@/components/SectionHeading";
import { EcosystemCard } from "@/components/ui/Card";
import { ecosystemNav } from "@/lib/nav";

// Placeholder homepage — establishes the hero + ecosystem sections required by
// HOM-01/02 so routing, layout and the shared component library can be
// verified end to end. Full content migration from legacy-site/index.html
// happens under task #5.
export default function HomePage() {
  return (
    <>
      <Hero
        title="From classroom fundamentals to industrial-scale solutions"
        description="JTES bridges education, engineering and industry across five connected destinations."
        ctaLabel="Start a Project"
        ctaHref="/project-space/start"
      />

      <section className="mx-auto max-w-7xl px-6 py-16">
        <SectionHeading eyebrow="Ecosystem" title="Five destinations, one account" />
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-5">
          {ecosystemNav.map((item) => (
            <EcosystemCard key={item.href} href={item.href} title={item.label} />
          ))}
        </div>
      </section>
    </>
  );
}
