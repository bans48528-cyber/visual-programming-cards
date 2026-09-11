"use strict";
const http=require("node:http");
const path=require("node:path");
const {fork}=require("node:child_process");
const allowed=new Set(["http://127.0.0.1:4173","http://localhost:4173"]);
let busy=false;
http.createServer(async(req,res)=>{
  res.setHeader("Cache-Control","no-store");
  const reply=(status,value)=>{res.writeHead(status,{"Content-Type":"application/json"});res.end(JSON.stringify(value));};
  if(!["127.0.0.1:4180","localhost:4180"].includes(req.headers.host)) return reply(403,{error:"Invalid host"});
  if(req.url==="/health" && req.method==="GET") return reply(200,{service:"cards-pika-compiler"});
  if(!allowed.has(req.headers.origin)) return reply(403,{error:"Origin denied"});
  res.setHeader("Access-Control-Allow-Origin",req.headers.origin);
  res.setHeader("Vary","Origin");
  if(req.method==="OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods","POST");
    res.setHeader("Access-Control-Allow-Headers","Content-Type");
    res.writeHead(204);return res.end();
  }
  if(req.url!=="/compile" || req.method!=="POST") return reply(404,{error:"Not found"});
  if(!req.headers["content-type"]?.startsWith("application/json")) return reply(415,{error:"JSON required"});
  if(busy) return reply(409,{error:"编译器忙，请稍后重试。"});
  busy=true;
  req.setTimeout(15000,()=>req.destroy());
  try {
    let size=0;const chunks=[];
    for await(const chunk of req) {size+=chunk.length;if(size>262144) throw new Error("程序数据过大。");chunks.push(chunk);}
    const {program}=JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const result=await new Promise((resolve,reject)=>{
      const child=fork(path.join(__dirname,"compiler-worker.cjs"),[],{silent:true,windowsHide:true});
      const timer=setTimeout(()=>{child.kill();reject(new Error("编译超时。"));},15000);
      child.on("message",value=>{clearTimeout(timer);resolve(value);});
      child.on("error",error=>{clearTimeout(timer);reject(error);});
      child.on("exit",()=>{clearTimeout(timer);reject(new Error("编译器进程退出。"));});
      child.send(program);
    });
    reply(result.error?422:200,result);
  } catch(error) {reply(400,{error:error.message});}
  finally {busy=false;}
}).listen(4180,"127.0.0.1",()=>console.log("Pika compiler: http://127.0.0.1:4180"));
