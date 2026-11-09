import { fileURLToPath } from "node:url"; import { dirname, join } from "node:path"; const API=join(dirname(fileURLToPath(import.meta.url)),"..");
import http from "node:http"; import { spawn, spawnSync } from "node:child_process";
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const clean={...process.env}; for (const k of ["AUTH_SECRET","ENC_KEY","MONGODB_URI","WA_APP_SECRET","RESEND_API_KEY","MAIL_FROM","PUBLIC_URL","RELAY_ALLOW_MEMORY","STRIPE_SECRET_KEY","RAZORPAY_KEY_ID"]) delete clean[k];
const g=spawnSync("node",["server.js"],{cwd:API,env:{...clean,NODE_ENV:"production",PORT:"4405"},encoding:"utf8",timeout:8000});
let f=0;const ok=(c,m)=>{console.log((c?"PASS ":"FAIL ")+m);if(!c)f++};
ok(g.status===1&&/Refusing to start/.test(g.stderr||g.stdout||""),"production refuses to start without secrets");
const mock=http.createServer((q,s)=>{let b="";q.on("data",d=>b+=d);q.on("end",()=>{s.writeHead(200,{"content-type":"application/json"});s.end(JSON.stringify({id:"sub_A"}))})}).listen(4906);
const srv=spawn("node",["server.js"],{cwd:API,env:{...clean,PORT:"4405",AUTH_SECRET:"t".repeat(40),RELAY_ADMIN_KEY:"adminkey-1234567890",MONGODB_URI:"mongodb://127.0.0.1:1/none",RELAY_ALLOW_MEMORY:"1",RAZORPAY_KEY_ID:"k",RAZORPAY_KEY_SECRET:"s",RAZORPAY_PLAN_STARTER:"p",RELAY_ALLOW_LOCAL_PROVIDERS: "1", RAZORPAY_BASE:"http://127.0.0.1:4906",INR_PRICES_APPROVED:"1",BILLING_CURRENCY:"INR",RESEND_API_KEY:"re_x",MAIL_FROM:"Relay <t@t.com>",PUBLIC_URL:"https://relay.test"},stdio:"ignore"});
for(let i=0;i<40;i++){try{if((await fetch("http://127.0.0.1:4405/health")).ok)break}catch{}await sleep(200)}
const A="http://127.0.0.1:4405/api/relay";const api=async(p,body,tok,h={},m)=>{const r=await fetch(A+p,{method:m||(body!==undefined?"POST":"GET"),headers:{"content-type":"application/json",...(tok?{authorization:"Bearer "+tok}:{}),...h},body:body!==undefined?JSON.stringify(body):undefined});return{s:r.status,j:await r.json().catch(()=>null)}};
const t=(await api("/auth/signup",{email:"g@x.com",password:"password123",company:"GST Co"})).j.token;
ok((await api("/billing/checkout",{plan:"starter",currency:"INR"},t)).s===400,"checkout blocked until billing details saved");
ok((await api("/billing/details",{legalName:"GST Co Pvt Ltd",gstin:"BADGSTIN",address:"12 MG Road Pune",state:"Maharashtra"},t,{},"PUT")).s===400,"invalid GSTIN rejected");
ok((await api("/billing/details",{legalName:"GST Co Pvt Ltd",gstin:"27AAPFU0939F1ZV",address:"12 MG Road Pune",state:"Maharashtra"},t,{},"PUT")).j.ok,"valid GSTIN saved");
ok((await api("/billing/checkout",{plan:"starter",currency:"INR"},t)).j.subscriptionId==="sub_A","checkout works after details");
ok((await api("/admin/orgs")).s===401&&(await api("/admin/orgs",undefined,null,{"x-admin-key":"wrong"})).s===401,"admin list needs the key");
const L=(await api("/admin/orgs",undefined,null,{"x-admin-key":"adminkey-1234567890"})).j;ok(L.totals.customers===1&&L.orgs[0].billing.gstin==="27AAPFU0939F1ZV"&&L.orgs[0].email==="g@x.com","admin sees customer with GSTIN");
await api("/admin/plan",{email:"g@x.com",plan:"growth",days:30},null,{"x-admin-key":"adminkey-1234567890"});
ok((await api("/admin/orgs",undefined,null,{"x-admin-key":"adminkey-1234567890"})).j.totals.paying===1,"admin set plan, counted as paying");
srv.kill();mock.close();console.log(f?"FAILS "+f:"ALL PASS");process.exit(f?1:0)
