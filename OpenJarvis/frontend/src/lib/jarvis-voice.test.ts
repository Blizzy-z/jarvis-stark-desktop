import { afterEach, describe, expect, it, vi } from 'vitest';
import { qwenSpeech } from './jarvis-voice';
afterEach(() => vi.unstubAllGlobals());
describe('Qwen voice bridge', () => {
  it('fetches only the audio belonging to the generated request', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ url: 'https://untrusted.invalid/' })))
      .mockResolvedValueOnce(new Response(new Blob(['RIFF'])));
    vi.stubGlobal('fetch', fetcher);
    const audio = await qwenSpeech('Ready, sir.');
    const request = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(request.reference).toBe('auto');
    expect(fetcher.mock.calls[1][0]).toBe(`/api/speech/audio/${request.id}`);
    expect(await audio.text()).toBe('RIFF');
  });
  it('cancels backend generation when playback is stopped', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn().mockImplementation((url, opts) => {
      if (url === '/api/speech/cancel') return Promise.resolve(new Response('{}'));
      return new Promise((_resolve, reject) => opts.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))));
    });
    vi.stubGlobal('fetch', fetcher);
    const pending = qwenSpeech('Ready, sir.', controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow('Aborted');
    const request = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(fetcher.mock.calls[1][0]).toBe('/api/speech/cancel');
    expect(JSON.parse(fetcher.mock.calls[1][1].body).id).toBe(request.id);
  });
  it('surfaces synthesis errors without attempting playback', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Voice model unavailable' }), { status: 503 }));
    vi.stubGlobal('fetch', fetcher);
    await expect(qwenSpeech('Hello')).rejects.toThrow('Voice model unavailable');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
