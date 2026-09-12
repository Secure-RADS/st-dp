import { Link, NavLink } from "react-router-dom";
import { ShieldCheckIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const LINKS = [
  { to: "/", label: "Home" },
  { to: "/subject", label: "Data subject" },
  { to: "/authority", label: "Service authority" },
];

export function SiteHeader() {
  return (
    <header className="border-b">
      <div className="mx-auto flex min-h-14 max-w-6xl flex-wrap items-center gap-x-6 gap-y-1 px-4 py-2">
        <Link to="/" className="flex items-center gap-2 font-heading font-medium">
          <ShieldCheckIcon className="size-5" />
          Secure RADS transparency
        </Link>
        <nav className="flex flex-wrap items-center gap-1 text-sm">
          {LINKS.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) =>
                cn(
                  "rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:text-foreground",
                  isActive && "bg-muted text-foreground",
                )
              }
            >
              {link.label}
            </NavLink>
          ))}
        </nav>
      </div>
    </header>
  );
}
