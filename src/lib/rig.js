// Character rig analysis + channel grouping shared by viewport playback and UI.
export const GROUPS = ["jaw", "mouth", "smile", "brows", "cheeks", "blink", "gaze", "head"];

export function groupOf(name) {
  const n = name.toLowerCase();
  if (n.includes("jaw")) return "jaw";
  if (n.includes("smile")) return "smile";
  if (n.includes("brow")) return "brows";
  if (n.includes("cheek")) return "cheeks";
  if (n.includes("blink") || n.includes("squint") || n.includes("eyewide")) return "blink";
  if (n.includes("eyelook")) return "gaze";
  if (n.includes("mouth") || n.includes("lip") || n.includes("tongue")) return "mouth";
  return null;
}

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/^(blendshape\d*|bs|arkit)/, "");

export function analyzeScene(scene) {
  const morphs = new Set();
  const bones = [];
  const meshNames = [];
  scene.traverse((o) => {
    if (o.isBone) bones.push(o.name);
    if (o.isMesh) {
      meshNames.push(o.name);
      Object.keys(o.morphTargetDictionary || {}).forEach((k) => morphs.add(k));
    }
  });
  const morphList = [...morphs];
  const facial = morphList.filter((m) => groupOf(m));
  const sided = facial.filter((m) => /left|right|_l$|_r$/i.test(m));
  const headBone = bones.find((b) => /head/i.test(b) && !/end|top/i.test(b)) || null;
  const jawBone = bones.find((b) => /jaw/i.test(b)) || null;
  const hasTeeth = meshNames.some((n) => /teeth|tooth/i.test(n));
  const hasJawMorph = facial.some((m) => groupOf(m) === "jaw");
  let readiness = "missing";
  if (facial.length >= 30 && hasJawMorph) readiness = "ready";
  else if (facial.length > 0 || jawBone) readiness = "partial";
  return {
    morph_count: morphList.length, facial_controls: facial, sided_count: sided.length,
    bone_count: bones.length, head_bone: headBone, jaw_bone: jawBone, has_teeth: hasTeeth,
    jaw_driver: hasJawMorph ? "morph" : jawBone ? "bone" : "none", readiness, morphs: morphList,
  };
}

// Map Audio2Face output channel names onto the character's real morph targets.
export function buildMapping(channelNames, morphs) {
  const index = Object.fromEntries(morphs.map((m) => [norm(m), m]));
  const mapping = {}; const missing = [];
  channelNames.forEach((c) => { const hit = index[norm(c)]; hit ? (mapping[c] = hit) : missing.push(c); });
  return { mapping, missing };
}

export const TAKE_STYLES = {
  raw: { label: "Model output", gains: {} },
  intimate: { label: "Intimate", gains: { jaw: 0.85, smile: 0.7, brows: 0.8, head: 0.5 } },
  expressive: { label: "Expressive", gains: { brows: 1.35, cheeks: 1.25, smile: 1.15, head: 1 } },
  stage: { label: "Stage", gains: { jaw: 1.1, brows: 1.5, cheeks: 1.4, smile: 1.25, head: 1.6 } },
};