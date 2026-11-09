import { fileURLToPath } from "node:url"; import { dirname, join } from "node:path"; const API=join(dirname(fileURLToPath(import.meta.url)),"..");
import http from "node:http"; import { spawn } from "node:child_process";
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));const mails=[];
const mock=http.createServer((q,s)=>{let b="";q.on("data",d=>b+=d);q.on("end",()=>{mails.push(JSON.parse(b));s.writeHead(200,{"content-type":"application/json"});s.end("{}")})}).listen(4904);
const clean={...process.env}; for (const k of ["AUTH_SECRET","ENC_KEY","MONGODB_URI","WA_APP_SECRET","RELAY_ALLOW_MEMORY"]) delete clean[k];
const srv=spawn("node",["server.js"],{cwd:API,env:{...clean,PORT:"4404",AUTH_SECRET:"t".repeat(40),ENC_KEY:"e".repeat(40),MONGODB_URI:"mongodb://127.0.0.1:1/none",RELAY_ALLOW_MEMORY:"1",RESEND_API_KEY:"re_x",RESEND_BASE:"http://127.0.0.1:4904",PUBLIC_URL:"https://relay.test",AUTH_RATE_LIMIT:"100",NODE_ENV:"development"},stdio:["ignore","pipe","pipe"]});
let ready=false; for(let i=0;i<50;i++){try{if((await fetch("http://127.0.0.1:4404/health")).ok){ready=true;break}}catch{}await sleep(200)}
if(!ready){console.error("auth server failed to start"); try{console.error(srv.stderr.read()?.toString())}catch{}; process.exit(1)}
const A="http://127.0.0.1:4404/api/relay";const api=async(p,body,tok)=>{const r=await fetch(A+p,{method:body!==undefined?"POST":"GET",headers:{"content-type":"application/json",...(tok?{authorization:"Bearer "+tok}:{})},body:body!==undefined?JSON.stringify(body):undefined});return{s:r.status,j:await r.json().catch(()=>null)}};
let f=0;const ok=(c,m)=>{console.log((c?"PASS ":"FAIL ")+m);if(!c)f++};const tok=(m)=>m.text.match(/(?:verify|reset)=([0-9a-f]+)/)[1];
const t=(await api("/auth/signup",{email:"r@x.com",password:"password123",company:"Reset Co"})).j.token;await sleep(300);
ok(mails.length===1&&mails[0].to[0]==="r@x.com"&&mails[0].text.includes("https://relay.test/app?verify="),"signup sends confirmation email");
ok((await api("/me",undefined,t)).j.verified===false,"user starts unverified");
ok((await api("/auth/verify",{token:"a".repeat(48)})).s===400,"wrong verify token rejected");
const vt=tok(mails[0]);ok((await api("/auth/verify",{token:vt})).j.ok,"verify link works");ok((await api("/me",undefined,t)).j.verified===true,"user now verified");
ok((await api("/auth/verify",{token:vt})).s===400,"verify link cannot be reused");
const r1=await api("/auth/forgot",{email:"nobody@x.com"});await sleep(200);ok(r1.j.ok&&mails.length===1,"unknown email: same answer, no mail sent");
await api("/auth/forgot",{email:"r@x.com"});await sleep(300);ok(mails.length===2,"reset email sent");
ok(mails[1].text.includes("https://relay.test/app?reset="),"reset link points at /app");
const rt=tok(mails[1]);ok((await api("/auth/reset",{token:rt,password:"short"})).s===400,"short new password rejected");
ok((await api("/auth/reset",{token:rt,password:"newpassword456"})).j.ok,"reset works");
ok((await api("/me",undefined,t)).s===401,"old session revoked after password reset");
ok((await api("/auth/login",{email:"r@x.com",password:"password123"})).s===401,"old password no longer works");
const login=await api("/auth/login",{email:"r@x.com",password:"newpassword456"});ok(login.s===200,"new password works");
ok((await api("/me",undefined,login.j.token)).s===200,"new session works after reset");
ok((await api("/auth/reset",{token:rt,password:"another12345"})).s===400,"reset link cannot be reused");
srv.kill();mock.close();console.log(f?"FAILS "+f:"ALL PASS");process.exit(f?1:0)
