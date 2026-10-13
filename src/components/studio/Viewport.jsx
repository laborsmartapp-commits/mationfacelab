import { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { groupOf } from "@/lib/rig";

// Deterministic evaluator: pose(t) = rest + mapped A2F frame * take/layer gains (+ head layer offset from rest).
export function layerGain(layers, group, t) {
  let g = 1;
  for (const l of layers || []) if (l.group === group && t >= l.start && t <= l.end) g *= l.gain;
  return g;
}

export default function Viewport({ url, onLoaded, animation, mapping, takeGains, layers, audioRef, offset = 0, view }) {
  const mount = useRef(null);
  const state = useRef({});
  state.current.props = { animation, mapping, takeGains, layers, audioRef, offset };

  useEffect(() => {
    const el = mount.current;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene(); scene.background = new THREE.Color("#141518");
    const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 1000);
    const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true;
    scene.add(new THREE.HemisphereLight("#fff4ec", "#202024", 1.4));
    const key = new THREE.DirectionalLight("#ffd9c9", 2.2); key.position.set(2, 3, 4); scene.add(key);
    const rim = new THREE.DirectionalLight("#9fb8ff", 1.2); rim.position.set(-3, 2, -3); scene.add(rim);
    Object.assign(state.current, { renderer, scene, camera, controls });

    const resize = () => { const { clientWidth: w, clientHeight: h } = el; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); };
    const ro = new ResizeObserver(resize); ro.observe(el); resize();

    let raf;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const s = state.current; const p = s.props;
      if (s.meshes && p.animation && p.audioRef?.current) {
        const t = p.audioRef.current.currentTime - p.offset - (p.animation.time_origin || 0);
        const f = Math.max(0, Math.min(p.animation.frames.length - 1, Math.floor(t * p.animation.fps)));
        const frame = p.animation.frames[f] || [];
        p.animation.channels.forEach((c, i) => {
          const target = p.mapping?.[c]; if (!target) return;
          const grp = groupOf(c);
          const v = Math.min(1, frame[i] * (p.takeGains?.[grp] ?? 1) * layerGain(p.layers, grp, t + (p.animation.time_origin || 0)));
          s.meshes.forEach((m) => { const idx = m.morphTargetDictionary[target]; if (idx !== undefined) m.morphTargetInfluences[idx] = v; });
        });
        if (s.head && s.headRest) {
          const deg = layerGain(p.layers, "head", t) - 1; // head layer: gain-1 → pitch offset, applied to clean rest each frame
          s.head.quaternion.copy(s.headRest).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(deg * 0.25, 0, 0)));
        }
      }
      controls.update(); renderer.render(scene, camera);
    };
    tick();
    return () => { cancelAnimationFrame(raf); ro.disconnect(); renderer.dispose(); el.innerHTML = ""; };
  }, []);

  useEffect(() => {
    const s = state.current; if (!url) return;
    let alive = true;
    new GLTFLoader().load(url, (gltf) => {
      if (!alive) return;
      if (s.model) { s.scene.remove(s.model); s.model.traverse((o) => { o.geometry?.dispose(); }); }
      s.model = gltf.scene; s.scene.add(gltf.scene);
      s.meshes = []; gltf.scene.traverse((o) => { if (o.isMesh && o.morphTargetDictionary) s.meshes.push(o); if (o.isBone && /head/i.test(o.name) && !s.head) s.head = o; });
      if (s.head) s.headRest = s.head.quaternion.clone();
      const box = new THREE.Box3().setFromObject(gltf.scene); s.box = box;
      frame("front");
      onLoaded?.(gltf.scene);
    });
    return () => { alive = false; };
  }, [url]);

  const frame = (v) => {
    const s = state.current; if (!s.box) return;
    const size = s.box.getSize(new THREE.Vector3()); const c = s.box.getCenter(new THREE.Vector3());
    const face = v === "face"; const target = face ? new THREE.Vector3(c.x, s.box.max.y - size.y * 0.08, c.z) : c;
    const d = face ? size.y * 0.5 : size.y * 1.9;
    const dir = { front: [0, 0, 1], face: [0, 0, 1], three: [0.7, 0, 0.7], side: [1, 0, 0] }[v] || [0, 0, 1];
    s.camera.position.set(target.x + dir[0] * d, target.y, target.z + dir[2] * d);
    s.controls.target.copy(target); s.camera.near = d / 100; s.camera.updateProjectionMatrix();
  };
  useEffect(() => { if (view) frame(view.name); }, [view]);

  return <div ref={mount} className="w-full h-full" aria-label="3D character viewport" />;
}