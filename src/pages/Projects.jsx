import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Copy, Archive, Search } from "lucide-react";

export default function Projects() {
  const [items, setItems] = useState(null);
  const [q, setQ] = useState("");
  const navigate = useNavigate();

  const load = async () => {
    const query = { archived: { $ne: true } };
    if (q) query.name = { $regex: q, $options: "i" };
    const page = await base44.entities.Project.filter(query, { sort: "-updated_date", limit: 50 });
    setItems(page.items);
  };
  useEffect(() => { load(); }, [q]);

  const create = async () => {
    const p = await base44.entities.Project.create({ name: "Untitled performance", layers: [] });
    navigate(`/studio/${p.id}`);
  };
  const duplicate = async (p) => {
    const { id, created_date, updated_date, created_by_id, created_by, ...rest } = p;
    await base44.entities.Project.create({ ...rest, name: `${p.name} copy` }); load();
  };
  const archive = async (p) => { await base44.entities.Project.update(p.id, { archived: true }); load(); };

  return (
    <div className="max-w-5xl mx-auto px-6 py-12">
      <div className="flex items-end justify-between mb-10 gap-4">
        <div><h1 className="font-heading text-4xl">Projects</h1><p className="text-muted-foreground mt-2">Your private singing performances.</p></div>
        <Button onClick={create}><Plus className="w-4 h-4 mr-2" />New project</Button>
      </div>
      <div className="relative mb-6"><Search className="w-4 h-4 absolute left-3 top-3 text-muted-foreground" />
        <Input className="pl-9" placeholder="Search projects" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      {items === null ? <p className="text-muted-foreground">Loading…</p> : items.length === 0 ? (
        <div className="border border-dashed rounded-2xl p-16 text-center">
          <p className="font-heading text-2xl">No projects yet</p>
          <p className="text-muted-foreground mt-2 mb-6">Start with a rigged GLB character and a lead vocal.</p>
          <Button onClick={create}>Create your first project</Button>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((p) => (
            <div key={p.id} className="group bg-card border rounded-2xl p-5 hover:border-primary/50 transition-colors">
              <Link to={`/studio/${p.id}`} className="block">
                <div className="aspect-video rounded-xl bg-gradient-to-br from-secondary to-background mb-4 flex items-center justify-center text-muted-foreground text-xs">
                  {p.character_name || "No character yet"}</div>
                <p className="font-medium">{p.name}</p>
                <p className="text-xs text-muted-foreground mt-1">{p.vocal_name || "No vocal"} · {new Date(p.updated_date).toLocaleDateString()}</p>
              </Link>
              <div className="flex gap-1 mt-3 opacity-60 group-hover:opacity-100">
                <Button size="sm" variant="ghost" onClick={() => duplicate(p)}><Copy className="w-3.5 h-3.5 mr-1" />Duplicate</Button>
                <Button size="sm" variant="ghost" onClick={() => archive(p)}><Archive className="w-3.5 h-3.5 mr-1" />Archive</Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}