import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Wand2 } from "lucide-react";

const SUGGESTIONS = {
  Character: ["Explain what it can express"],
  Song: ["Suggest song sections"],
  Performance: ["Give me three interpretations", "Make the chorus feel triumphant"],
  Expressions: ["Warm but holding back tears", "Soften the smile"],
};

export default function DirectorPanel({ project, panel, proposals, onApply, onUndo, onRedo, canUndo, canRedo, refresh }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const ask = async (request) => {
    setBusy(true); setErr("");
    const r = await base44.functions.invoke("directorPropose", { project_id: project.id, panel, request }).catch((e) => ({ data: { error: e.response?.data?.error || e.message } }));
    if (r.data?.error) setErr(r.data.error);
    setBusy(false); setText(""); refresh();
  };
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {(SUGGESTIONS[panel] || SUGGESTIONS.Performance).map((s) => (
          <button key={s} onClick={() => ask(s)} disabled={busy} className="text-xs px-3 py-1.5 rounded-full bg-secondary hover:bg-accent">{s}</button>
        ))}
      </div>
      <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Keep this verse intimate, look toward camera on the last line…" />
      <Button disabled={busy || !text.trim()} onClick={() => ask(text)}>{busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Wand2 className="w-4 h-4 mr-2" />}Ask the Director</Button>
      {err && <p className="text-xs text-red-400">{err}</p>}
      <div className="flex gap-2"><Button size="sm" variant="ghost" disabled={!canUndo} onClick={onUndo}>Undo</Button><Button size="sm" variant="ghost" disabled={!canRedo} onClick={onRedo}>Redo</Button></div>
      <div className="space-y-3">
        {proposals.map((p) => (
          <div key={p.id} className="bg-secondary/50 rounded-xl p-3 text-sm">
            <p>{p.summary}</p>
            <ul className="mt-2 text-xs text-muted-foreground space-y-1">
              {(p.operations || []).map((o, i) => <li key={i}>{o.label} · {o.group} ×{o.gain} · {o.start}–{o.end}s</li>)}
            </ul>
            <div className="flex items-center justify-between mt-3">
              <span className="text-[10px] text-muted-foreground">{p.model} · {p.status}</span>
              {p.status === "proposed" && (p.operations || []).length > 0 && <Button size="sm" onClick={() => onApply(p)}>Apply</Button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}