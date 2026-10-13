import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { runpod } from '../../shared/runpod.ts';

// Admin-only GPU checks. The self-test runs async (first run on a new GPU builds TensorRT engines and can take minutes):
// {test: true} submits it, {poll: id} reads it. inference_ok is true only when the worker itself confirms the
// model + solver processed real audio and returned frames.
export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });
    const { test, poll, diagnose } = await req.json().catch(() => ({}));
    if (poll) {
      const r = await runpod(`status/${encodeURIComponent(poll)}`);
      const out = r.output || {};
      const done = ['COMPLETED', 'FAILED', 'CANCELLED', 'TIMED_OUT'].includes(r.status);
      const ok = r.status === 'COMPLETED' && out.inference_ok === true && out.channels?.length > 0 && out.frames?.length > 0;
      return Response.json({
        done, status: r.status, inference_ok: done ? ok : null, progress: done ? undefined : out,
        channels: out.channels?.length, frames: out.frames?.length, fps: out.fps, sample_channels: out.channels?.slice(0, 8),
        self_test: out.self_test, timing: out.timing, model_info: out.model_info, diagnose: out.channels ? undefined : (done ? out : undefined),
        error: r.error, execution_ms: r.executionTime,
      });
    }
    const health = await runpod('health');
    if (test || diagnose) {
      const r = await runpod('run', 'POST', { input: diagnose ? { diagnose: true } : { self_test: true } });
      return Response.json({ configured: true, health, submitted: r.id });
    }
    return Response.json({ configured: true, health });
  } catch (error) {
    return Response.json({ configured: false, error: error.message }, { status: 200 });
  }
}