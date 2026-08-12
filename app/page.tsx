import Link from "next/link";
import { ecosystemNav } from "@/lib/nav";

// Placeholder homepage — establishes the hero + ecosystem sections required by
// HOM-01/02 so routing and layout can be verified end to end. Full content
// migration from legacy-site/index.html happens under task #5.
export default function HomePage() {
  return (
    <>
      <section className="bg-brand-dark py-24 text-white">
        <div className="mx-auto max-w-4xl px-6 text-center">
          <h1 className="text-4xl font-black md:text-5xl">
            From classroom fundamentals to industrial-scale solutions
          </h1>
          <p className="mt-4 text-white/70">
            JTES bridges education, engineering and industry across five connected
            destinations.
          </p>
          <Link
            href="/project-space/start"
            className="mt-8 inline-block rounded-lg bg-brand-blue px-6 py-3 font-semibold text-white hover:bg-brand-blue-dark"
          >
            Start a Project
          </Link>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-16">
        <h2 className="mb-8 text-2xl font-bold text-brand-dark">JTES Ecosystem</h2>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-5">
          {ecosystemNav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-xl border border-surface-border p-6 font-semibold hover:border-brand-blue"
            >
              {item.label}
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}
