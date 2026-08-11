import Link from "next/link";

export default function Footer() {
  return (
    <footer className="border-t border-surface-border bg-brand-dark text-white">
      <div className="mx-auto max-w-7xl px-6 py-12 text-sm text-white/70">
        <p className="mb-6 max-w-xl">
          JASSAN Technologies and Electrical Services — from classroom technology
          fundamentals to mega applications and industrial-scale solutions.
        </p>
        <nav className="flex flex-wrap gap-x-6 gap-y-2">
          <Link href="/privacy">Privacy Policy</Link>
          <Link href="/terms">Terms of Service</Link>
          <Link href="/store/terms">Store Terms &amp; Returns</Link>
          <Link href="/contact">Contact</Link>
        </nav>
      </div>
    </footer>
  );
}
