import { create } from 'zustand';
export const useCloud = create<{
 available: boolean; standalone: boolean; local: boolean; connected: boolean;
 account: string | null; enabled: boolean; model: string;
 models: Array<{id:string;name:string}>;
 refresh: () => Promise<void>;
}>((set) => ({
 available:false, standalone:false, local:false, connected:false, account:null,
 enabled:localStorage.getItem('jarvis-cloud-enabled')==='true',
 model:localStorage.getItem('jarvis-cloud-model')||'',models:[],
 refresh:async()=>{
  const r=await fetch('/api/cloud/status');if(!r.ok)return;
  const s=await r.json();if(!s.available)return;set(s);
  if(s.standalone)set({enabled:true});
  if(!s.connected){set({models:[],model:''});return;}
  const m=await fetch('/api/cloud/models');if(!m.ok)throw Error('Could not load your ChatGPT models. Reconnect your account.');
  const {models}=await m.json();const saved=localStorage.getItem('jarvis-cloud-model');
  set({models,model:models.some((x:{id:string})=>x.id===saved)?saved:models[0]?.id||''});
 }
}));
export async function cloudAction(action:string,body:object={}) {
 const r=await fetch('/api/cloud/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const data=await r.json();if(!r.ok)throw Error(data.error||'ChatGPT connection failed');return data;
}
