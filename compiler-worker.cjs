"use strict";
const fs=require("node:fs");
const path=require("node:path");
const os=require("node:os");
const generate=require("./program-codegen.cjs");
process.once("message",program=>{
  let dir;
  try {
    const source=generate(program);
    const addon=process.env.PIKA_ADDON_PATH || "E:/Spark AI 1.1.9/Spark-AI/resources/app.asar.unpacked/node_modules/pika-bytecode-gen-napi/build/Release/pika_bytecode_gen.node";
    const compiler=require(addon);
    dir=fs.mkdtempSync(path.join(os.tmpdir(),"cards-pika-"));
    const input=path.join(dir,"main.py"),output=path.join(dir,"main.py.o");
    fs.writeFileSync(input,source);
    if(compiler.compile(input,output)!==0) throw new Error("Pika 编译失败。");
    const bytecode=fs.readFileSync(output);
    if(!bytecode.length || bytecode.length>1024*1024) throw new Error("字节码大小无效。");
    process.send({source,bytecode:bytecode.toString("base64")});
  } catch(error) {process.send({error:error.code==="MODULE_NOT_FOUND" ? "未找到本机 Pika 编译器，请配置 PIKA_ADDON_PATH。" : error.message});}
  finally {if(dir) fs.rmSync(dir,{recursive:true,force:true});process.disconnect();}
});
