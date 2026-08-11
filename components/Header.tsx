"use client";

import Link from "next/link";
import { useState } from "react";
import { ecosystemNav, utilityNav } from "@/lib/nav";

export default function Header() {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-surface-border bg-white">
      {/* Utility bar */}
      <div className="hidden border-b border-surface-border bg-surface-light md:block">
        <div className="mx-auto flex max-w-7xl items-center justify-end gap-6 px-6 py-2 text-sm text-ink-muted">
          {utilityNav.map((item) => (
            <Link key={item.href} href={item.href} className="hover:text-brand-blue">
              {item.label}
            </Link>
          ))}
        </div>
      </div>

      {/* Primary ecosystem nav */}
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <Link href="/" className="text-lg font-black text-brand-dark">
          JTES
        </Link>

        <nav className="hidden items-center gap-8 md:flex">
          {ecosystemNav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-sm font-semibold text-ink hover:text-brand-blue"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <button
          type="button"
          className="md:hidden"
          aria-label="Open menu"
          aria-expanded={drawerOpen}
          onClick={() => setDrawerOpen((open) => !open)}
        >
          <span className="block h-0.5 w-6 bg-brand-dark" />
          <span className="mt-1 block h-0.5 w-6 bg-brand-dark" />
          <span className="mt-1 block h-0.5 w-6 bg-brand-dark" />
        </button>
      </div>

      {/* Mobile drawer — single menu with grouped sections, per NAV-04/05 */}
      {drawerOpen && (
        <div className="border-t border-surface-border bg-white px-6 py-4 md:hidden">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-muted">
            Ecosystem
          </p>
          <div className="mb-4 flex flex-col gap-3">
            {ecosystemNav.map((item) => (
              <Link key={item.href} href={item.href} onClick={() => setDrawerOpen(false)}>
                {item.label}
              </Link>
            ))}
          </div>
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-muted">
            Company
          </p>
          <div className="flex flex-col gap-3">
            {utilityNav.map((item) => (
              <Link key={item.href} href={item.href} onClick={() => setDrawerOpen(false)}>
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </header>
  );
}
