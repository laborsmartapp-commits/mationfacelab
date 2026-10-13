import { useEffect, useRef, useState } from "react";

export default function Waveform({ url, start, end, audioRef, onDuration }) {
  const canvas = useRef(null);
  const [peaks, setPeaks] = useState(null);
  const [dur, setDur] = useState(0);
  const [t, setT] = useState(0);

  useEffect(() => {
    if (!url) return;
    let alive = true;
    (async () => {
      const buf = await (await fetch(url)).arrayBuffer();
      const audio = await new AudioContext().decodeAudioData(buf);
      const data = audio.getChannelData(0); const n = 600; const step = Math.floor(data.length / n);
      const p = Array.from({ length: n }, (_, i) => { let m = 0; for (let j = 0; j < step; j += 16) m = Math.max(m, Math.abs(data[i * step + j])); return m; });
      if (alive) { setPeaks(p); setDur(audio.duration); onDuration?.(audio.duration); }
    })();
    return () => { alive = false; };
  }, [url]);

  useEffect(() => { const id = setInterval(() => setT(audioRef.current?.currentTime || 0), 60); return () => clearInterval(id); }, []);

  useEffect(() => {
    const c = canvas.current; if (!c || !peaks) return;
    const ctx = c.getContext("2d"); const w = (c.width = c.clientWidth * 2); const h = (c.height = c.clientHeight * 2);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "rgba(240,128,104,0.12)"; ctx.fillRect((start / dur) * w, 0, ((end - start) / dur) * w, h);
    peaks.forEach((p, i) => { const x = (i / peaks.length) * w; const s = i / peaks.length * dur;
      ctx.fillStyle = s >= start && s <= end ? "#f08068" : "#4a4d55"; ctx.fillRect(x, h / 2 - p * h / 2, w / peaks.length - 1, p * h); });
    ctx.fillStyle = "#fff"; ctx.fillRect((t / dur) * w, 0, 2, h);
  }, [peaks, start, end, t, dur]);

  const seek = (e) => { const r = e.currentTarget.getBoundingClientRect(); if (audioRef.current && dur) audioRef.current.currentTime = ((e.clientX - r.left) / r.width) * dur; };
  if (!url) return <div className="h-16 flex items-center justify-center text-xs text-muted-foreground">Add a lead vocal to see its waveform</div>;
  return <canvas ref={canvas} onClick={seek} className="w-full h-16 cursor-pointer" aria-label="Vocal waveform, click to seek" />;
}