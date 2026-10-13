import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Play, Pause, Repeat } from "lucide-react";
import Viewport from "@/components/studio/Viewport";
import CharacterPanel from "@/components/studio/CharacterPanel";
import SongPanel from "@/components/studio/SongPanel";
import PerformancePanel from "@/components/studio/PerformancePanel";
import DirectorPanel from "@/components/studio/DirectorPanel";
import Waveform from "@/components/studio/Waveform";
import { signedUrl } from "@/lib/files";
import { analyzeScene, buildMapping, TAKE_STYLES } from "@/lib/rig";

const PANELS = ["Character", "Song", "Performance", "Expressions"];

export default function Studio() {
  const { id } = useParams();
  const [project, setProject] = useState(null);
  const [panel, setPanel] = useState("Character");
  const [urls, setUrls] = useState({});
  const [jobs, setJobs] = useState([]); const [takes, setTakes] = useState([]); const [proposals, setProposals] = useState([]);
  const [anim, setAnim] = useState(null); const [saved, setSaved] = useState("Saved");
  const [playing, setPlaying] = useState(false); const [loop, setLoop] = useState(true); const [view, setView] = useState(null);
  const [undo, setUndo] = useState([]); const [redo, setRedo] = useState([]);
  const audioRef = useRef(null); const seq = useRef(0);

  const update = useCallback(async (patch) => {
    setProject((p) => ({ ...p, ...patch })); setSaved("Saving…");
    const n = ++seq.current; await base44.entities.Project.update(id, patch);
    if (n === seq.current) setSaved("Saved");
  }, [id]);

  const refresh = useCallback(async () => {
    const [j, t, pr] = await Promise.all([
      base44.entities.GenerationJob.filter({ project_id: id }, { sort: "-created_date", limit: 20 }),
      base44.entities.Take.filter({ project_id: id }, { sort: "-created_date", limit: 20 }),
      base44.entities.DirectorProposal.filter({ project_id: id }, { sort: "-created_date", limit: 10 }),
    ]);
    setJobs(j.items); setTakes(t.items); setProposals(pr.items);
  }, [id]);

  const [missing, setMissing] = useState(false);
  useEffect(() => { base44.entities.Project.get(id).then(setProject).catch(() => setMissing(true)); refresh(); }, [id]);
  useEffect(() => { if (project?.character_uri) signedUrl(project.character_uri).then((u) => setUrls((s) => ({ ...s, character: u }))); }, [project?.character_uri]);
  useEffect(() => { if (project?.vocal_uri) signedUrl(project.vocal_uri).then((u) => setUrls((s) => ({ ...s, vocal: u }))); }, [project?.vocal_uri]);

  // Poll active jobs through the authorized status route (survives refresh: jobs are durable records).
  useEffect(() => {
    const active = jobs.filter((j) => ["preparing", "queued", "generating", "mapping"].includes(j.status));
    if (!active.length) return;
    const t = setTimeout(async () => { await Promise.all(active.map((j) => base44.functions.invoke("getJobStatus", { job_id: j.id }))); refresh(); }, 4000);
    return () => clearTimeout(t);
  }, [jobs]);

  const take = takes.find((t) => t.id === project?.selected_take_id);
  useEffect(() => {
    if (!take?.animation_uri) { setAnim(null); return; }
    signedUrl(take.animation_uri).then((u) => fetch(u)).then((r) => r.json()).then((a) => {
      setAnim(a);
      if (project.rig_profile?.morphs) { const { mapping, missing } = buildMapping(a.channels, project.rig_profile.morphs); setProject((p) => ({ ...p, _mapping: mapping })); if (JSON.stringify(missing) !== JSON.stringify(project.rig_profile.missing)) update({ rig_profile: { ...project.rig_profile, missing } }); }
    });
  }, [take?.animation_uri, project?.rig_profile?.morphs?.length]);

  const onLoaded = (scene) => { if (!project.rig_profile) update({ rig_profile: analyzeScene(scene) }); };

  const setLayers = (layers) => { setUndo((u) => [...u, project.layers || []]); setRedo([]); update({ layers }); };
  const apply = async (p) => {
    const ops = p.operations.map((o, i) => ({ ...o, id: `${p.id}-${i}`, source: "director" }));
    setLayers([...(project.layers || []), ...ops]);
    await base44.entities.DirectorProposal.update(p.id, { status: "applied" }); refresh();
  };
  const doUndo = () => { const prev = undo[undo.length - 1]; setUndo(undo.slice(0, -1)); setRedo([...redo, project.layers || []]); update({ layers: prev }); };
  const doRedo = () => { const next = redo[redo.length - 1]; setRedo(redo.slice(0, -1)); setUndo([...undo, project.layers || []]); update({ layers: next }); };

  const toggle = () => {
    const a = audioRef.current; if (!a) return;
    if (playing) { a.pause(); setPlaying(false); return; }
    if (a.currentTime < project.preview_start || a.currentTime > project.preview_end) a.currentTime = anim ? anim.time_origin : project.preview_start;
    a.play().then(() => setPlaying(true)).catch(() => setSaved("Click play again to allow audio"));
  };
  const onTime = () => { const a = audioRef.current; if (loop && a.currentTime > project.preview_end) a.currentTime = project.preview_start; };

  if (missing) return (
    <div className="h-screen flex flex-col items-center justify-center gap-4 text-center px-6">
      <p className="font-heading text-2xl">Project not found</p>
      <p className="text-muted-foreground text-sm">It may have been deleted, or you don't have access to it.</p>
      <Link to="/" className="text-primary text-sm">Back to projects</Link>
    </div>
  );
  if (!project) return <div className="p-10 text-muted-foreground">Loading studio…</div>;
  return (
    <div className="h-screen flex flex-col">
      <div className="lg:hidden p-6 text-sm text-muted-foreground">The studio is built for desktop. You can browse projects and review takes on smaller screens.</div>
      <header className="h-14 border-b flex items-center gap-4 px-4">
        <Link to="/" aria-label="Back to projects"><ArrowLeft className="w-4 h-4" /></Link>
        <input className="bg-transparent font-heading text-lg outline-none" defaultValue={project.name} onBlur={(e) => update({ name: e.target.value })} aria-label="Project name" />
        <span className="text-xs text-muted-foreground">{saved}</span>
        <div className="ml-auto flex gap-1">{["face", "front", "three", "side"].map((v) => <Button key={v} size="sm" variant="ghost" onClick={() => setView({ name: v })}>{v === "three" ? "¾" : v}</Button>)}</div>
      </header>
      <ResizablePanelGroup direction="horizontal" className="flex-1">
        <ResizablePanel defaultSize={24} minSize={18} className="flex flex-col">
          <div className="flex flex-wrap gap-1 p-2 border-b">{PANELS.map((p) => (
            <button key={p} onClick={() => setPanel(p)} className={`px-3 py-1.5 rounded-lg text-xs ${panel === p ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>{p}</button>))}</div>
          <div className="p-4 overflow-y-auto flex-1">
            {panel === "Character" && <CharacterPanel project={project} update={update} />}
            {panel === "Song" && <SongPanel project={project} update={update} />}
            {panel === "Performance" && <PerformancePanel project={project} jobs={jobs} takes={takes} refresh={refresh} selectTake={(t) => update({ selected_take_id: t.id })} />}
            {panel === "Expressions" && <p className="text-sm text-muted-foreground">Describe a feeling in the Director, e.g. “Warm but holding back tears”. Applied expression layers: {(project.layers || []).length}.</p>}
          </div>
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel defaultSize={52}>
          <div className="h-full relative">
            {urls.character ? <Viewport url={urls.character} onLoaded={onLoaded} animation={anim} mapping={project._mapping} takeGains={take ? TAKE_STYLES[take.style].gains : {}} layers={project.layers} audioRef={audioRef} offset={project.audio_offset} view={view} />
              : <div className="h-full flex items-center justify-center text-muted-foreground text-sm">Add a rigged GLB character to begin</div>}
          </div>
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel defaultSize={24} minSize={18}>
          <div className="p-4 h-full overflow-y-auto"><p className="font-heading text-lg mb-4">AI Director</p>
            <DirectorPanel project={project} panel={panel} proposals={proposals} onApply={apply} onUndo={doUndo} onRedo={doRedo} canUndo={undo.length > 0} canRedo={redo.length > 0} refresh={refresh} /></div>
        </ResizablePanel>
      </ResizablePanelGroup>
      <footer className="border-t px-4 py-3 flex items-center gap-4">
        <Button size="icon" onClick={toggle} disabled={!urls.vocal} aria-label={playing ? "Pause" : "Play"}>{playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}</Button>
        <Button size="icon" variant={loop ? "secondary" : "ghost"} onClick={() => setLoop(!loop)} aria-label="Loop selection"><Repeat className="w-4 h-4" /></Button>
        <div className="flex-1"><Waveform url={urls.vocal} start={project.preview_start} end={project.preview_end} audioRef={audioRef} onDuration={(d) => d !== project.duration && update({ duration: d })} /></div>
        <audio ref={audioRef} src={urls.vocal} onTimeUpdate={onTime} onPause={() => setPlaying(false)} crossOrigin="anonymous" />
      </footer>
    </div>
  );
}