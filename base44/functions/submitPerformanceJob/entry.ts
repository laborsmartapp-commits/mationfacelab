import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { runpod, ACTIVE } from '../../shared/runpod.ts';

const MAX_CONCURRENT = 2;
const MAX_PER_DAY = 20;

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const { project_id, kind } = await req.json();
    if (!['preview', 'full'].includes(kind)) return Response.json({ error: 'Invalid kind' }, { status: 400 });
    const project = await base44.entities.Project.get(project_id);
    if (!project || project.created_by_id !== user.id) return Response.json({ error: 'Not found' }, { status: 404 });
    if (!project.vocal_uri) return Response.json({ error: 'Add a lead vocal first.' }, { status: 400 });

    const start = kind === 'preview' ? Number(project.preview_start) : 0;
    const end = kind === 'preview' ? Number(project.preview_end) : Number(project.duration || 0);
    if (!(end > start) || (kind === 'preview' && end - start > 30)) return Response.json({ error: 'Choose a preview range up to 30 seconds.' }, { status: 400 });

    const key = `${project_id}:${kind}:${start}:${end}:${project.vocal_uri}`;
    const mine = { created_by_id: user.id };
    const dup = await base44.entities.GenerationJob.filter({ ...mine, idempotency_key: key, status: { $in: ACTIVE } }, { limit: 1 });
    if (dup.items.length) return Response.json({ job: dup.items[0], duplicate: true });

    if (user.role !== 'admin') {
      const running = await base44.entities.GenerationJob.count({ ...mine, status: { $in: ACTIVE } });
      if (running >= MAX_CONCURRENT) return Response.json({ error: `You already have ${running} jobs running. Wait for one to finish.` }, { status: 429 });
      const today = await base44.entities.GenerationJob.count({ ...mine, created_date: { $gte: new Date(Date.now() - 864e5).toISOString() } });
      if (today >= MAX_PER_DAY) return Response.json({ error: 'Daily generation limit reached.' }, { status: 429 });
    }

    const job = await base44.entities.GenerationJob.create({ project_id, kind, status: 'preparing', idempotency_key: key, range_start: start, range_end: end });
    try {
      // Long-lived signed link so queued jobs don't hit expiry; only the vocal leaves the app, never the character.
      const { signed_url } = await base44.asServiceRole.integrations.Core.CreateFileSignedUrl({ file_uri: project.vocal_uri, expires_in: 21600 });
      const run = await runpod('run', 'POST', {
        input: { audio_url: signed_url, range_start: start, range_end: end, model: 'audio2face-3d-v3.0', emotion: 'audio2emotion', output: 'blendshapes', job_ref: job.id },
      });
      const updated = await base44.entities.GenerationJob.update(job.id, { status: 'queued', runpod_job_id: run.id });
      return Response.json({ job: updated });
    } catch (e) {
      await base44.entities.GenerationJob.update(job.id, { status: 'failed', error: e.message });
      return Response.json({ error: e.message }, { status: 502 });
    }
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}