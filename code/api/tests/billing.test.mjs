import { fileURLToPath } from "node:url"; import { dirname, join } from "node:path"; const API=join(dirname(fileURLToPath(import.meta.url)),"..");
import http from "node:http"; import crypto from "node:crypto"; import { spawn } from "node:child_process";
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const mock=http.createServer((q,s)=>{let b="";q.on("data",d=>b+=d);q.on("end",()=>{s.writeHead(200,{"content-type":"application/json"});s.end(JSON.stringify(q.url.includes("/cancel")?{status:"cancelled"}:{id:"sub_TEST1"}))})}).listen(4901);
const env={...process.env,PORT:"4401",AUTH_SECRET:"t".repeat(40),RELAY_ADMIN_KEY:"adm",MONGODB_URI:"mongodb://127.0.0.1:1/none",RELAY_ALLOW_MEMORY:"1",RAZORPAY_KEY_ID:"rzp_test_x",RAZORPAY_KEY_SECRET:"s",RAZORPAY_WEBHOOK_SECRET:"whsec",RAZORPAY_PLAN_STARTER:"plan_s",RAZORPAY_PLAN_GROWTH:"plan_g",RELAY_ALLOW_LOCAL_PROVIDERS: "1", RAZORPAY_BASE:"http://127.0.0.1:4901",INR_PRICES_APPROVED:"1",BILLING_CURRENCY:"INR",RESEND_API_KEY:"re_x",MAIL_FROM:"Relay <t@t.com>",PUBLIC_URL:"https://relay.test"};
const srv=spawn("node",["server.js"],{cwd:API,env,stdio:"ignore"});
for(let i=0;i<40;i++){try{if((await fetch("http://127.0.0.1:4401/health")).ok)break}catch{}await sleep(200)}
const A="http://127.0.0.1:4401/api/relay";const api=async(p,body,tok,h={})=>{const r=await fetch(A+p,{method:body!==undefined?"POST":"GET",headers:{"content-type":"application/json",...(tok?{authorization:"Bearer "+tok}:{}),...h},body:typeof body==="string"?body:body!==undefined?JSON.stringify(body):undefined});let j=null;try{j=await r.json()}catch{}return{s:r.status,j}};
let f=0;const ok=(c,m)=>{console.log((c?"PASS ":"FAIL ")+m);if(!c)f++};
const t=(await api("/auth/signup",{email:"b@x.com",password:"password123",company:"Bill Co"})).j.token;
let b=(await api("/billing",undefined,t)).j;ok(b.configured&&b.plan==="trial","billing configured, starts on trial");
ok(b.usd?.starter?.amount===49&&b.usd?.growth?.amount===149,"USD guide prices exposed");
await fetch(A+"/billing/details",{method:"PUT",headers:{"content-type":"application/json",authorization:"Bearer "+t},body:JSON.stringify({legalName:"Bill Co Pvt Ltd",gstin:"",address:"1 Main Road Pune",state:"Maharashtra"})});
ok((await api("/billing/checkout",{plan:"growth",currency:"USD"},t)).s===503,"USD checkout blocked without Stripe");
const co=(await api("/billing/checkout",{plan:"growth",currency:"INR"},t));ok(co.j.subscriptionId==="sub_TEST1"&&co.j.keyId==="rzp_test_x","INR checkout returns subscription id");
const end=Math.floor(Date.now()/1000)+30*86400;const ev=JSON.stringify({event:"subscription.charged",payload:{subscription:{entity:{id:"sub_TEST1",current_end:end,notes:{}}}}});
ok((await api("/billing/webhook",ev,null,{"x-razorpay-signature":"bad"})).s===401,"bad webhook signature rejected");
const sig=crypto.createHmac("sha256","whsec").update(ev).digest("hex");
ok((await api("/billing/webhook",ev,null,{"x-razorpay-signature":sig})).j.result==="activated","valid webhook activates");
const me=(await api("/me",undefined,t)).j;ok(me.plan.id==="growth"&&new Date(me.plan.paidUntil)>new Date(),"plan is now growth with paidUntil");
const failEv=JSON.stringify({event:"payment.failed",payload:{payment:{entity:{notes:{orgId:me.company?undefined:undefined}}}}});
// payment.failed without org notes is ignored; set via subscription pending path
const fail2=JSON.stringify({event:"payment.failed",payload:{payment:{entity:{notes:{}}}}});
await api("/billing/webhook",fail2,null,{"x-razorpay-signature":crypto.createHmac("sha256","whsec").update(fail2).digest("hex")});
const ev2=JSON.stringify({event:"subscription.cancelled",payload:{subscription:{entity:{id:"sub_TEST1",notes:{}}}}});
await api("/billing/webhook",ev2,null,{"x-razorpay-signature":crypto.createHmac("sha256","whsec").update(ev2).digest("hex")});
b=(await api("/billing",undefined,t)).j;ok(b.status==="cancelled"&&b.plan==="growth","cancelled keeps access until paidUntil");
ok((await api("/billing/cancel",{},t)).j.ok===true,"cancel renewal call ok");
srv.kill();mock.close();console.log(f?"FAILS "+f:"ALL PASS");process.exit(f?1:0)
