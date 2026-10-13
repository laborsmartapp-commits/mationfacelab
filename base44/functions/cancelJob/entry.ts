import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { runpod, ACTIVE } from '../../shared/runpod.ts';

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const { job_id } = await req.json();
    const job = await base44.entities.GenerationJob.get(job_id);
    if (!job || (job.created_by_id !== user.id && user.role !== 'admin')) return Response.json({ error: 'Not found' }, { status: 404 });
    if (!ACTIVE.includes(job.status)) return Response.json({ job });
    if (job.runpod_job_id) await runpod(`cancel/${job.runpod_job_id}`, 'POST').catch(() => null);
    return Response.json({ job: await base44.entities.GenerationJob.update(job.id, { status: 'cancelled' }) });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}