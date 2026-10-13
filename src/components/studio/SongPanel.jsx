import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Upload } from "lucide-react";
import { uploadPrivate } from "@/lib/files";

function Drop({ label, name, kind, onUri }) {
  const [busy, setBusy] = useState(false);
  const pick = async (e) => { const f = e.target.files[0]; if (!f) return; setBusy(true); onUri(await uploadPrivate(f, kind), f.name); setBusy(false); };
  return (
    <label className="flex items-center gap-3 border border-dashed rounded-xl p-3 cursor-pointer hover:border-primary/60 text-sm">
      <Upload className="w-4 h-4 text-primary shrink-0" />
      <span className="truncate">{busy ? "Uploading privately…" : name || label}</span>
      <input type="file" accept="audio/*" className="sr-only" onChange={pick} disabled={busy} />
    </label>
  );
}

export default function SongPanel({ project, update }) {
  const num = (k) => (e) => update({ [k]: parseFloat(e.target.value) || 0 });
  return (
    <div className="space-y-4">
      <div className="space-y-2"><Label>Lead vocal (drives the face)</Label>
        <Drop label="Add lead-vocal stem" name={project.vocal_name} kind="vocal" onUri={(u, n) => update({ vocal_uri: u, vocal_name: n })} /></div>
      <div className="space-y-2"><Label>Soundtrack (what the audience hears)</Label>
        <Drop label="Add full mix (optional)" name={project.soundtrack_name} kind="soundtrack" onUri={(u, n) => update({ soundtrack_uri: u, soundtrack_name: n })} /></div>
      <div className="grid grid-cols-3 gap-2">
        <div><Label className="text-xs">Preview from</Label><Input type="number" step="0.1" defaultValue={project.preview_start} onBlur={num("preview_start")} /></div>
        <div><Label className="text-xs">to</Label><Input type="number" step="0.1" defaultValue={project.preview_end} onBlur={num("preview_end")} /></div>
        <div><Label className="text-xs">Offset (s)</Label><Input type="number" step="0.01" defaultValue={project.audio_offset} onBlur={num("audio_offset")} /></div>
      </div>
      <div className="space-y-2"><Label>Lyrics (optional context)</Label>
        <Textarea rows={5} defaultValue={project.lyrics} onBlur={(e) => update({ lyrics: e.target.value })} placeholder="Lyrics help the Director; generation doesn't need them." /></div>
    </div>
  );
}