import { NavLink, Outlet } from "react-router-dom";
import { FolderOpen, Library, Activity, Settings, Shield, LogOut } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { base44 } from "@/api/base44Client";

const items = [
  { to: "/", label: "Projects", icon: FolderOpen },
  { to: "/library", label: "Library", icon: Library },
  { to: "/jobs", label: "Jobs", icon: Activity },
  { to: "/settings", label: "Settings", icon: Settings },
];

export default function AppLayout() {
  const { user } = useAuth();
  const nav = user?.role === "admin" ? [...items, { to: "/admin", label: "Admin", icon: Shield }] : items;
  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      <aside className="md:w-56 border-b md:border-b-0 md:border-r p-4 flex md:flex-col gap-1 shrink-0">
        <div className="font-heading text-xl mb-0 md:mb-8 mr-4 px-2">Mation<span className="text-primary">Facelab</span></div>
        <nav className="flex md:flex-col gap-1 overflow-x-auto flex-1">
          {nav.map(({ to, label, icon: I }) => (
            <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${isActive ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              <I className="w-4 h-4" />{label}
            </NavLink>
          ))}
        </nav>
        <button onClick={() => base44.auth.logout("/login")} className="hidden md:flex items-center gap-3 px-3 py-2 text-sm text-muted-foreground hover:text-foreground">
          <LogOut className="w-4 h-4" />Sign out
        </button>
      </aside>
      <main className="flex-1 min-w-0"><Outlet /></main>
    </div>
  );
}