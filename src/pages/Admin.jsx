import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

export default function Admin() {
  const { user } = useAuth();
  const [status, setStatus] = useState(null); const [busy, setBusy] = useState(false);
  if (user?.role !== "admin") return <div className="p-12 text-muted-foreground">Administrators only.</div>;
  const call = (body) => base44.functions.invoke("adminConnectionStatus", body).then((r) => r.data).catch((e) => ({ error: e.response?.data?.error || e.message }));
  const check = async (mode) => {
    setBusy(true);
    let r = await call(mode === "config" ? {} : { [mode]: true });
    setStatus(r);
    while (r.submitted || (r.poll && !r.done)) {
      const id = r.submitted || r.poll;
      await new Promise((ok) => setTimeout(ok, 5000));
      r = { ...(await call({ poll: id })), poll: id };
      setStatus(r);
    }
    setBusy(false);
  };
  return (
    <div className="max-w-2xl mx-auto px-6 py-12 space-y-6">
      <h1 className="font-heading text-4xl">Admin</h1>
      <section className="bg-card border rounded-2xl p-6 space-y-4">
        <p className="font-medium">Audio2Face GPU connection</p>
        <p className="text-sm text-muted-foreground">Needs your RunPod API key and the ID of a dedicated MationFacelab serverless endpoint running the Audio2Face-3D worker. Credentials stay on the server.</p>
        <div className="flex gap-2">
          <Button variant="secondary" disabled={busy} onClick={() => check("config")}>Check configuration</Button>
          <Button variant="secondary" disabled={busy} onClick={() => check("diagnose")}>Diagnostics</Button>
          <Button disabled={busy} onClick={() => check("test")}>{busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Run real inference test</Button>
        </div>
        {busy && status?.poll && <p className="text-xs text-muted-foreground">Running on the GPU. The first test on a new GPU type prepares the models and can take several minutes.</p>}
        {status && <pre className="text-xs bg-secondary/50 rounded-xl p-4 whitespace-pre-wrap">{JSON.stringify(status, null, 2)}</pre>}
      </section>
    </div>
  );
}