import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

export default function Admin() {
  const { user } = useAuth();
  const [status, setStatus] = useState(null); const [busy, setBusy] = useState(false);
  if (user?.role !== "admin") return <div className="p-12 text-muted-foreground">Administrators only.</div>;
  const check = async (test) => { setBusy(true); const r = await base44.functions.invoke("adminConnectionStatus", { test }).catch((e) => ({ data: { error: e.response?.data?.error || e.message } })); setStatus(r.data); setBusy(false); };
  return (
    <div className="max-w-2xl mx-auto px-6 py-12 space-y-6">
      <h1 className="font-heading text-4xl">Admin</h1>
      <section className="bg-card border rounded-2xl p-6 space-y-4">
        <p className="font-medium">Audio2Face GPU connection</p>
        <p className="text-sm text-muted-foreground">Needs your RunPod API key and the ID of a dedicated MationFacelab serverless endpoint running the Audio2Face-3D worker. Credentials stay on the server.</p>
        <div className="flex gap-2">
          <Button variant="secondary" disabled={busy} onClick={() => check(false)}>Check configuration</Button>
          <Button disabled={busy} onClick={() => check(true)}>{busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Run real inference test</Button>
        </div>
        {status && <pre className="text-xs bg-secondary/50 rounded-xl p-4 whitespace-pre-wrap">{JSON.stringify(status, null, 2)}</pre>}
      </section>
    </div>
  );
}