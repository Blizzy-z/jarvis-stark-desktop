import { useCloud } from '../../lib/cloud';
import { BrowserVoice } from './BrowserVoice';
import { useEffect, useState } from 'react';
import { Volume2, Square } from 'lucide-react';
import { LocalListeningControls } from './LocalListeningControls';
import { useAppStore } from '../../lib/store';
import { useTts } from '../../hooks/useTts';

function LocalVoicePanel({ busy, onPrompt }: { busy: boolean; onPrompt: (text: string) => void }) {
  const settings = useAppStore(s => s.settings);
  const updateSettings = useAppStore(s => s.updateSettings);
  const tts = useTts();
  const [open, setOpen] = useState(() => !window.matchMedia('(max-width: 1023px)').matches);
  useEffect(() => {
    const phase = tts.isLoading ? 'generating' : tts.isSpeaking ? 'playing' : 'idle';
    window.dispatchEvent(new CustomEvent('jarvis:local-voice', { detail: { phase } }));
  }, [tts.isLoading, tts.isSpeaking]);
  return <section className="jarvis-voice-panel" aria-label="JARVIS voice">
    <div className="flex flex-wrap items-center gap-3 text-xs">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex items-center gap-2 cursor-pointer"><Volume2 size={15} /> {open ? 'Hide voice controls' : 'Talk to JARVIS'}</button>
      <label className="flex items-center gap-2"><input type="checkbox" checked={settings.voiceOutputEnabled && settings.voiceAutoplay} onChange={e => {
        updateSettings({ voiceOutputEnabled: true, voiceAutoplay: e.target.checked });
        if (!e.target.checked) tts.stop();
      }} />Speak replies</label>
      <button type="button" onClick={() => void tts.speak('voice-test', 'At your service, sir.')} disabled={tts.isLoading || tts.isSpeaking} className="cursor-pointer disabled:opacity-40">Test voice</button>
      <button type="button" onClick={tts.stop} aria-label="Stop voice" className="cursor-pointer"><Square size={14} /></button>
      <span role="status">{tts.error || (tts.isLoading ? 'Preparing speech…' : tts.isSpeaking ? 'Speaking' : tts.available ? 'Qwen ready' : 'Voice service unavailable')}</span>
    </div>
    {open && <LocalListeningControls visible busy={busy} onPrompt={onPrompt} />}
  </section>;
}

export function JarvisVoicePanel(props: {busy:boolean;onPrompt:(text:string)=>void}) {
 const standalone=useCloud(s=>s.standalone);
 return standalone ? <BrowserVoice {...props} /> : <LocalVoicePanel {...props} />;
}
