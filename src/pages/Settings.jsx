import { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";

export default function Settings() {
  const { user } = useAuth();
  const [count, setCount] = useState(null);
  useEffect(() => { base44.entities.GenerationJob.count({}).then(setCount); }, []);
  return (
    <div className="max-w-2xl mx-auto px-6 py-12 space-y-8">
      <h1 className="font-heading text-4xl">Settings</h1>
      <section className="bg-card border rounded-2xl p-6 space-y-1"><p className="text-xs text-muted-foreground">Account</p><p>{user?.full_name}</p><p className="text-sm text-muted-foreground">{user?.email}</p></section>
      <section className="bg-card border rounded-2xl p-6"><p className="text-xs text-muted-foreground">Usage</p><p className="text-2xl font-heading mt-1">{count ?? "…"} generation jobs</p>
        <p className="text-sm text-muted-foreground mt-2">Limit: 2 running at once, 20 per day. Files stay private until you remove them from the Library.</p></section>
      <Button variant="secondary" onClick={() => base44.auth.logout("/login")}>Sign out</Button>
    </div>
  );
}