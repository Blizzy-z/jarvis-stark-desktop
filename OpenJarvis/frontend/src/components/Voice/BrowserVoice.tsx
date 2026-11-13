import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../lib/store';
import { toSpeakableText } from '../../lib/message-text';
export function BrowserVoice({busy,onPrompt}:{busy:boolean;onPrompt:(text:string)=>void}) {
 const [listening,setListening]=useState(false),[error,setError]=useState(''),[speaking,setSpeaking]=useState(false);
 const [autoplay,setAutoplay]=useState(false);
 const recognition=useRef<any>(null),wasStreaming=useRef(false),streamChat=useRef<string|null>(null);
 const messages=useAppStore(s=>s.messages),stream=useAppStore(s=>s.streamState),active=useAppStore(s=>s.activeId);
 const last=messages[messages.length-1]?.role==='assistant'?messages[messages.length-1]:undefined;
 const stop=()=>{recognition.current?.abort();recognition.current=null;window.speechSynthesis?.cancel();setListening(false);setSpeaking(false);};
 const speak=(text:string)=>{
  stop();if(!window.speechSynthesis){setError('Read aloud is unavailable in this browser.');return;}
  const utterance=new SpeechSynthesisUtterance(toSpeakableText(text));utterance.onend=()=>setSpeaking(false);utterance.onerror=(event)=>{setSpeaking(false);if(event.error!=='canceled'&&event.error!=='interrupted')setError('Playback was blocked. Tap Read reply to try again.');};
  setError('');setSpeaking(true);window.speechSynthesis.speak(utterance);
 };
 useEffect(()=>{
  const was=wasStreaming.current,previousChat=streamChat.current;
  wasStreaming.current=stream.isStreaming;streamChat.current=stream.conversationId;
  if(was&&!stream.isStreaming&&previousChat===active&&autoplay&&last?.content)speak(last.content);
 },[stream.isStreaming,active,last?.id,autoplay]);
 useEffect(()=>{if(busy){recognition.current?.abort();setListening(false);}},[busy]);
 useEffect(()=>{const hidden=()=>{if(document.hidden)stop();};document.addEventListener('visibilitychange',hidden);return()=>{document.removeEventListener('visibilitychange',hidden);recognition.current?.abort();window.speechSynthesis?.cancel();};},[]);
 const begin=()=>{
  stop();setError('');const Recognition=(window as any).SpeechRecognition||(window as any).webkitSpeechRecognition;
  if(!Recognition){setError('Voice input is unavailable here. Use your phone keyboard microphone or type a message.');return;}
  const r=new Recognition();recognition.current=r;r.lang='en-GB';r.interimResults=false;r.continuous=false;
  r.onresult=(event:any)=>{const text=event.results[0][0].transcript.trim();if(text)onPrompt(text);};
  r.onend=()=>{setListening(false);if(recognition.current===r)recognition.current=null;};
  r.onerror=(event:any)=>{setListening(false);if(event.error!=='aborted')setError('Microphone: '+event.error+'. You can also use keyboard dictation.');};
  try{r.start();setListening(true);}catch{setError('Could not start the microphone. Check browser permissions.');}
 };
 return <section className="jarvis-voice-panel" aria-label="Browser voice"><div className="flex flex-wrap items-center gap-3 text-xs">
  <button disabled={busy} onClick={listening?stop:begin}>{listening?'Stop listening':'Talk to JARVIS'}</button>
  <button disabled={!last?.content||busy} onClick={()=>last&&speak(last.content)}>Read reply</button>
  <button onClick={stop}>Stop voice</button>
  <label className="flex items-center gap-2"><input type="checkbox" checked={autoplay} onChange={e=>{setAutoplay(e.target.checked);if(!e.target.checked)stop();}}/>Speak replies</label>
 </div><p role="status" className="text-xs mt-2">{error||(listening?'Listening…':speaking?'Speaking…':'Browser voice · no Qwen download needed')}</p><p className="text-xs mt-1">Speech recognition may use your browser’s online service. No always-on wake word.</p></section>;
}
