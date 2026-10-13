import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { runpod } from '../../shared/runpod.ts';

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });
    const { test } = await req.json().catch(() => ({}));
    const health = await runpod('health');
    if (!test) return Response.json({ configured: true, health });
    // Real inference: the worker synthesizes a short built-in test clip and must return dense model output.
    const r = await runpod('runsync', 'POST', { input: { self_test: true } }, 120000);
    const out = r.output || {};
    const ok = r.status === 'COMPLETED' && Array.isArray(out.channels) && out.frames?.length > 0;
    return Response.json({ inference_ok: ok, status: r.status, channels: out.channels?.length, frames: out.frames?.length, model_info: out.model_info, error: r.error, execution_ms: r.executionTime });
  } catch (error) {
    return Response.json({ configured: false, error: error.message }, { status: 200 });
  }
}