import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { runpod, ACTIVE } from '../../shared/runpod.ts';

const MAP = { IN_QUEUE: 'queued', IN_PROGRESS: 'generating', COMPLETED: 'mapping', FAILED: 'failed', CANCELLED: 'cancelled', TIMED_OUT: 'failed' };

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const { job_id } = await req.json();
    const job = await base44.entities.GenerationJob.get(job_id);
    if (!job || (job.created_by_id !== user.id && user.role !== 'admin')) return Response.json({ error: 'Not found' }, { status: 404 });
    if (!ACTIVE.includes(job.status) || !job.runpod_job_id) return Response.json({ job });

    const s = await runpod(`status/${job.runpod_job_id}`);
    const status = MAP[s.status] || job.status;
    if (status === 'failed') return Response.json({ job: await base44.entities.GenerationJob.update(job.id, { status, error: String(s.error || 'Worker failed').slice(0, 500) }) });
    if (status !== 'mapping') return Response.json({ job: await base44.entities.GenerationJob.update(job.id, { status }) });

    // Validate worker output schema before persisting.
    const out = s.output || {};
    if (!Array.isArray(out.channels) || !Array.isArray(out.frames) || !out.fps) {
      return Response.json({ job: await base44.entities.GenerationJob.update(job.id, { status: 'failed', error: 'Worker returned output without channels/frames/fps.' }) });
    }
    const fresh = await base44.entities.GenerationJob.get(job.id);
    if (fresh.status === 'cancelled') return Response.json({ job: fresh }); // late completion after cancel is harmless

    const animation = { schema: 'mationfacelab.a2f.v1', channels: out.channels, fps: out.fps, frames: out.frames, time_origin: job.range_start, duration: out.frames.length / out.fps, model_info: out.model_info || null, ranges: out.ranges || null };
    const file = new File([JSON.stringify(animation)], `a2f-${job.id}.json`, { type: 'application/json' });
    const { file_uri } = await base44.asServiceRole.integrations.Core.UploadPrivateFile({ file });
    await base44.entities.Take.bulkCreate(['raw', 'intimate', 'expressive', 'stage'].map((style) => ({
      project_id: job.project_id, style, label: style, job_id: job.id, animation_uri: file_uri, range_start: job.range_start, range_end: job.range_end,
    })));
    const updated = await base44.entities.GenerationJob.update(job.id, { status: 'ready', result_uri: file_uri, model_info: out.model_info || {}, execution_ms: s.executionTime });
    return Response.json({ job: updated });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}