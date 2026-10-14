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
      const moving = out.ranges ? Object.values(out.ranges).filter(([lo, hi]) => hi - lo > 1e-3).length : 0;
      const ok = r.status === 'COMPLETED' && out.inference_ok === true && out.channels?.length > 0 && out.frames?.length > 0 && moving > 0;
      return Response.json({
        done, status: r.status, inference_ok: done ? ok : null, progress: done ? undefined : out,
        channels: out.channels?.length, frames: out.frames?.length, fps: out.fps, moving_channels: moving, sample_channels: out.channels?.slice(0, 8),
        self_test: out.self_test, timing: out.timing, model_info: out.model_info, diagnose: out.channels ? undefined : (done ? out : undefined),
        error: r.error, execution_ms: r.executionTime,
      });
    }
    const health = await runpod('health');
    if (test || diagnose) {
      let input = { diagnose: true }, audio_url;
      if (!diagnose) {
        // Real hosted audio through the same audio_url path production jobs use (private file + short-lived signed URL).
        const { url } = await base44.asServiceRole.integrations.Core.GenerateSpeech({ text: 'La la la, I can hear the music playing. Sing it with me, oh oh oh, all night long.', voice: 'sunny' });
        const file = new File([await (await fetch(url)).arrayBuffer()], 'a2f-test.mp3', { type: 'audio/mpeg' });
        const { file_uri } = await base44.asServiceRole.integrations.Core.UploadPrivateFile({ file });
        ({ signed_url: audio_url } = await base44.asServiceRole.integrations.Core.CreateFileSignedUrl({ file_uri, expires_in: 3600 }));
        input = { audio_url, range_start: 0, range_end: 3, model: 'audio2face-3d-v3.0', emotion: 'audio2emotion', output: 'blendshapes', job_ref: 'admin-test' };
      }
      const r = await runpod('run', 'POST', { input });
      return Response.json({ configured: true, health, submitted: r.id, test_audio: audio_url ? 'private file, signed URL valid 1 hour' : undefined });
    }
    return Response.json({ configured: true, health });
  } catch (error) {
    return Response.json({ configured: false, error: error.message }, { status: 200 });
  }
}