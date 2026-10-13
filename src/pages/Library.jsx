import { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { signedUrl } from "@/lib/files";

export default function Library() {
  const [items, setItems] = useState(null);
  const load = () => base44.entities.Asset.filter({}, { sort: "-created_date", limit: 50 }).then((p) => setItems(p.items));
  useEffect(() => { load(); }, []);
  const open = async (a) => window.open(await signedUrl(a.file_uri), "_blank");
  const remove = async (a) => { await base44.entities.Asset.delete(a.id); load(); };
  return (
    <div className="max-w-4xl mx-auto px-6 py-12">
      <h1 className="font-heading text-4xl">Library</h1>
      <p className="text-muted-foreground mt-2 mb-8">Your private characters and audio. Download links expire after one hour.</p>
      {items === null ? <p className="text-muted-foreground">Loading…</p> : items.length === 0 ? <p className="text-muted-foreground">Nothing here yet. Files you add in the studio appear here.</p> : (
        <div className="divide-y border rounded-2xl">{items.map((a) => (
          <div key={a.id} className="flex items-center justify-between p-4 text-sm">
            <div><p>{a.name}</p><p className="text-xs text-muted-foreground capitalize">{a.kind} · {(a.size / 1e6).toFixed(1)} MB</p></div>
            <div className="flex gap-1"><Button size="sm" variant="ghost" onClick={() => open(a)}>Download</Button><Button size="sm" variant="ghost" onClick={() => remove(a)}>Remove</Button></div>
          </div>))}</div>
      )}
    </div>
  );
}