const crypto=require('node:crypto');
const express=require('express');
const random=()=>crypto.randomBytes(32).toString('base64url');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const AUTH='https://auth.openai.com';
const API='https://api.openai.com/v1';
const MAX_AGE=30*24*3600*1000;
function createCloud({storage, port=3014, remoteOrigin='', standalone=false, fetcher=fetch, verifyIdentity}) {
  const router=express.Router();
  const state=storage.read()||{host:'urn:uuid:'+crypto.randomUUID(),profiles:{},sessions:{}};
  const desktopTickets=new Map();
  const pending=new Map(),pairs=new Map(),refreshes=new Map(),running=new Set();
  storage.write(state);
  const save=()=>storage.write(state);
  const local=req=>req.headers.host===`127.0.0.1:${port}`;
  const allowed=req=>local(req)|| (remoteOrigin && req.headers.host===new URL(remoteOrigin).host);
  const cookie=req=>(req.headers.cookie||'').split('; ').find(v=>v.startsWith('jarvis_cloud='))?.slice(13);
  const session=req=>{const s=state.sessions[hash(cookie(req)||'')];return s&&s.expires>Date.now()?s:null;};
  const profile=req=>state.profiles[session(req)?.profile];
  function setSession(res,req,profileId){const id=random();state.sessions[hash(id)]={profile:profileId,expires:Date.now()+MAX_AGE};res.cookie('jarvis_cloud',id,{httpOnly:true,sameSite:'lax',secure:!local(req),maxAge:MAX_AGE,path:'/'});save();return id;}
  const fail=(res,status,message)=>res.status(status).json({error:message});
  const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(()=>{if(!res.headersSent)fail(res,502,'ChatGPT connection failed. Try again or reconnect your account.');else res.end();});
  async function request(url,options={}) {return fetcher(url,{...options,signal:options.signal||AbortSignal.timeout(30000),redirect:'error'});}
  async function token(form){const r=await request(AUTH+'/api/accounts/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({...form,resource:API})});if(!r.ok)throw Error('Token exchange failed');return r.json();}
  async function identity(jwt,client,nonce){if(verifyIdentity)return verifyIdentity(jwt,client,nonce);const {createRemoteJWKSet,jwtVerify}=await import('jose');const {payload}=await jwtVerify(jwt,createRemoteJWKSet(new URL(AUTH+'/.well-known/jwks.json')),{issuer:AUTH,audience:client,requiredClaims:['sub','exp','iat'],clockTolerance:5});if(payload.nonce!==nonce)throw Error('Invalid sign-in nonce');return payload;}
  async function credentials(p){
    if(!p?.tokens)throw Error('Sign in required');
    if(p.expires>Date.now()+60000)return p.tokens.access_token;
    if(!refreshes.has(p.id))refreshes.set(p.id,(async()=>{const t=await token({grant_type:'refresh_token',client_id:p.client,refresh_token:p.tokens.refresh_token});if(!t.access_token)throw Error('Missing access token');if(t.scope&&!t.scope.split(' ').includes('chatgpt.tokens.use.direct')){p.tokens=null;save();throw Error('Plan consent removed');}p.tokens={...p.tokens,...t};p.expires=Date.now()+Number(t.expires_in||3600)*1000;save();})().finally(()=>refreshes.delete(p.id)));
    await refreshes.get(p.id);return p.tokens.access_token;
  }
  async function models(p){const r=await request(API+'/models',{headers:{Authorization:'Bearer '+await credentials(p)}});if(!r.ok)throw Error('Models unavailable');const b=await r.json();return (b.models||[]).filter(m=>m.visibility==='list').map(m=>({id:m.slug,name:m.display_name||m.slug}));}
  router.use((req,res,next)=>{
    res.set('Cache-Control','no-store');
    if(!allowed(req))return fail(res,403,'Unrecognized JARVIS address.');
    if(req.method!=='GET' && req.headers.origin!==(local(req)?`http://127.0.0.1:${port}`:remoteOrigin))return fail(res,403,'Open this action from JARVIS.');
    next();
  });
  router.use(express.json({limit:'1mb'}));
  router.get('/status',wrap(async(req,res)=>{const p=profile(req);res.json({available:true,standalone,local:local(req),connected:!!p?.tokens,account:p?.email||null,remoteOrigin});}));
  router.post('/desktop-login',wrap(async(req,res)=>{
    if(!local(req))return fail(res,403,'Desktop sign-in must start on this laptop.');
    for(const [key,v]of desktopTickets)if(v.expires<Date.now())desktopTickets.delete(key);
    if(desktopTickets.size>=10)return fail(res,429,'Too many pending sign-ins.');
    const sid=cookie(req)||setSession(res,req,null),ticket=random();
    desktopTickets.set(hash(ticket),{sid,expires:Date.now()+120000});
    res.json({url:`http://127.0.0.1:${port}/api/cloud/browser-login?ticket=${ticket}`});
  }));
  router.get('/browser-login',wrap(async(req,res)=>{
    const key=hash(String(req.query.ticket||'')),ticket=desktopTickets.get(key);desktopTickets.delete(key);
    if(!local(req)||!ticket||ticket.expires<Date.now())return fail(res,400,'Desktop sign-in expired. Return to JARVIS and try again.');
    res.cookie('jarvis_cloud',ticket.sid,{httpOnly:true,sameSite:'lax',maxAge:MAX_AGE,path:'/'});
    res.set('Referrer-Policy','no-referrer');
    res.type('html').send('<!doctype html><title>JARVIS sign-in</title><p id="status">Opening ChatGPT sign-in...</p><script>history.replaceState(null,"","/api/cloud/browser-login");fetch("/api/cloud/start",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"}).then(async r=>{const d=await r.json();if(!r.ok)throw Error(d.error);location.assign(d.url)}).catch(e=>document.getElementById("status").textContent=e.message)</script>');
  }));
  router.post('/start',wrap(async(req,res)=>{
    if(!local(req))return fail(res,403,'Complete first sign-in on this laptop at http://127.0.0.1:'+port);
    for(const [key,v] of pending)if(v.expires<Date.now())pending.delete(key);
    if(pending.size>=10)return fail(res,429,'Too many pending sign-ins. Wait ten minutes.');
    const p=profile(req),sid=cookie(req)||setSession(res,req,null),s=random(),nonce=random(),verifier=random();
    const redirect=`http://127.0.0.1:${port}/api/cloud/callback`;
    pending.set(s,{nonce,verifier,redirect,session:hash(sid),profile:p?.id,expires:Date.now()+600000});
    const q=new URLSearchParams({client_id:p?.client||'dynamic_agent_client',ext_agent_host_id:state.host,response_type:'code',redirect_uri:redirect,scope:'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',resource:API,state:s,nonce,code_challenge_method:'S256',code_challenge:crypto.createHash('sha256').update(verifier).digest('base64url')});
    if(!p)q.set('agent_name_hint','JARVIS Stark Companion');
    res.json({url:AUTH+'/api/accounts/authorize?'+q});
  }));
  router.get('/callback',wrap(async(req,res)=>{
    const t=pending.get(req.query.state);pending.delete(req.query.state);
    if(!local(req)||!t||t.expires<Date.now()||t.session!==hash(cookie(req)||''))return fail(res,400,'Sign-in expired or belongs to another browser. Start again.');
    if(req.query.error)return fail(res,400,'ChatGPT sign-in was declined. Return to JARVIS to try again.');
    const old=state.profiles[t.profile],client=old?.client||req.query.client_id;
    if(typeof client!=='string'||!client||client==='dynamic_agent_client'||(old&&req.query.client_id&&req.query.client_id!==client)||typeof req.query.code!=='string')return fail(res,400,'Invalid sign-in registration.');
    const tokens=await token({grant_type:'authorization_code',client_id:client,code:req.query.code,code_verifier:t.verifier,redirect_uri:t.redirect});
    const who=await identity(tokens.id_token,client,t.nonce);
    if(old&&old.subject!==who.sub)return fail(res,400,'This sign-in belongs to another account.');
    if(!tokens.scope?.split(' ').includes('chatgpt.tokens.use.direct')||!tokens.access_token)return fail(res,403,'ChatGPT plan permission was not granted.');
    const id=old?.id||crypto.randomUUID();state.profiles[id]={id,client,subject:who.sub,email:who.email||'ChatGPT account',tokens,expires:Date.now()+Number(tokens.expires_in||3600)*1000};if(state.sessions[t.session])state.sessions[t.session].profile=id;setSession(res,req,id);
    res.redirect('/?chatgpt=connected');
  }));
  router.get('/models',wrap(async(req,res)=>{if(!profile(req)?.tokens)return fail(res,401,'Connect your ChatGPT account first.');res.json({models:await models(profile(req))});}));
  router.post('/pair-code',wrap(async(req,res)=>{
    const p=profile(req);if(!p?.tokens||!local(req))return fail(res,403,'Create a phone code on the signed-in laptop.');
    for(const [key,v]of pairs)if(v.expires<Date.now()||v.profile===p.id)pairs.delete(key);
    const code=crypto.randomBytes(12).toString('hex');pairs.set(hash(code),{profile:p.id,expires:Date.now()+600000});res.json({code,expiresIn:600});
  }));
  router.post('/pair',wrap(async(req,res)=>{const key=hash(String(req.body.code||'').trim()),p=pairs.get(key);if(!p||p.expires<Date.now())return fail(res,400,'Invalid or expired phone code.');pairs.delete(key);setSession(res,req,p.profile);res.json({ok:true});}));
  router.post('/disconnect',wrap(async(req,res)=>{
    const p=profile(req);if(!p)return res.json({ok:true});let revoked=false;
    try{const d=await(await request(AUTH+'/.well-known/openid-configuration')).json();if(new URL(d.revocation_endpoint).origin!==AUTH)throw Error('Invalid revocation endpoint');const r=await request(d.revocation_endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:p.tokens?.refresh_token||'',token_type_hint:'refresh_token',client_id:p.client})});revoked=r.status===200;}catch{}
    p.tokens=null;for(const [key,v]of pairs)if(v.profile===p.id)pairs.delete(key);save();res.json({ok:true,revoked});
  }));
  router.post('/chat',wrap(async(req,res)=>{
    const p=profile(req);if(!p?.tokens)return fail(res,401,'Connect your ChatGPT account first.');
    if(running.has(p.id))return fail(res,409,'This account already has a reply in progress.');
    const {model,messages}=req.body;if(typeof model!=='string'||!Array.isArray(messages)||!messages.length||messages.some(m=>!['user','assistant'].includes(m.role)||typeof m.content!=='string'))return fail(res,400,'Invalid chat request.');
    running.add(p.id);const controller=new AbortController();const abort=()=>controller.abort();res.on('close',abort);const timer=setTimeout(abort,180000);
    const send=data=>res.write('data: '+JSON.stringify(data)+'\n\n');
    try{
      const upstream=await request(API+'/responses',{method:'POST',signal:controller.signal,headers:{Authorization:'Bearer '+await credentials(p),'Content-Type':'application/json'},body:JSON.stringify({model:model.replace(/^chatgpt\//,''),instructions:'You are JARVIS, a helpful personal assistant. Be concise, clear and warm. You cannot control devices or access files in this chat.',input:messages,store:false,stream:true})});
      if(!upstream.ok)return fail(res,upstream.status,'ChatGPT declined this request. Check your connection and plan usage in ChatGPT Settings.');
      res.set({'Content-Type':'text/event-stream','X-Accel-Buffering':'no'});res.flushHeaders();
      let buffer='',completed=false;const decoder=new TextDecoder();
      for await(const bytes of upstream.body){buffer+=decoder.decode(bytes,{stream:true});let cut;while((cut=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,cut).trim();buffer=buffer.slice(cut+1);if(!line.startsWith('data:'))continue;let e;try{e=JSON.parse(line.slice(5));}catch{continue;}
        if(e.type==='response.output_text.delta')send({choices:[{delta:{content:e.delta}}],model,engine:'ChatGPT Plus'});
        if(e.type==='response.failed'||e.type==='response.incomplete'||e.type==='error')throw Error('ChatGPT could not finish this reply. Check your plan usage or reconnect.');
        if(e.type==='response.completed')completed=true;
      }}
      if(!completed)throw Error('ChatGPT connection ended before the reply completed.');send({choices:[{delta:{},finish_reason:'stop'}]});res.end('data: [DONE]\n\n');
    }catch(e){if(!res.destroyed){if(res.headersSent){send({error:{message:controller.signal.aborted?'Reply stopped or timed out.':e.message}});res.end();}else fail(res,502,'ChatGPT request failed. Reconnect or try again.');}}
    finally{clearTimeout(timer);res.off('close',abort);running.delete(p.id);}
  }));
  return {router,modelsFor:async(req)=>profile(req)?.tokens?models(profile(req)):[]};
}
module.exports={createCloud};
