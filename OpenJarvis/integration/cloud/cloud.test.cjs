const http=require('node:http');
function httpFetch(url,options){return new Promise((resolve,reject)=>{const request=http.request(url,{method:options.method,headers:options.headers},response=>{let chunks=[];response.on('data',c=>chunks.push(c));response.on('end',()=>{const headers=new Headers();for(const [k,v]of Object.entries(response.headers))headers.set(k,Array.isArray(v)?v.join(', '):v);resolve(new Response(Buffer.concat(chunks),{status:response.statusCode,headers}));});});request.on('error',reject);request.end(options.body);});}
const {test}=require('node:test');const assert=require('node:assert/strict');const express=require('express');const {createCloud}=require('./cloud.cjs');
async function setup(t){let saved;let calls=[];let failStream=false;
 const fetcher=async(url,opts)=>{calls.push({url,opts});if(url.endsWith('/oauth/token'))return Response.json({id_token:'test',access_token:'secret',refresh_token:'refresh',scope:'chatgpt.tokens.use.direct',expires_in:3600});if(url.endsWith('/models'))return Response.json({models:[{slug:'test-model',display_name:'Test model',visibility:'list'},{slug:'hidden',visibility:'hidden'}]});if(url.endsWith('/responses'))return new Response('data: '+JSON.stringify({type:'response.output_text.delta',delta:'Test reply'})+'\n\ndata: '+JSON.stringify({type:failStream?'response.failed':'response.completed'})+'\n\n');throw Error('Unexpected upstream call');};
 const app=express();const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const port=server.address().port;const origin=`http://127.0.0.1:${port}`;
 app.use('/api/cloud',createCloud({storage:{read:()=>saved,write:v=>saved=v},port,remoteOrigin:'https://phone.example:8446',fetcher,verifyIdentity:async()=>({sub:'friend',email:'friend@example.test'})}).router);t.after(()=>server.close());
 let cookie='';const req=async(path,body,extra={})=>{const r=await httpFetch(origin+'/api/cloud/'+path,{method:body?'POST':'GET',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json',...extra},body:body?JSON.stringify(body):undefined,redirect:'manual'});const c=r.headers.get('set-cookie');if(c)cookie=c.split(';')[0];return r;};
 const login=async()=>{const start=await(await req('start',{})).json();const url=new URL(start.url);const result=await req('callback?'+new URLSearchParams({state:url.searchParams.get('state'),client_id:'oaiapp_test',code:'test'}));assert.equal(result.status,302);return url;};return {req,login,calls,getCookie:()=>cookie,getSaved:()=>saved,setFail:()=>failStream=true};}
test('anonymous, origin and host boundaries',async t=>{const s=await setup(t);assert.equal((await s.req('chat',{model:'test',messages:[]})).status,401);assert.equal((await s.req('start',{}, {Origin:'https://evil.test'})).status,403);assert.equal((await s.req('status',null,{Host:'evil.test'})).status,403);assert.equal((await s.req('callback?state=wrong&client_id=x&code=x')).status,400);assert.equal(s.calls.length,0);});
test('registration, isolated phone pairing, refresh and streaming completion',async t=>{const s=await setup(t);const url=await s.login();assert.equal(url.searchParams.get('client_id'),'dynamic_agent_client');assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.ok(url.searchParams.get('ext_agent_host_id').startsWith('urn:uuid:'));
 assert.equal((await(await s.req('status')).json()).connected,true);const m=await(await s.req('models')).json();assert.deepEqual(m.models,[{id:'test-model',name:'Test model'}]);
 const code=(await(await s.req('pair-code',{})).json()).code;assert.equal((await s.req('pair',{code},{Cookie:'',Host:'phone.example:8446',Origin:'https://phone.example:8446'})).status,200);assert.equal((await s.req('pair',{code})).status,400);assert.equal((await(await s.req('status',null,{Cookie:''})).json()).connected,false);
 Object.values(s.getSaved().profiles)[0].expires=0;
 const reply=await(await s.req('chat',{model:'chatgpt/test-model',messages:[{role:'user',content:'Hello'}]})).text();assert.ok(reply.includes('Test reply'));assert.ok(reply.includes('[DONE]'));
 const request=JSON.parse(s.calls.find(x=>x.url.endsWith('/responses')).opts.body);assert.equal(request.store,false);assert.equal(request.stream,true);assert.equal(request.model,'test-model');assert.equal(request.temperature,undefined);assert.ok(s.calls.some(x=>x.url.endsWith('/oauth/token')&&x.opts.body.get('grant_type')==='refresh_token'));
 s.setFail();const failed=await(await s.req('chat',{model:'test-model',messages:[{role:'user',content:'Hi'}]})).text();assert.ok(failed.includes('error'));assert.ok(!failed.includes('[DONE]'));});

test('desktop browser handoff is single use and connects the original desktop session',async t=>{
 const s=await setup(t);const ticket=await(await s.req('desktop-login',{})).json();const desktopCookie=s.getCookie();
 const route=new URL(ticket.url).pathname.replace('/api/cloud/','')+new URL(ticket.url).search;
 assert.equal((await s.req(route,null,{Cookie:''})).status,200);
 assert.equal((await s.req(route)).status,400);
 await s.login();
 assert.equal((await(await s.req('status',null,{Cookie:desktopCookie})).json()).connected,true);
});
