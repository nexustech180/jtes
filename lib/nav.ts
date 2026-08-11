// Two-level navigation per blueprint Section 4.1 / Scope of Work NAV-01–04.
// Utility bar = corporate/trust items. Primary ecosystem = the five JTES
// destinations. Keep this the single source of truth for both desktop nav
// and the mobile drawer so they can never drift apart.

export type NavItem = {
  label: string;
  href: string;
};

export const utilityNav: NavItem[] = [
  { label: "About", href: "/about" },
  { label: "Team & Interns", href: "/team" },
  { label: "News & Articles", href: "/news" },
  { label: "Contact", href: "/contact" },
  { label: "Client Login", href: "/login" },
];

export const ecosystemNav: NavItem[] = [
  { label: "Project Space", href: "/project-space" },
  { label: "My Store", href: "/store" },
  { label: "Animation-Dot", href: "/animation-dot" },
  { label: "Learn Extra", href: "/learn-extra" },
  { label: "Prime Aide", href: "/prime-aide" },
];
