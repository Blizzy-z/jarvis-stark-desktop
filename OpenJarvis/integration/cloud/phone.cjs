const express = require('express');
const crypto = require('node:crypto');
const twilio = require('twilio');
function createPhone({storage, reply, clientFactory=twilio, now=Date.now}) {
 const state=storage.read()||{config:{},jobs:[],history:[]}; const active=new Map(); let sending=false;
 const save=()=>storage.write(state); const router=express.Router(), callbacks=express.Router();
 const clean=()=>({...state.config,token:undefined,hasToken:!!state.config.token});
 const wrap=fn=>(q,r,n)=>Promise.resolve(fn(q,r,n)).catch(e=>r.status(400).json({error:e.message}));
 const text=s=>typeof s==='string'&&s.trim().length>0&&s.length<=500;
 const ready=()=>{const c=state.config;if(!c.enabled||!c.verified||!c.profile||!c.model)throw Error('Finish setup and enable calling first.');return c;};
 function speech(message,url){const v=new twilio.twiml.VoiceResponse();v.gather({input:'speech dtmf',numDigits:1,action:url,method:'POST',speechTimeout:'auto',timeout:6,actionOnEmptyResult:true}).say({voice:'alice'},message);return v.toString();}
 async function dial(message){
  const c=ready();if(sending||[...active.values()].some(v=>v.expires>now()))throw Error('A call is already in progress.');
  if(state.history.filter(h=>now()-h.time<86400000).length>=10)throw Error('Daily limit of 10 calls reached.');
  sending=true;const id=crypto.randomBytes(24).toString('hex');const call={expires:now()+660000,messages:[],context:message,profile:c.profile,model:c.model,base:c.callbackOrigin,token:c.token,account:c.account,turn:0};
  active.set(id,call);state.history.unshift({time:now(),status:'sending'});state.history=state.history.slice(0,50);save();const record=state.history[0];
  try{const result=await clientFactory(c.account,c.token).calls.create({to:c.to,from:c.from,twiml:speech('Hello, this is JARVIS, your AI assistant. '+message+' How can I help? Press 1 to end the call.',c.callbackOrigin+'/voice/'+id+'/0'),statusCallback:c.callbackOrigin+'/status/'+id,statusCallbackEvent:['completed'],timeout:25,timeLimit:600});call.sid=result.sid;record.status='started';save();return {ok:true};}
  catch{active.delete(id);record.status='failed';save();throw Error('Twilio could not start the call. Check your number, balance and calling permissions.');}finally{sending=false;}
 }
 router.get('/',(_q,r)=>r.json({config:clean(),jobs:state.jobs,history:state.history}));
 router.post('/config',wrap(async(q,r)=>{const b=q.body;const previous=state.config;const u=new URL(b.callbackOrigin);if(u.protocol!=='https:'||u.username||u.password||u.pathname!=='/'||u.search||u.hash||u.hostname==='localhost'||u.hostname.endsWith('.local')||/^\d+\./.test(u.hostname))throw Error('Use a public HTTPS origin without a path.');if(!/^AC[a-f0-9]{32}$/i.test(b.account)||!/^\+[1-9]\d{7,14}$/.test(b.from)||!/^\+[1-9]\d{7,14}$/.test(b.to)||!text(b.model))throw Error('Enter the account SID, both numbers in +country-code format, and a model.');const token=b.token||previous.token;if(!/^[a-f0-9]{32}$/i.test(token||''))throw Error('Enter your Twilio Auth Token.');state.config={account:b.account,token,from:b.from,to:b.to,callbackOrigin:u.origin,model:b.model,profile:q.jarvisProfile,enabled:false,verified:false};save();r.json({ok:true});}));
 router.post('/verify',wrap(async(_q,r)=>{const c=state.config;try{const numbers=await clientFactory(c.account,c.token).incomingPhoneNumbers.list({phoneNumber:c.from,limit:1});if(!numbers.some(n=>n.capabilities.voice))throw Error();}catch{throw Error('Twilio credentials or the voice-enabled Twilio number could not be verified.');}const challenge=crypto.randomBytes(24).toString('hex');state.challenge=challenge;try{const response=await fetch(c.callbackOrigin+'/check/'+challenge,{signal:AbortSignal.timeout(10000),redirect:'error'});if(!response.ok||(await response.text())!==challenge)throw Error();}catch{throw Error('Public callback is not reaching JARVIS. Forward only the calling service on port 3015.');}finally{delete state.challenge;}c.verified=true;save();r.json({ok:true});}));
 router.post('/enable',wrap(async(q,r)=>{if(q.body.enabled&&!state.config.verified)throw Error('Verify the connection first.');state.config.enabled=q.body.enabled===true;save();r.json({ok:true});}));
 router.post('/call',wrap(async(q,r)=>r.json(await dial('This is your setup test call.'))));
 router.post('/jobs',wrap(async(q,r)=>{const b=q.body;if(!['wake','reminder','urgent'].includes(b.kind)||!text(b.message))throw Error('Choose a type and a message under 500 characters.');if(state.jobs.length>=100)throw Error('Remove old schedules before adding more.');const at=b.kind==='urgent'?null:Date.parse(b.at);if(b.kind!=='urgent'&&(!Number.isFinite(at)||at<=now()))throw Error('Choose a future date and time.');const job={id:crypto.randomUUID(),kind:b.kind,message:b.message,at,status:'pending',secret:b.kind==='urgent'?crypto.randomBytes(24).toString('hex'):undefined};state.jobs.push(job);save();r.json({ok:true});}));
 router.delete('/jobs/:id',(q,r)=>{state.jobs=state.jobs.filter(j=>j.id!==q.params.id);save();r.json({ok:true});});
 callbacks.use(express.urlencoded({extended:false,limit:'16kb'}));
 callbacks.get('/check/:challenge',(q,r)=>state.challenge&&q.params.challenge===state.challenge?r.send(state.challenge):r.sendStatus(404));
 callbacks.post('/event/:id/:secret',wrap(async(q,r)=>{const j=state.jobs.find(v=>v.id===q.params.id&&v.kind==='urgent'&&v.secret===q.params.secret);if(!j)return r.sendStatus(403);if(j.last&&now()-j.last<3600000)return r.status(429).json({error:'This event has a one-hour cooldown.'});j.last=now();save();try{await dial(j.message);j.status='triggered';}catch(e){j.status='failed';save();throw e;}save();r.json({ok:true});}));
 callbacks.post(['/voice/:id/:turn','/status/:id'],async(q,r)=>{
  const c=active.get(q.params.id);if(!c||c.expires<now()||!twilio.validateRequest(c.token,q.get('x-twilio-signature')||'',c.base+q.originalUrl,q.body)||q.body.AccountSid!==c.account||(c.sid&&q.body.CallSid!==c.sid))return r.sendStatus(403);
  if(q.path.startsWith('/status/')){active.delete(q.params.id);return r.sendStatus(204);}
  const hang=()=>{const v=new twilio.twiml.VoiceResponse();v.say('Goodbye.');v.hangup();return v.toString();};
  if(q.body.Digits==='1'||!q.body.SpeechResult||c.turn>=20){active.delete(q.params.id);return r.type('text/xml').send(hang());}
  const turn=Number(q.params.turn);if(c.cached?.turn===turn)return r.type('text/xml').send(c.cached.xml);if(c.busy||turn!==c.turn)return r.sendStatus(409);c.busy=true;
  try{c.messages.push({role:'user',content:String(q.body.SpeechResult).slice(0,1500)});const answer=await reply(c.profile,c.model,c.context,c.messages);c.messages.push({role:'assistant',content:answer});c.turn++;const xml=speech(answer,c.base+'/voice/'+q.params.id+'/'+c.turn);c.cached={turn,xml};r.type('text/xml').send(xml);}catch{const v=new twilio.twiml.VoiceResponse();v.say('Sorry, my AI connection is unavailable. Please check JARVIS on your laptop.');v.hangup();active.delete(q.params.id);r.type('text/xml').send(v.toString());}finally{c.busy=false;}
 });
 async function tick(){for(const [id,c]of active)if(c.expires<now())active.delete(id);for(const j of state.jobs){if(j.kind==='urgent'||j.status!=='pending'||j.at>now())continue;j.status=now()-j.at>300000?'missed':'starting';save();if(j.status==='missed')continue;try{await dial(j.message);j.status='called';}catch(e){j.status='failed';j.error=e.message;}save();}}
 const timer=setInterval(()=>void tick().catch(()=>{}),15000);timer.unref();return {router,callbacks,close:()=>clearInterval(timer),tick};
}
module.exports={createPhone};
