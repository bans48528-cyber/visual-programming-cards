(() => {
  const protocol=window.SparkProtocol;
  const page = document.createElement("section");
  page.className = "bluetooth-page";
  page.hidden = true;
  page.innerHTML = `<header class="bt-top"><button class="bt-back" type="button">← 返回编程</button><h1>蓝牙连接</h1></header>
    <main class="bt-content"><section class="bt-overview">
      <div class="bt-symbol" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m7 7 10 10-5 5V2l5 5L7 17"/></svg></div>
      <div><h2>连接 Spark_AI</h2><p>开启设备电源与蓝牙，保持设备在附近。</p></div>
    </section><div class="bt-section-header"><h2>已授权设备</h2><button class="bt-button primary bt-search" type="button">搜索设备</button></div>
    <p class="bt-message" role="status" aria-live="polite"></p><ul class="bt-list"></ul>
    <div class="bt-empty"><strong>尚未选择设备</strong><span>搜索后，在浏览器的设备列表中选择设备。</span></div>
    <p class="bt-footnote">Spark_AI · BLE FFF0 / FFF1</p><p class="bt-telemetry" role="status"></p>
    <details class="bt-diagnostics"><summary>通讯诊断</summary><pre class="bt-trace"></pre><button class="bt-button bt-export" type="button">导出诊断</button></details>
    </main>`;
  document.body.append(page);
  const trigger = document.getElementById("bluetoothBtn");
  const search = page.querySelector(".bt-search");
  const message = page.querySelector(".bt-message");
  const traceRows=[],eventRows=[];
  let traceSequence=0,traceTimer=null;
  function trace(kind,bytes,detail="") {
    const hex=bytes ? Array.from(bytes.slice(0,256),b=>b.toString(16).padStart(2,"0").toUpperCase()).join(" ") : "";
    const entry={id:++traceSequence,line:`${new Date().toISOString()} ${kind} ${detail} ${bytes ? `[${bytes.length} bytes] ${hex}${bytes.length>256?" …":""}` : ""}`};
    traceRows.push(entry);
    if(traceRows.length>1000) traceRows.shift();
    // Keep control events independently so telemetry cannot evict the stop request.
    if(kind!=="RX") {eventRows.push(entry);if(eventRows.length>2000) eventRows.shift();}
    if(traceTimer===null) traceTimer=setTimeout(()=>{
      traceTimer=null;
      page.querySelector(".bt-trace").textContent=traceRows.slice(-100).map(row=>row.line).join("\n");
    },200);
  }
  page.querySelector(".bt-export").onclick=()=>{
    const entries=[...new Map([...eventRows,...traceRows].map(row=>[row.id,row])).values()].sort((a,b)=>a.id-b.id);
    const header=`Spark BLE diagnostics v2\nExported: ${new Date().toISOString()}\nRetention: latest 2000 control/status events + latest 1000 entries; older raw RX may be omitted.\n\n`;
    const url=URL.createObjectURL(new Blob([header+entries.map(row=>row.line).join("\n")],{type:"text/plain;charset=utf-8"}));
    const a=document.createElement("a");a.href=url;a.download="spark-ble-diagnostics.txt";a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  const devices = new Map();
  const api = navigator.bluetooth;
  const supported = window.isSecureContext && Boolean(api?.requestDevice);
  let searching = false, connecting = null, current = null, link = null;
  let preparing=false, stopping=0, operation=0;
  const deviceStates=new WeakMap();
  function requireStopped(active) {
    const status=deviceStates.get(active);
    if(!status || performance.now()-status.time>2000) throw new Error("设备状态未知或已过期，未发送程序。请等待停止状态上报。");
    if(status.value!=="stop") throw new Error("设备程序正在运行，未发送程序。请先暂停设备。");
  }
  async function waitForStopped(active,ticket,sentAt,timeoutMs=5000) {
    const deadline=performance.now()+timeoutMs;
    while(performance.now()<deadline) {
      if(ticket!==operation || active!==link || !ready()) throw new Error("发送已取消或设备已断开。");
      const status=deviceStates.get(active);
      if(status && status.time>=sentAt && status.value==="stop") return status;
      await new Promise(resolve=>{
        let timer;
        const wake=()=>{clearTimeout(timer);window.removeEventListener("spark-status",wake);resolve();};
        window.addEventListener("spark-status",wake,{once:true});
        timer=setTimeout(wake,Math.min(250,Math.max(0,deadline-performance.now())));
      });
    }
    return null;
  }
  async function stopBeforeRun(active,ticket) {
    const currentStatus=deviceStates.get(active);
    if(currentStatus && performance.now()-currentStatus.time<=2000 && currentStatus.value==="stop") return;
    trace("RUN_STOP_REQUEST",null,`state=${currentStatus?.value ?? "unknown"} ageMs=${currentStatus ? Math.round(performance.now()-currentStatus.time) : "unknown"} count=5 intervalMs=80`);
    let sentAt=Infinity;
    const sent=await active.stop(()=>{
      if(ticket!==operation || active!==link || !ready()) return false;
      if(sentAt===Infinity) {
        sentAt=performance.now();
        deviceStates.delete(active);renderDeviceStatus();
      }
      return true;
    });
    if(!sent) throw new Error("发送已取消或设备已断开。");
    notice("已发送5次暂停请求，正在等待设备停止…");
    const waitStarted=performance.now();
    const status=await waitForStopped(active,ticket,sentAt,5000);
    trace("RUN_STOP_CHECK",null,`stopped=${Boolean(status)} state=${status?.value ?? "unknown"} waitMs=${Math.round(performance.now()-waitStarted)}`);
    if(!status) throw new Error("等待设备停止超时，未发送程序。请使用软件或硬件暂停程序。");
  }
  async function prepareRunState(active,ticket) {
    if(deviceStates.get(active)) {
      await stopBeforeRun(active,ticket);
      return false;
    }
    trace("RUN_WAITING_WATCH",null,"state=waiting delayMs=500");
    const watched=await active.write(protocol.frame(protocol.CMD.WATCH),undefined,()=>ticket===operation && active===link && ready());
    if(!watched) throw new Error("发送已取消或设备已断开。");
    notice("正在请求设备状态，0.5秒后继续发送…");
    await new Promise(resolve=>setTimeout(resolve,500));
    if(ticket!==operation || active!==link || !ready()) throw new Error("发送已取消或设备已断开。");
    const status=deviceStates.get(active);
    trace("RUN_WAITING_CHECK",null,`state=${status?.value ?? "waiting"} ageMs=${status ? Math.round(performance.now()-status.time) : "unknown"}`);
    if(status) {
      await stopBeforeRun(active,ticket);
      return false;
    }
    return true;
  }
  function requireRunReady(active,allowWaiting) {
    if(allowWaiting && !deviceStates.get(active)) return;
    requireStopped(active);
  }
  const ready=()=>Boolean(current?.gatt?.connected && link && !link.closed);
  const deviceStatus=document.getElementById("deviceStatus");
  function renderDeviceStatus() {
    const status=link && deviceStates.get(link);
    const state=!ready() ? (connecting ? "connecting" : "disconnected")
      : !status ? "waiting" : performance.now()-status.time>2000 ? "stale" : status.value;
    const labels={disconnected:"设备未连接",connecting:"设备连接中",waiting:"等待状态上报",stale:"设备状态已过期",run:"设备运行中",stop:"设备已停止"};
    if(deviceStatus.dataset.state!==state || deviceStatus.textContent!==labels[state]) {
      deviceStatus.dataset.state=state;
      deviceStatus.textContent=labels[state];
    }
  }
  setInterval(renderDeviceStatus,250);
  function notice(text) {window.showExecutionNotice?.(text);}
  function tell(text, error = false) { message.textContent = text;message.classList.toggle("error",error); }
  function add(device) {
    if (devices.has(device.id)) return devices.get(device.id);
    devices.set(device.id,device);
    device.addEventListener("gattserverdisconnected",()=>{
      if (current?.id === device.id) {
        trace("DISCONNECTED",null,device.name || "设备");
        link?.close();link=null;current=null;operation++;
        tell(`${device.name || "设备"}已断开连接。`);
        notice("蓝牙已断开，不能确认硬件是否仍在运行，请检查设备。");
      }
      render();
    });
    return device;
  }
  function render() {
    renderDeviceStatus();
    search.disabled = !supported || searching || Boolean(connecting) || preparing;
    search.textContent = searching ? "选择设备中…" : "搜索设备";
    const list = page.querySelector(".bt-list");list.replaceChildren();
    page.querySelector(".bt-empty").hidden = Boolean(devices.size);
    devices.forEach(device=>{
      const connected = ready() && device.id===current.id;
      const row = document.createElement("li");row.className="bt-device";
      const info=document.createElement("div");info.className="bt-device-info";
      const name=document.createElement("strong");name.textContent=device.name || "未命名设备";
      const status=document.createElement("small");status.textContent=connecting===device.id ? "正在连接…" : connected ? "已连接" : "未连接";
      status.classList.toggle("connected",connected);
      const action=document.createElement("button");action.type="button";action.className="bt-button";
      action.textContent=connected ? "断开" : "连接";action.disabled=Boolean(connecting)||searching||!supported||preparing;
      action.onclick=()=>connected ? device.gatt.disconnect() : connect(device);
      info.append(name,status);row.append(info,action);list.append(row);
    });
    const connected = ready();
    document.getElementById("runProgramBtn").disabled=preparing || stopping;
    trigger.classList.toggle("is-connected",connected);
    trigger.classList.toggle("is-connecting",!connected && Boolean(connecting || searching));
    const connectionLabel=connected ? `蓝牙已连接：${current.name || "设备"}` : connecting ? "蓝牙正在连接" : searching ? "蓝牙正在搜索" : "蓝牙未连接";
    trigger.title=connectionLabel;
    trigger.setAttribute("aria-label",connectionLabel);
  }
  function failure(error) {
    const messages = {
      NotFoundError: "未选择设备，或没有找到设备。可以重新搜索。",
      NotAllowedError: "蓝牙权限未获允许，请检查浏览器的网站权限。",
      SecurityError: "浏览器阻止了蓝牙访问。请使用支持蓝牙的浏览器，并通过 HTTPS 或本机地址打开。",
      NetworkError: "连接失败，请确认设备已开机、距离较近，且未被其他应用占用。",
      NotSupportedError: "该设备或浏览器不支持此蓝牙连接方式。",
      TimeoutError: "连接超时，请靠近设备后重试。"
    };
    tell(messages[error?.name] || error?.message || "蓝牙操作失败，请检查系统蓝牙状态后重试。",error?.name!=="NotFoundError");
  }
  async function connect(device) {
    if(connecting || preparing || (ready() && current.id===device.id)) return;
    if(!device.gatt) {failure({name:"NotSupportedError"});return;}
    connecting=device.id;tell(`正在连接${device.name || "设备"}…`);render();
    let expired=false,timer,candidate,lastReported=null,lastReportTime=-Infinity;
    try {
      const guard=()=>{if(expired || !device.gatt.connected) {candidate?.close();device.gatt.disconnect();throw new DOMException("Timeout","TimeoutError");}};
      const connection=(async()=>{
        const server=await device.gatt.connect();guard();
        const service=await server.getPrimaryService(protocol.SERVICE);guard();
        const characteristic=await service.getCharacteristic(protocol.CHARACTERISTIC);guard();
        candidate=new protocol.Link(characteristic,{
          onTrace:trace,
          onStatus:status=>{
            const value=status?.WillAiState ?? "unknown",now=performance.now();
            if(value!==lastReported || now-lastReportTime>=1000) {
              trace("STATUS",null,`WillAiState=${value}`);lastReported=value;lastReportTime=now;
            }
            if(status && ["run","stop"].includes(status.WillAiState)) {
              deviceStates.set(candidate,{value:status.WillAiState,time:performance.now()});
            } else deviceStates.delete(candidate);
            renderDeviceStatus();
            window.dispatchEvent(new CustomEvent("spark-status",{detail:status}));
            page.querySelector(".bt-telemetry").textContent=`收到设备状态 · ${new Date().toLocaleTimeString()}`;
          },
          onProgress:(n,total)=>notice(`正在发送程序 ${n}/${total}`),
          onError:error=>{deviceStates.delete(candidate);renderDeviceStatus();tell(error.message,true);}
        });
        await candidate.start();guard();
      })();
      await Promise.race([connection,new Promise((_,reject)=>{timer=setTimeout(()=>{expired=true;device.gatt.disconnect();reject(new DOMException("Timeout","TimeoutError"));},15000);})]);
      if(current && current.id!==device.id) current.gatt?.disconnect();
      current=device;link=candidate;tell(`已连接${device.name || "设备"}，通讯就绪。`);
    } catch(error) {
      expired=true;candidate?.close();device.gatt.disconnect();
      failure(error.name==="NotFoundError" ? new Error("未找到 FFF0 / FFF1 服务。请重新搜索授权，或检查设备固件。") : error);
    }
    finally {clearTimeout(timer);connecting=null;render();}
  }
  search.onclick=async()=>{
    if(!supported || searching || connecting) return;
    searching=true;tell("请在浏览器弹出的列表中选择设备。");render();
    try {
      const device=add(await api.requestDevice({filters:[{name:"Spark_AI"}],optionalServices:[protocol.SERVICE]}));
      searching=false;
      await connect(device);
    } catch(error) {failure(error);}
    finally {searching=false;render();}
  };
  async function authorizedDevices() {
    if(!supported || !api.getDevices) return;
    try {(await api.getDevices()).filter(d=>d.name==="Spark_AI").forEach(add);render();} catch(error) {failure(error);}
  }
  async function runProgram(snapshot) {
    if(!ready()) {notice("请先连接 Spark_AI 设备。");location.hash="bluetooth";return;}
    if(preparing || stopping) return;
    if(!snapshot.length) {notice("请先放入积木。");return;}
    const ticket=++operation, active=link;
    preparing=true;render();
    try {
      const allowWaiting=await prepareRunState(active,ticket);
      notice("正在编译当前程序…");
      if(!["127.0.0.1","localhost"].includes(location.hostname)) throw new Error("当前编译器运行在电脑本机，请在电脑上发送；手机编译服务尚未配置。");
      let response;
      try {response=await fetch("http://127.0.0.1:4180/compile",{
        method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({program:snapshot}),signal:AbortSignal.timeout(20000)
      });} catch {throw new Error("无法访问本机编译服务，请启动 node compiler-server.cjs。");}
      const result=await response.json();
      if(!response.ok) throw new Error(result.error||"编译失败。");
      if(ticket!==operation || active!==link || !ready()) throw new Error("发送已取消或设备已断开。");
      const bytes=Uint8Array.from(atob(result.bytecode),c=>c.charCodeAt(0));
      requireRunReady(active,allowWaiting);
      deviceStates.delete(active);
      renderDeviceStatus();
      await active.upload(bytes,{slot:0,run:true,allowUnverifiedAck:true});
      if(ticket===operation) notice("程序已发送并请求运行；实际运行状态请查看设备。");
    } catch(error) {if(ticket===operation) {notice(error.message);tell(error.message,true);}}
    finally {preparing=false;render();}
  }
  async function stopProgram() {
    const status=link && deviceStates.get(link);
    trace("STOP_REQUEST",null,`connected=${ready()} state=${status?.value ?? "unknown"} ageMs=${status ? Math.round(performance.now()-status.time) : "unknown"}`);
    operation++;
    if(!ready()) {notice("设备未连接，无法发送停止指令，请检查硬件。");return;}
    const active=link;
    active.cancelUpload();
    const alreadyStopped=Boolean(status && status.value==="stop" && performance.now()-status.time<=2000);
    if(alreadyStopped) {
      trace("STOP_SKIPPED",null,"state=stop; no D0 or B9 sent");
      notice("设备已停止，未发送暂停指令。");
      render();
      return;
    }
    stopping++;render();
    try {
      const waiting=!deviceStates.get(active);
      const shouldSend=()=>{
        if(active!==link || !ready()) return false;
        deviceStates.delete(active);renderDeviceStatus();
        return true;
      };
      let sent;
      if(waiting) {
        trace("STOP_WAITING_WATCH",null,"state=waiting delayMs=200 count=1");
        sent=await active.write(protocol.frame(protocol.CMD.WATCH),undefined,shouldSend);
        if(sent) {
          await new Promise(resolve=>setTimeout(resolve,200));
          sent=await active.write(protocol.frame(protocol.CMD.STOP),undefined,shouldSend);
        }
      } else sent=await active.stop(shouldSend);
      notice(sent
        ? waiting ? "已发送监控指令（D0），间隔0.2秒后发送一次暂停请求（B9）；实际状态以设备上报为准。" : "已连续发送5次暂停请求（B9），间隔0.08秒；实际状态以设备上报为准。"
        : "设备连接已变化，剩余暂停请求未发送。");
      trace("STOP_WRITE_RESULT",null,`sent=${sent} mode=${waiting ? "waiting-watch" : "burst"}; write completion is not hardware stop confirmation`);
    }
    catch(error) {trace("STOP_ERROR",null,error.message);notice(`停止发送失败：${error.message}`);}
    finally {stopping--;render();}
  }
  window.CardBluetooth={runProgram,stopProgram,get connected(){return ready();}};
  function route() {
    const show=location.hash==="#bluetooth";
    page.hidden=!show;document.body.classList.toggle("bluetooth-open",show);
    if(show) {
      closeParamEditor();document.title="蓝牙连接 · 卡片编程";
      if(!window.isSecureContext) tell("蓝牙需要安全连接。请使用 HTTPS，或在本机通过 localhost / 127.0.0.1 打开；手机访问局域网 HTTP 地址无法使用。",true);
      else if(!supported) tell("当前浏览器不支持网页蓝牙。请在支持 Web Bluetooth 的 Chrome 或 Edge 中打开；iPhone / iPad 的常见浏览器暂不支持。",true);
      else if(!message.textContent) tell("点击搜索设备，会打开浏览器的蓝牙设备选择器。");
      render();authorizedDevices();
    } else if(location.hash==="#editor") {
      document.title=`${document.querySelector(".brand-title").textContent} · 卡片编程`;
      updateProgramAnchor();
    }
  }
  trigger.onclick=()=>{location.hash="bluetooth";};
  page.querySelector(".bt-back").onclick=()=>{location.hash="editor";};
  window.addEventListener("hashchange",route);
  route();
})();
