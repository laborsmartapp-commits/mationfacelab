import { secrets } from 'base44:runtime';

export async function runpod(path, method = 'GET', body = undefined, timeout = 20000) {
  const key = secrets.get('RUNPOD_API_KEY');
  const endpoint = secrets.get('RUNPOD_ENDPOINT_ID');
  if (!key || !endpoint || endpoint === 'pending') throw new Error('Audio2Face GPU endpoint is not configured yet. An administrator must set the RunPod endpoint ID.');
  const res = await fetch(`https://api.runpod.ai/v2/${endpoint}/${path}`, {
    method, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeout),
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 300) }; }
  if (!res.ok) throw new Error(`RunPod ${res.status}: ${data.error || data.raw || 'request failed'}${res.status === 401 ? ' (check the key has access to this endpoint)' : ''}`);
  return data;
}

export const ACTIVE = ['preparing', 'queued', 'generating', 'mapping'];