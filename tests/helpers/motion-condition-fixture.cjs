'use strict';
// This complete firmware identity is synthetic test data, not evidence of a
// signed 2.1.5 image or hardware validation. Production still obtains every
// field through signature verification and current App INFO.
module.exports=function featureFirmware(version=0x020105){
  const pkg={signatureVerified:true,boardId:258,version,format:2,layoutId:2,appBase:0x08003000,
    erasePage:128,imageSize:48000,imageSha256:'a'.repeat(64)};
  const state={ready:true,targetVersion:version,currentVersion:version,epoch:'current',actual:{epoch:'current',info:{
    boardId:258,protocol:1,version,mode:0,imageValid:true,schemaVersion:2,layoutId:2,
    activeAppBase:pkg.appBase,erasePage:128,imageSize:pkg.imageSize,imageSha256:pkg.imageSha256}}};
  return {bundle:{pkg},snapshot:()=>state};
};
