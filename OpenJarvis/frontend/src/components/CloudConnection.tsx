import { useEffect, useState } from 'react';
import { useCloud, cloudAction } from '../lib/cloud';
import { useAppStore } from '../lib/store';
declare global { interface Window { jarvisDesktop?: {openExternal:(url:string)=>Promise<void>} } }
export function CloudConnection() {
 const cloud=useCloud();const busy=useAppStore(s=>s.streamState.isStreaming);
 const [error,setError]=useState(''),[code,setCode]=useState(''),[pair,setPair]=useState(''),[working,setWorking]=useState(false);
 useEffect(()=>{void cloud.refresh().catch(e=>setError(e.message));},[]);
 useEffect(()=>{if(!window.jarvisDesktop||cloud.connected)return;const timer=setInterval(()=>void cloud.refresh().catch(()=>{}),3000);return()=>clearInterval(timer);},[cloud.connected]);
 const run=async(fn:()=>Promise<void>)=>{setWorking(true);setError('');try{await fn();}catch(e){setError((e as Error).message);}finally{setWorking(false);}};
 if(!cloud.available)return null;
 return <details className="cloud-connection" open={cloud.standalone&&!cloud.connected?true:undefined}>
  <summary>AI: {cloud.enabled?'ChatGPT Plus':'Local · LM Studio'} {cloud.enabled&&!cloud.connected?'— connect account':''}</summary>
  <div className="flex flex-col gap-3 py-3">
   {!cloud.standalone&&<label>Use <select aria-label="AI source" disabled={busy} value={cloud.enabled?'cloud':'local'} onChange={e=>{const enabled=e.target.value==='cloud';useCloud.setState({enabled});localStorage.setItem('jarvis-cloud-enabled',String(enabled));if(enabled)useAppStore.getState().setDeepResearch(false);}}><option value="local">Local · LM Studio</option><option value="cloud">ChatGPT Plus subscription</option></select></label>}
   <p className="text-xs">Use your own ChatGPT plan. Usage counts toward its limits. This laptop must stay awake for phone access.</p>
   {cloud.account&&<p className="text-sm">Account: {cloud.account}</p>}
   {!cloud.connected&&cloud.local&&<button disabled={working||busy} data-oai-siwc-button onClick={()=>void run(async()=>{const result=await cloudAction(window.jarvisDesktop?'desktop-login':'start');if(window.jarvisDesktop)await window.jarvisDesktop.openExternal(result.url);else window.location.assign(result.url);})}>Continue with ChatGPT</button>}
   {!cloud.connected&&!cloud.local&&<><p className="text-xs">First, sign in on the JARVIS laptop at http://127.0.0.1:3014. Then create a phone connection code there.</p><label>Phone connection code<input aria-label="Phone connection code" value={pair} autoComplete="off" onChange={e=>setPair(e.target.value)} /></label><button disabled={working||!pair.trim()} onClick={()=>void run(async()=>{await cloudAction('pair',{code:pair});setPair('');await cloud.refresh();})}>Connect this phone</button></>}
   {cloud.connected&&<><label>Cloud model<select aria-label="Cloud model" value={cloud.model} disabled={busy} onChange={e=>{useCloud.setState({model:e.target.value});localStorage.setItem('jarvis-cloud-model',e.target.value);}}>{cloud.models.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
   {cloud.local&&<button disabled={working} onClick={()=>void run(async()=>{setCode((await cloudAction('pair-code')).code);})}>Create phone connection code</button>}
   {code&&<p className="text-xs break-all">Enter on your phone within 10 minutes (one use): <strong>{code}</strong></p>}
   <button disabled={working||busy} onClick={()=>void run(async()=>{const r=await cloudAction('disconnect');setCode('');await cloud.refresh();if(!r.revoked)setError('Signed out locally. Remote revocation was not confirmed; disconnect JARVIS in ChatGPT Settings.');})}>Disconnect ChatGPT on all linked devices</button></>}
   <a href="https://chatgpt.com/settings/usage" target="_blank" rel="noreferrer">Manage ChatGPT usage and access</a>
   {error&&<p role="alert">{error}</p>}
  </div>
 </details>;
}
