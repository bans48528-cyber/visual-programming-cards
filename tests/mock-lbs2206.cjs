module.exports=function(){
 const original=Capacitor.nativePromise;
 const c=window.mockBle;c.lbsState=(values,id=c.connectionId)=>c.feed(String.fromCharCode(...Lbs2206Protocol.encode(values)),id);
 Capacitor.nativePromise=async(plugin,method,options={})=>{
   if(plugin!=='SparkBle')return original(plugin,method,options);
   if(method==='connect'&&['inspect','lbs2206'].includes(options.profile)){
     c.calls.push({method,...options});await new Promise(r=>setTimeout(r,c.connectionDelay));
     if(options.profile==='inspect')return {services:[{uuid:'11111111-1111-1111-1111-111111111111',characteristics:[{uuid:'22222222-2222-2222-2222-222222222222',properties:8},{uuid:'33333333-3333-3333-3333-333333333333',properties:16}]}]};
     c.lbs=true;c.connectionId=options.connectionId;return {properties:{write:true,notify:true}};
   }
   if(method==='write'&&c.lbs){
     if(options.connectionId!==c.connectionId)throw new Error('stale connection');c.calls.push({method,...options});
     const bytes=Uint8Array.from(atob(options.data),x=>x.charCodeAt(0));c.lbsWrites??=[];c.lbsWrites.push(Array.from(bytes));
     if(bytes[0]===115){c.feed('Ver=1.02\r\n');return;}
     const data=Lbs2206Protocol.decode(bytes);const id=c.connectionId;
     if(data[0]===123&&data.length>2&&c.autoReports)setTimeout(()=>c.lbsState([0,0,0,6],id),5);
     if(data[0]===123&&data[1]===10&&c.autoStop)setTimeout(()=>c.lbsState([0,0,0,13],id),5);
     return;
   }
   return original(plugin,method,options);
 };
};
