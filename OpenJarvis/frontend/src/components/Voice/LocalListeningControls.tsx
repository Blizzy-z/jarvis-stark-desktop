'use client';
import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, RefreshCw, Square } from 'lucide-react';

type Config = { wakeThreshold: number; silenceMs: number; speechRms: number; maxRecordingSeconds: number };
const defaults: Config = { wakeThreshold: 0.5, silenceMs: 1100, speechRms: 0.012, maxRecordingSeconds: 20 };
function pcm64(frames: Int16Array[]) {
  const bytes = new Uint8Array(frames.reduce((size, frame) => size + frame.byteLength, 0));
  let offset = 0;
  for (const frame of frames) { bytes.set(new Uint8Array(frame.buffer, frame.byteOffset, frame.byteLength), offset); offset += frame.byteLength; }
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}

export function LocalListeningControls({ visible, busy, onPrompt }: { visible: boolean; busy: boolean; onPrompt: (text: string) => void }) {
  const [wakeEnabled, setWakeEnabled] = useState(false);
  const [phase, setPhase] = useState('off');
  const [error, setError] = useState('');
  const [transcript, setTranscript] = useState('');
  const [threshold, setThreshold] = useState(0.5);
  const [device, setDevice] = useState('default');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [testMode, setTestMode] = useState('wake');
  const [wakeScore, setWakeScore] = useState<number | null>(null);
  const [outputBlocked, setOutputBlocked] = useState(false);
  const [inputLevel, setInputLevel] = useState(0);
  const [inputName, setInputName] = useState('');
  const [liveWakeScore, setLiveWakeScore] = useState(0);
  const [captureState, setCaptureState] = useState('closed');
  const lastFrame = useRef(0);
  const lastMeter = useRef(0);
  const scorePeak = useRef({ value: 0, time: 0 });
  const captureWatchdog = useRef<ReturnType<typeof setInterval> | null>(null);
  const worklet = useRef<AudioWorkletNode | null>(null);
  const config = useRef<Config>(defaults);
  const thresholdRef = useRef(threshold); thresholdRef.current = threshold;
  const wakeRef = useRef(false);
  const phaseRef = useRef('off');
  const busyRef = useRef(busy); busyRef.current = busy;
  const onPromptRef = useRef(onPrompt); onPromptRef.current = onPrompt;
  const speaking = useRef(false);
  const resumeAt = useRef(0);
  const generation = useRef(0);
  const stream = useRef<MediaStream | null>(null);
  const context = useRef<AudioContext | null>(null);
  const session = useRef<string | null>(null);
  const heartbeat = useRef<ReturnType<typeof setInterval> | null>(null);
  const frames = useRef<Int16Array[]>([]);
  const wakeFrames = useRef<Int16Array[]>([]);
  const preRoll = useRef<Int16Array[]>([]);
  const detecting = useRef(false);
  const startedAt = useRef(0);
  const lastSpeech = useRef(0);
  const heardSpeech = useRef(false);
  const changePhase = (value: string) => { phaseRef.current = value; setPhase(value); window.dispatchEvent(new CustomEvent('jarvis:listening', { detail: { phase: value } })); };

  async function api(action: string, body: object = {}, token = session.current) {
    const res = await fetch(`/api/listening/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, session: token }) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Local listening failed');
    return data;
  }
  async function release() {
    generation.current++;
    if (heartbeat.current) clearInterval(heartbeat.current); heartbeat.current = null;
    if (captureWatchdog.current) clearInterval(captureWatchdog.current); captureWatchdog.current = null;
    if (worklet.current) { worklet.current.port.onmessage = null; worklet.current.disconnect(); worklet.current = null; }
    stream.current?.getTracks().forEach(track => { track.onended = null; track.stop(); }); stream.current = null;
    const ctx = context.current; context.current = null; void ctx?.close().catch(() => {});
    frames.current = []; wakeFrames.current = []; preRoll.current = []; detecting.current = false;
    const token = session.current; session.current = null;
    changePhase('off');
    setInputLevel(0); setCaptureState('closed');
    if (token) await api('stop', {}, token).catch(() => {});
  }
  function record() {
    frames.current = [...preRoll.current]; wakeFrames.current = [];
    startedAt.current = Date.now(); lastSpeech.current = Date.now(); heardSpeech.current = false;
    changePhase('recording');
  }
  async function finish() {
    if (phaseRef.current !== 'recording') return;
    const audio = frames.current; frames.current = [];
    if (!heardSpeech.current) { if (wakeRef.current) changePhase('armed'); else await release(); return; }
    const version = generation.current;
    changePhase('transcribing');
    try {
      const result = await api('transcribe', { pcm: pcm64(audio) });
      if (version !== generation.current) return;
      const text = String(result.text).replace(/^\s*(?:hey[,.]?\s+)?jarvis\b[\s,.!?]*/i, '').trim();
      setTranscript(text);
      if (wakeRef.current) { await api('reset'); changePhase('armed'); } else await release();
      resumeAt.current = Date.now() + 1000;
      if (text && !busyRef.current) { window.dispatchEvent(new Event('jarvis:text-console')); onPromptRef.current(text); }
    } catch (reason) {
      if (version !== generation.current) return;
      setError(String(reason)); await release(); wakeRef.current = false; setWakeEnabled(false);
    }
  }
  function consume(frame: Int16Array) {
    const now = Date.now();
    lastFrame.current = now;
    const rms = Math.sqrt(frame.reduce((sum, value) => sum + (value / 32768) ** 2, 0) / frame.length);
    if (now - lastMeter.current > 200) { setInputLevel(rms); lastMeter.current = now; }
    if (speaking.current || busyRef.current || now < resumeAt.current) {
      wakeFrames.current = []; preRoll.current = []; return;
    }
    preRoll.current.push(frame); if (preRoll.current.length > 8) preRoll.current.shift();
    if (phaseRef.current === 'recording') {
      frames.current.push(frame);
      if (rms > config.current.speechRms) { lastSpeech.current = now; heardSpeech.current = true; }
      if ((heardSpeech.current && now - lastSpeech.current > config.current.silenceMs) || now - startedAt.current > (heardSpeech.current ? config.current.maxRecordingSeconds * 1000 : 6000)) void finish();
    } else if (wakeRef.current && phaseRef.current === 'armed') {
      wakeFrames.current.push(frame);
      if (wakeFrames.current.length > 12) wakeFrames.current.shift();
      if (wakeFrames.current.length < 4 || detecting.current) return;
      const chunk = wakeFrames.current.splice(0, 4); detecting.current = true;
      const version = generation.current;
      void api('wake', { pcm: pcm64(chunk), threshold: thresholdRef.current }).then(result => {
        if (version !== generation.current) return;
        if (result.score >= scorePeak.current.value || Date.now() - scorePeak.current.time > 4000) scorePeak.current = { value: result.score, time: Date.now() };
        setLiveWakeScore(scorePeak.current.value);
        if (version === generation.current && result.detected && phaseRef.current === 'armed' && !busyRef.current && !speaking.current && Date.now() >= resumeAt.current) record();
      }).catch(async reason => { if (version === generation.current) { setError(String(reason)); await release(); wakeRef.current = false; setWakeEnabled(false); } })
        .finally(() => { if (version === generation.current) detecting.current = false; });
    }
  }
  async function refreshDevices(requestPermission = false) {
    let temporary: MediaStream | null = null;
    try {
      if (requestPermission && !stream.current) temporary = await navigator.mediaDevices.getUserMedia({ audio: true });
      setDevices((await navigator.mediaDevices.enumerateDevices()).filter(item => item.kind === 'audioinput'));
    } finally { temporary?.getTracks().forEach(track => track.stop()); }
  }
  async function begin(wake: boolean, selectedDevice = device) {
    setError('');
    const cancelled = release();
    const version = generation.current;
    await cancelled;
    if (version !== generation.current) return;
    changePhase('permission');
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true, ...(selectedDevice !== 'default' ? { deviceId: { exact: selectedDevice } } : {}) } });
      if (version !== generation.current) { media.getTracks().forEach(track => track.stop()); return; }
      stream.current = media;
      setInputName(media.getAudioTracks()[0].label || 'Default microphone');
      setLiveWakeScore(0); scorePeak.current = { value: 0, time: 0 };
      changePhase('starting');
      media.getAudioTracks()[0].onended = () => { void release(); wakeRef.current = false; setWakeEnabled(false); };
      setDevices((await navigator.mediaDevices.enumerateDevices()).filter(item => item.kind === 'audioinput'));
      if (version !== generation.current) return;
      session.current = crypto.randomUUID();
      await api('start');
      if (version !== generation.current) return;
      const ctx = new AudioContext({ sampleRate: 16000 }); context.current = ctx;
      ctx.onstatechange = () => { if (context.current === ctx) setCaptureState(ctx.state); };
      if (ctx.sampleRate !== 16000) throw new Error('Microphone audio must be resampled to 16000 Hz');
      await ctx.audioWorklet.addModule('/local-microphone.js');
      if (version !== generation.current) return;
      const node = new AudioWorkletNode(ctx, 'local-microphone');
      worklet.current = node;
      node.onprocessorerror = () => { if (version === generation.current) { setError('Microphone audio processor failed. Select the microphone again.'); void release(); wakeRef.current = false; setWakeEnabled(false); } };
      const silence = ctx.createGain(); silence.gain.value = 0;
      ctx.createMediaStreamSource(media).connect(node); node.connect(silence); silence.connect(ctx.destination);
      node.port.onmessage = event => consume(new Int16Array(event.data));
      await ctx.resume();
      if (version !== generation.current) return;
      setCaptureState(ctx.state); lastFrame.current = Date.now();
      captureWatchdog.current = setInterval(() => {
        if (version !== generation.current) return;
        if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
        if (Date.now() - lastFrame.current > 5000) {
          setError('No audio frames received from this microphone. Choose another input.');
          void release(); wakeRef.current = false; setWakeEnabled(false);
        }
      }, 1000);
      heartbeat.current = setInterval(() => { void api('heartbeat').catch(async reason => { if (version !== generation.current) return; setError(String(reason)); await release(); wakeRef.current = false; setWakeEnabled(false); }); }, 15000);
      if (wake) changePhase('armed'); else record();
    } catch (reason) {
      if (version !== generation.current) return;
      setError(String(reason)); await release(); wakeRef.current = false; setWakeEnabled(false);
    }
  }
  async function testRecording(file: File) {
    if (file.size > 10 * 1024 * 1024) { setError('Use an audio recording under 10 MB and 30 seconds'); return; }
    setError(''); setWakeScore(null);
    wakeRef.current = false; setWakeEnabled(false); await release();
    const version = generation.current;
    changePhase('transcribing');
    try {
      const decoder = new OfflineAudioContext(1, 16000, 16000);
      const decoded = await decoder.decodeAudioData(await file.arrayBuffer());
      if (decoded.duration > 30) throw new Error('Use a recording no longer than 30 seconds');
      const render = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000);
      const source = render.createBufferSource(); source.buffer = decoded; source.connect(render.destination); source.start();
      const buffer = await render.startRendering();
      const values = buffer.getChannelData(0);
      const pcm = new Int16Array(Math.ceil(values.length / 1280) * 1280);
      for (let i = 0; i < values.length; i++) pcm[i] = Math.round(Math.max(-1, Math.min(1, values[i])) * 32767);
      if (version !== generation.current) return;
      session.current = crypto.randomUUID(); await api('start');
      let detected = testMode !== 'wake', score = 0;
      if (testMode === 'wake') {
        for (let offset = 0; offset < pcm.length; offset += 5120) {
          if (version !== generation.current) return;
          const result = await api('wake', { pcm: pcm64([pcm.subarray(offset, Math.min(offset + 5120, pcm.length))]), threshold: thresholdRef.current });
          score = Math.max(score, result.score); detected ||= result.detected;
        }
        setWakeScore(score);
      }
      if (!detected) throw new Error('Hey Jarvis was not detected in this recording');
      const result = await api('transcribe', { pcm: pcm64([pcm]) });
      if (version !== generation.current) return;
      const text = String(result.text).replace(/^\s*(?:hey[,.]?\s+)?jarvis\b[\s,.!?]*/i, '').trim();
      setTranscript(text); await release();
      if (text && !busyRef.current) onPromptRef.current(text);
    } catch (reason) { if (version === generation.current) { setError(String(reason)); await release(); } }
  }
  useEffect(() => {
    const savedDevice = localStorage.getItem('jarvis_microphone_device');
    if (savedDevice) setDevice(savedDevice);
    const deviceChanged = () => { void refreshDevices().catch(reason => setError(String(reason))); };
    void refreshDevices().catch(reason => setError(String(reason)));
    navigator.mediaDevices?.addEventListener('devicechange', deviceChanged);
    fetch('/api/listening/status').then(res => res.json()).then(data => { config.current = { ...defaults, ...data }; setThreshold(data.wakeThreshold || 0.5); }).catch(() => {});
    const onVoice = (event: Event) => {
      const phase = (event as CustomEvent).detail?.phase;
      if (!phase) return;
      const blocked = phase === 'generating' || phase === 'playing';
      setOutputBlocked(blocked);
      if (blocked && phaseRef.current === 'recording') {
        frames.current = [];
        if (wakeRef.current) changePhase('armed'); else void release();
      }
      if (speaking.current && !blocked) {
        resumeAt.current = Date.now() + 1000; preRoll.current = []; wakeFrames.current = [];
        if (session.current) void api('reset').catch(() => {});
      }
      speaking.current = blocked;
    };
    window.addEventListener('jarvis:local-voice', onVoice);
    return () => { navigator.mediaDevices?.removeEventListener('devicechange', deviceChanged); window.removeEventListener('jarvis:local-voice', onVoice); void release(); };
  }, []);

  return <div className={visible ? 'border-t border-cyan-900 pt-3 mt-3 space-y-2' : 'hidden'} aria-label="Local microphone controls">
    <div className="flex flex-wrap items-center gap-3 text-xs">
      <button type="button" aria-label={phase === 'recording' ? 'Finish recording' : 'Talk to Jarvis'} title={phase === 'recording' ? 'Finish recording' : 'Talk to Jarvis'} disabled={busy || phase === 'permission' || phase === 'starting' || phase === 'transcribing' || outputBlocked} onClick={() => { if (phase === 'recording') void finish(); else if (session.current) record(); else void begin(false); }} className="border border-cyan-800 p-2 disabled:opacity-40">{phase === 'recording' ? <Square size={18} /> : <Mic size={18} />}</button>
      <label className="flex items-center gap-2"><input type="checkbox" aria-label="Hey Jarvis wake word" checked={wakeEnabled} onChange={event => { const enabled = event.target.checked; wakeRef.current = enabled; setWakeEnabled(enabled); if (enabled) void begin(true); else void release(); }} />Hey Jarvis</label>
      <button type="button" aria-label="Stop microphone" title="Stop microphone" onClick={() => { wakeRef.current = false; setWakeEnabled(false); void release(); }} className="border border-cyan-800 p-2"><MicOff size={16} /></button>
      <label className="flex items-center gap-2">Wake threshold<input aria-label="Wake detection threshold" type="number" min="0.1" max="0.95" step="0.05" value={threshold} onChange={event => setThreshold(Number(event.target.value))} className="w-20 bg-black border border-cyan-800 p-1" /></label>
    </div>
    <div className="flex gap-2"><select aria-label="Microphone device" disabled={phase === 'permission' || phase === 'starting' || phase === 'transcribing'} value={device} onChange={event => { const selected = event.target.value; setDevice(selected); localStorage.setItem('jarvis_microphone_device', selected); if (stream.current) void begin(wakeRef.current, selected); }} className="min-w-0 flex-1 bg-black border border-cyan-800 p-1 text-xs"><option value="default">Default microphone</option>{device !== 'default' && !devices.some(item => item.deviceId === device) && <option value={device}>Saved microphone (unavailable)</option>}{devices.filter(item => item.deviceId && item.deviceId !== 'default').map((item, index) => <option key={item.deviceId} value={item.deviceId}>{item.label || `Microphone ${index + 1}`}</option>)}</select><button type="button" aria-label="Refresh microphones" title="Refresh microphones" onClick={() => void refreshDevices(true).catch(reason => setError(String(reason)))} className="border border-cyan-800 p-2"><RefreshCw size={14} /></button></div>
    <div className="flex items-center gap-2 text-xs text-cyan-500"><meter aria-label="Microphone input level" min={0} max={0.15} value={inputLevel} className="w-24 h-3 shrink-0" /><span className="min-w-0 break-words">{inputName || 'No input selected'} / {captureState} / wake {liveWakeScore.toFixed(3)}</span></div>
    <div role="status" aria-label="Microphone status" className="text-xs text-cyan-400 break-words">{error || (phase === 'armed' ? busy || outputBlocked ? 'Listening paused' : 'Hey Jarvis armed' : phase === 'recording' ? 'Listening' : phase === 'transcribing' ? 'Transcribing locally' : phase === 'permission' ? 'Waiting for microphone permission' : phase === 'starting' ? 'Starting local microphone' : 'Microphone off')}</div>
    {transcript && <div aria-label="Last voice transcript" className="text-xs text-white/70 break-words">{transcript}</div>}
    <details className="text-xs"><summary className="cursor-pointer text-cyan-500">Audio test</summary><div className="flex flex-wrap gap-2 mt-2"><select aria-label="Audio recording test mode" value={testMode} onChange={event => setTestMode(event.target.value)} className="bg-black border border-cyan-800 p-1"><option value="wake">Wake + command</option><option value="transcribe">Command only</option></select><input aria-label="Test voice recording" type="file" accept="audio/*" disabled={busy || phase !== 'off'} className="min-w-0 max-w-full" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void testRecording(file); }} /></div>{wakeScore !== null && <div aria-label="Wake test score" className="mt-1 text-cyan-500">Wake score: {wakeScore.toFixed(3)}</div>}</details>
  </div>;
}
