export async function qwenHealth() {
  const response = await fetch('/api/speech/status');
  if (!response.ok) return { available: false };
  const status = await response.json();
  return { available: true, backend: status.backend, voice_id: 'Jarvis (auto)' };
}

export async function qwenSpeech(text: string, signal?: AbortSignal): Promise<Blob> {
  const id = crypto.randomUUID();
  const cancel = () => { void fetch('/api/speech/cancel', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }), keepalive: true,
  }).catch(() => {}); };
  signal?.throwIfAborted();
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    const response = await fetch('/api/speech/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, text, reference: 'auto' }), signal,
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Qwen speech generation failed');
    signal?.throwIfAborted();
    const audio = await fetch(`/api/speech/audio/${id}`, { signal });
    if (!audio.ok) throw new Error('Generated speech could not be loaded');
    return await audio.blob();
  } finally {
    signal?.removeEventListener('abort', cancel);
  }
}
