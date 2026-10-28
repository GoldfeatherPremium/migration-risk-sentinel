import { Link } from "@tanstack/react-router";
import { Menu, ShieldCheck, X } from "lucide-react";
import { useState } from "react";
import { SITE } from "@/lib/site";
import { cn } from "@/lib/utils";
import type { Severity } from "@/lib/core";

const NAV = [
  { to: "/analyzer", label: "Analyzer" },
  { to: "/playground", label: "Playground" },
  { to: "/rules", label: "Rules" },
  { to: "/docs", label: "Docs" },
  { to: "/about", label: "About" },
] as const;

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
        <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <ShieldCheck className="h-5 w-5 text-primary" aria-hidden />
          <span>Migration Guard</span>
        </Link>
        <nav className="ml-auto hidden items-center gap-1 md:flex" aria-label="Main">
          {NAV.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
              activeProps={{ className: "text-foreground bg-muted" }}
            >
              {n.label}
            </Link>
          ))}
          <a
            href={SITE.repoUrl}
            className="ml-2 rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
            rel="noreferrer"
            target="_blank"
          >
            GitHub
          </a>
        </nav>
        <button
          className="ml-auto rounded-md p-2 md:hidden"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen(!open)}
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>
      {open && (
        <nav className="border-t px-4 py-2 md:hidden" aria-label="Mobile">
          {NAV.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              onClick={() => setOpen(false)}
              className="block rounded-md px-2 py-2 text-sm"
            >
              {n.label}
            </Link>
          ))}
          <a
            href={SITE.repoUrl}
            className="block px-2 py-2 text-sm"
            rel="noreferrer"
            target="_blank"
          >
            GitHub
          </a>
        </nav>
      )}
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
        <p>MIT licensed. Static analysis only — it cannot guarantee a migration is safe.</p>
        <div className="flex flex-wrap gap-4">
          <a
            href={SITE.issuesUrl}
            target="_blank"
            rel="noreferrer"
            className="hover:text-foreground"
          >
            Issues
          </a>
          <a
            href={SITE.releasesUrl}
            target="_blank"
            rel="noreferrer"
            className="hover:text-foreground"
          >
            Releases
          </a>
          <a
            href={SITE.securityUrl}
            target="_blank"
            rel="noreferrer"
            className="hover:text-foreground"
          >
            Security
          </a>
        </div>
      </div>
    </footer>
  );
}

const SEV_CLASS: Record<Severity, string> = {
  error: "bg-sev-error-soft text-sev-error border-sev-error/30",
  warning: "bg-sev-warning-soft text-sev-warning border-sev-warning/30",
  info: "bg-sev-info-soft text-sev-info border-sev-info/30",
};

export function SeverityBadge({ severity, className }: { severity: Severity; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[11px] font-medium uppercase tracking-wide",
        SEV_CLASS[severity],
        className,
      )}
    >
      {severity}
    </span>
  );
}

export function PageHeader({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="border-b bg-card/50">
      <div className="mx-auto max-w-6xl px-4 py-10">
        <p className="font-mono text-xs uppercase tracking-widest text-primary">{eyebrow}</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">{title}</h1>
        {children && <div className="mt-3 max-w-2xl text-muted-foreground">{children}</div>}
      </div>
    </div>
  );
}

export function CodeBlock({ children, className }: { children: string; className?: string }) {
  return (
    <pre
      className={cn(
        "overflow-x-auto rounded-lg bg-code p-4 text-[13px] leading-relaxed text-code-foreground",
        className,
      )}
    >
      <code>{children}</code>
    </pre>
  );
}
