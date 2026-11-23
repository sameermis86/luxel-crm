"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLink({ href, exact, children }: { href: string; exact?: boolean; children: React.ReactNode }) {
  const path = usePathname();
  const active = exact ? path === href : path === href || path.startsWith(href + "/");
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`rounded-md px-2.5 py-1.5 whitespace-nowrap transition-colors ${active ? "bg-ink text-paper" : "text-ink/80 hover:bg-ink/5"}`}
    >
      {children}
    </Link>
  );
}
