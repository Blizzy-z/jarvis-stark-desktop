const express=require('express');
const path=require('node:path');
const fs=require('node:fs');
const {vault}=require('./vault.cjs');
const {createCloud}=require('./cloud.cjs');
const app=express();const port=Number(process.env.JARVIS_PORT||3014);
const root=process.env.JARVIS_CLOUD_HOME||path.join(process.env.LOCALAPPDATA,'JarvisStarkCloud');
const configPath=fs.existsSync(path.join(root,'tailscale.json'))?path.join(root,'tailscale.json'):path.join(__dirname,'tailscale.json');
const remoteOrigin=fs.existsSync(configPath)?JSON.parse(fs.readFileSync(configPath)).origin:'';
const cloud=createCloud({storage:vault(root),port,remoteOrigin,standalone:true});
const {createPhone}=require('./phone.cjs');
const phone=createPhone({storage:vault(path.join(root,'phone')),reply:cloud.phoneReply});
cloud.router.use('/phone',cloud.phoneAccess,phone.router);
app.use('/api/cloud',cloud.router);
// Expose only this dedicated callback service through a public HTTPS tunnel.
const callbackApp=express();callbackApp.use(phone.callbacks);callbackApp.use((_q,r)=>r.sendStatus(404));
const callbackServer=callbackApp.listen(Number(process.env.JARVIS_PHONE_PORT||3015),'127.0.0.1');
callbackServer.on('error',()=>console.error('Phone callback port unavailable. Calling setup needs port 3015.'));

app.get('/health',(_q,r)=>r.json({status:'ok'}));
app.get('/v1/models',(_q,r)=>r.json({data:[]}));
app.get('/v1/info',(_q,r)=>r.json({engine:'ChatGPT Plus',model:'',agent:'none'}));
app.get('/v1/analytics/identity',(_q,r)=>r.json({enabled:false}));
app.get('/api/connectors',(_q,r)=>r.json([]));
app.use(['/v1','/api'],(_q,r)=>r.status(404).json({error:'This feature needs the local JARVIS edition. Cloud edition supports ChatGPT chat and browser voice.'}));
const staticRoot=fs.existsSync(path.join(__dirname,'public'))?path.join(__dirname,'public'):path.join(__dirname,'../../src/openjarvis/server/static');
app.use(express.static(staticRoot));
app.use((req,res)=>req.method==='GET'?res.sendFile(path.join(staticRoot,'index.html')):res.sendStatus(404));
module.exports = app.listen(port,'127.0.0.1',()=>console.log('JARVIS cloud ready at http://127.0.0.1:'+port));

module.exports.on('close',()=>{phone.close();callbackServer.close();});
