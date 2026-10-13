import { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";

export default function Jobs() {
  const [items, setItems] = useState(null);
  const load = () => base44.entities.GenerationJob.filter({}, { sort: "-created_date", limit: 50 }).then((p) => setItems(p.items));
  useEffect(() => { load(); }, []);
  const act = async (fn, job_id) => { await base44.functions.invoke(fn, { job_id }); load(); };
  return (
    <div className="max-w-4xl mx-auto px-6 py-12">
      <h1 className="font-heading text-4xl mb-8">Jobs</h1>
      {items === null ? <p className="text-muted-foreground">Loading…</p> : items.length === 0 ? <p className="text-muted-foreground">No generation jobs yet.</p> : (
        <div className="divide-y border rounded-2xl">{items.map((j) => (
          <div key={j.id} className="p-4 text-sm flex items-center justify-between gap-4">
            <div className="min-w-0"><p className="capitalize">{j.kind} · {j.status}</p>
              <p className="text-xs text-muted-foreground truncate">{new Date(j.created_date).toLocaleString()}{j.execution_ms ? ` · ${(j.execution_ms / 1000).toFixed(1)}s GPU` : ""}{j.error ? ` · ${j.error}` : ""}</p></div>
            <div className="flex gap-1 shrink-0">
              {["queued", "generating", "preparing"].includes(j.status) && <><Button size="sm" variant="ghost" onClick={() => act("getJobStatus", j.id)}>Refresh</Button><Button size="sm" variant="ghost" onClick={() => act("cancelJob", j.id)}>Cancel</Button></>}
            </div>
          </div>))}</div>
      )}
    </div>
  );
}