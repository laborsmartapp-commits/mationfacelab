import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { TAKE_STYLES } from "@/lib/rig";
import { Loader2, Sparkles } from "lucide-react";

const STAGES = { preparing: "Preparing audio", queued: "Queued", generating: "Generating", mapping: "Mapping", ready: "Ready", failed: "Failed", cancelled: "Cancelled" };

export default function PerformancePanel({ project, jobs, takes, selectTake, refresh }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (kind) => {
    setBusy(true); setError("");
    const res = await base44.functions.invoke("submitPerformanceJob", { project_id: project.id, kind }).catch((e) => ({ data: { error: e.response?.data?.error || e.message } }));
    if (res.data?.error) setError(res.data.error);
    setBusy(false); refresh();
  };
  const cancel = async (id) => { await base44.functions.invoke("cancelJob", { job_id: id }); refresh(); };
  const active = jobs.filter((j) => ["preparing", "queued", "generating", "mapping"].includes(j.status));
  const resultTakes = takes.filter((t) => t.job_id);

  return (
    <div className="space-y-5">
      <div className="grid gap-2">
        <Button disabled={busy || !project.vocal_uri || !project.character_uri} onClick={() => submit("preview")}>
          {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
          Generate preview ({project.preview_start}–{project.preview_end}s)</Button>
        <Button variant="secondary" disabled={busy || !project.vocal_uri || !project.character_uri} onClick={() => submit("full")}>Generate full performance</Button>
      </div>
      {error && <p className="text-sm text-red-400 bg-red-500/10 rounded-lg p-3">{error}</p>}
      {active.map((j) => (
        <div key={j.id} className="bg-secondary/50 rounded-xl p-3 text-sm flex items-center justify-between">
          <span className="flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />{j.kind} · {STAGES[j.status]}</span>
          <Button size="sm" variant="ghost" onClick={() => cancel(j.id)}>Cancel</Button>
        </div>
      ))}
      {jobs.filter((j) => j.status === "failed").slice(0, 1).map((j) => (
        <p key={j.id} className="text-xs text-red-400">Last job failed: {j.error}</p>
      ))}
      <div>
        <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Interpretations</p>
        {resultTakes.length === 0 ? <p className="text-xs text-muted-foreground">Generate a preview to compare Intimate, Expressive, Stage and the unmodified model output.</p> : (
          <div className="grid grid-cols-2 gap-2">
            {resultTakes.map((t) => (
              <button key={t.id} onClick={() => selectTake(t)} className={`rounded-xl border p-3 text-left text-sm transition-colors ${project.selected_take_id === t.id ? "border-primary bg-primary/10" : "hover:border-primary/40"}`}>
                <div className="font-medium">{TAKE_STYLES[t.style].label}</div>
                <div className="text-xs text-muted-foreground">{t.range_start}–{t.range_end}s</div>
              </button>
            ))}
          </div>
        )}
      </div>
      <p className="text-xs text-muted-foreground">Facial motion is NVIDIA Audio2Face-3D output only. If the GPU service fails, you'll see the error, never a substitute animation. Head movement is a separate artistic layer.</p>
    </div>
  );
}