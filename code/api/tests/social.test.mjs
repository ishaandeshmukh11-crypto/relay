import { fileURLToPath } from "node:url"; import { dirname, join } from "node:path"; const API=join(dirname(fileURLToPath(import.meta.url)),"..");
import http from "node:http"; import crypto from "node:crypto"; import { spawn } from "node:child_process";
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms)); const calls=[];
const mock=http.createServer((q,s)=>{let b="";q.on("data",d=>b+=d);q.on("end",()=>{const j=(o,c=200)=>{s.writeHead(c,{"content-type":"application/json"});s.end(JSON.stringify(o))};
 if(!/Bearer (PAGETOKEN|USERTOK)/.test(q.headers.authorization||""))return j({error:{message:"bad token",code:190}},401);
 if(q.url.startsWith("/me/accounts"))return j({data:[{id:"PG1",name:"Acme Page",access_token:"PAGETOKEN",instagram_business_account:{id:"IG1",username:"acme_ig"}}]});
 if(q.method==="GET")return j({name:"Acme Page",instagram_business_account:{id:"IG1",username:"acme_ig"}});
 calls.push({url:q.url,body:b?JSON.parse(b):{}});j({message_id:"m1",id:"r1",success:true})})}).listen(4902);
const env={...process.env,PORT:"4402",AUTH_SECRET:"t".repeat(40),RELAY_ADMIN_KEY:"adm",MONGODB_URI:"mongodb://127.0.0.1:1/none",RELAY_ALLOW_MEMORY:"1",RELAY_ALLOW_LOCAL_PROVIDERS: "1", GRAPH_BASE:"http://127.0.0.1:4902",FB_APP_SECRET:"appsec",WA_VERIFY_TOKEN:"vt"};
const srv=spawn("node",["server.js"],{cwd:API,env,stdio:"ignore"});
for(let i=0;i<40;i++){try{if((await fetch("http://127.0.0.1:"+env.PORT+"/health")).ok)break}catch{}await sleep(200)}
const A="http://127.0.0.1:4402/api/relay";const api=async(p,body,tok,h={},m)=>{const r=await fetch(A+p,{method:m||(body!==undefined?"POST":"GET"),headers:{"content-type":"application/json",...(tok?{authorization:"Bearer "+tok}:{}),...h},body:typeof body==="string"?body:body!==undefined?JSON.stringify(body):undefined});let j=null;const t=await r.text();try{j=JSON.parse(t)}catch{j=t}return{s:r.status,j}};
let f=0;const ok=(c,m)=>{console.log((c?"PASS ":"FAIL ")+m);if(!c)f++};
const hook=(o)=>{const b=JSON.stringify(o);return api("/social/webhook",b,null,{"x-hub-signature-256":"sha256="+crypto.createHmac("sha256","appsec").update(b).digest("hex")})};
const t=(await api("/auth/signup",{email:"s@x.com",password:"password123",company:"Social Co"})).j.token;
ok((await api("/social/webhook?hub.mode=subscribe&hub.verify_token=vt&hub.challenge=777")).j==777,"webhook verify works");
ok((await api("/social/webhook",{object:"instagram"},null,{"x-hub-signature-256":"sha256=bad"})).s===401,"bad signature rejected");
// demo mode
await api("/social/autos",{type:"comment_to_dm",name:"Price",keywords:["price","link"],reply:"Hi {{name}}, here is the price list: acme.in/p. Reply STOP to opt out."},t);
let r=(await api("/social/simulate",{kind:"comment",text:"Price please",username:"ravi_k"},t)).j;ok(r.handled&&r.reason==="sent","demo: comment with keyword triggers DM");
r=(await api("/social/simulate",{kind:"comment",text:"price?",username:"ravi_k"},t)).j;ok(!r.handled&&r.reason==="already_messaged_today","demo: same person not DMed twice in a day");
r=(await api("/social/simulate",{kind:"comment",text:"nice pic",username:"sita"},t)).j;ok(!r.handled&&r.reason==="no_rule","demo: unrelated comment ignored");
await api("/social/simulate",{kind:"dm",text:"STOP",username:"ravi_k"},t);
r=(await api("/social/simulate",{kind:"comment",text:"link",username:"ravi_k"},t)).j;ok(r.reason==="opted_out","demo: opted-out person never messaged again");
await api("/social/simulate",{kind:"dm",text:"call me 98765 43210 or a@b.com",username:"meena"},t);
const inbox=(await api("/social/inbox",undefined,t)).j.threads;ok(inbox.find(x=>x.username==="meena")?.lead?.phone&&inbox.find(x=>x.username==="meena")?.lead?.email,"lead phone+email captured from DM");
// connect
ok((await api("/social/connect",{pageId:"PG1",token:"nope"},t)).s===400,"bad token rejected");
const pages=(await api("/social/fb/pages",{userToken:"USERTOK-aaaaaaaa"},t)).j.pages;ok(pages[0].ig==="acme_ig","lists pages with linked Instagram");
const c=(await api("/social/connect",{pageId:"PG1",userToken:"USERTOK-aaaaaaaa"},t)).j;ok(c.ok&&c.instagram==="acme_ig","connected to page + instagram");
ok(calls.some(x=>x.url.includes("/PG1/subscribed_apps")),"page subscribed to webhook");
calls.length=0;
await hook({object:"instagram",entry:[{id:"IG1",changes:[{field:"comments",value:{id:"C1",text:"What is the PRICE",from:{id:"U9",username:"kiran"},media:{id:"M1"}}}]}]});await sleep(500);
const dm=calls.find(x=>x.url==="/IG1/messages");ok(dm&&dm.body.recipient.comment_id==="C1"&&/kiran/.test(dm.body.message.text),"real IG comment -> private reply to comment_id with first name filled");
await hook({object:"instagram",entry:[{id:"IG1",changes:[{field:"comments",value:{id:"C1",text:"What is the PRICE",from:{id:"U9",username:"kiran"},media:{id:"M1"}}}]}]});await sleep(300);
ok(calls.filter(x=>x.url==="/IG1/messages").length===1,"duplicate webhook delivery does not send twice");
await hook({object:"instagram",entry:[{id:"IG1",changes:[{field:"comments",value:{id:"C2",text:"price",from:{id:"IG1",username:"acme_ig"},media:{id:"M1"}}}]}]});await sleep(300);
ok(calls.filter(x=>x.url==="/IG1/messages").length===1,"own comments are ignored");
await api("/social/autos",{type:"comment_to_dm",channel:"facebook",name:"FB",keywords:[],reply:"Thanks {{name}}!",publicReply:"Check your inbox"},t);
calls.length=0;await hook({object:"page",entry:[{id:"PG1",changes:[{field:"feed",value:{item:"comment",verb:"add",comment_id:"FC1",message:"hello",from:{id:"U7",name:"Anil Shah"},post_id:"PP1"}}]}]});await sleep(500);
ok(calls.some(x=>x.url==="/PG1/messages"&&x.body.recipient.comment_id==="FC1")&&calls.some(x=>x.url==="/FC1/comments"),"FB comment -> private reply + public reply");
// DM window reply
await hook({object:"page",entry:[{id:"PG1",messaging:[{sender:{id:"U7"},message:{mid:"mid1",text:"hi there"}}]}]});await sleep(300);
const th=(await api("/social/inbox",undefined,t)).j.threads.find(x=>x.senderId==="U7");ok(th.canReply,"inbox shows 24h reply window open");
ok((await api("/social/reply",{threadId:th._id,text:"Sure, how can we help?"},t)).j.ok,"manual reply within window sent");
const me=(await api("/social",undefined,t)).j;ok(me.connected&&me.quota.cap===100&&me.quota.used>=2,"overview: connected, quota counted (trial cap 100)");
srv.kill();mock.close();console.log(f?"FAILS "+f:"ALL PASS");process.exit(f?1:0)
