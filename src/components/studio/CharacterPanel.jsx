import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Upload, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { uploadPrivate } from "@/lib/files";

const READY = {
  ready: { icon: CheckCircle2, text: "Ready", tone: "text-emerald-400", next: "Your face controls cover a full singing performance." },
  partial: { icon: AlertTriangle, text: "A few controls need matching", tone: "text-amber-400", next: "Review unmatched channels after your first preview." },
  missing: { icon: XCircle, text: "Facial controls missing", tone: "text-red-400", next: "This model has no face morph targets or jaw bone. It needs facial rigging before Audio2Face can drive it." },
};

export default function CharacterPanel({ project, update }) {
  const [busy, setBusy] = useState(false);
  const rp = project.rig_profile;
  const onFile = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    setBusy(true);
    const uri = await uploadPrivate(file, "character");
    await update({ character_uri: uri, character_name: file.name, rig_profile: null });
    setBusy(false);
  };
  const r = rp && READY[rp.readiness];
  return (
    <div className="space-y-5">
      <label className="flex flex-col items-center justify-center border border-dashed rounded-xl p-6 cursor-pointer hover:border-primary/60 text-sm text-center">
        <Upload className="w-5 h-5 mb-2 text-primary" />
        {busy ? "Uploading privately…" : project.character_name || "Add a rigged GLB character"}
        <input type="file" accept=".glb" className="sr-only" onChange={onFile} disabled={busy} />
      </label>
      {r && (
        <div className="bg-secondary/50 rounded-xl p-4">
          <div className={`flex items-center gap-2 font-medium ${r.tone}`}><r.icon className="w-4 h-4" />{r.text}</div>
          <p className="text-xs text-muted-foreground mt-2">{r.next}</p>
          <details className="mt-3 text-xs text-muted-foreground">
            <summary className="cursor-pointer">Details</summary>
            <ul className="mt-2 space-y-1">
              <li>{rp.facial_controls.length} facial controls · {rp.sided_count} left/right</li>
              <li>{rp.bone_count} bones · head: {rp.head_bone || "—"} · jaw bone: {rp.jaw_bone || "—"}</li>
              <li>Jaw driven by: {rp.jaw_driver} (single driver, no double jaw)</li>
              <li>Teeth mesh: {rp.has_teeth ? "found, preserved" : "not identified by name"}</li>
              {rp.missing?.length > 0 && <li>Unmatched model channels: {rp.missing.join(", ")}</li>}
            </ul>
          </details>
        </div>
      )}
      <p className="text-xs text-muted-foreground">Characters are stored privately and only you can open them. Your mesh, materials and existing teeth are never replaced.</p>
    </div>
  );
}