(() => {
  const KEY = "cardProjectsV1";
  const ACTIVE = "cardActiveProjectV1";
  const clone = value => JSON.parse(JSON.stringify(value));
  let projects = [], activeId = null, view = "files";
  const makeItem = (id, params = {}, children) => {
    const item = createProgramItem(id);
    Object.assign(item.params || {}, params);
    if (children) item.children = children;
    return item;
  };
  const examples = [
    {name: "电机往返", color: "#edf5ff", items: [makeItem("motor-forward"), makeItem("wait-time"), makeItem("motor-reverse")]},
    {name: "重复转向", color: "#fff5dc", items: [makeItem("loop-count", {count: 4}, [makeItem("combo-forward"), makeItem("combo-turn-right")])]},
    {name: "点阵与音符", color: "#f3edff", items: [makeItem("matrix-display"), makeItem("play-note", {note: "3"}), makeItem("wait-time")]}
  ];
  const home = document.createElement("section");
  home.className = "home-screen";
  home.setAttribute("aria-label", "卡片编程主页");
  home.innerHTML = `<nav class="home-sidebar" aria-label="主页导航">
    <button class="home-nav" data-view="files" role="tab"><img src="assets/home-icon-file.png" alt=""><span>我的作品</span></button>
    <button class="home-nav" data-view="examples" role="tab"><img src="assets/home-icon-build.png" alt=""><span>积木示例</span></button>
    <span class="home-local">保存在此设备</span>
  </nav><main class="home-main">
    <section class="home-start" aria-labelledby="homeStartTitle">
      <div class="home-start-copy">
        <h1 id="homeStartTitle"><span>从这里开始</span><strong>构建新的程序</strong></h1>
        <div class="home-start-actions">
          <button class="home-start-button" id="newProject" type="button">
            <svg viewBox="0 0 80 72" aria-hidden="true"><path d="M17 11h29l15 15v33a6 6 0 0 1-6 6H17a6 6 0 0 1-6-6V17a6 6 0 0 1 6-6" fill="#d9eeff"/><path d="M24 5h27l15 15v32a6 6 0 0 1-6 6H24a6 6 0 0 1-6-6V11a6 6 0 0 1 6-6" fill="#248ff1"/><path d="M51 5v15h15" fill="#a9d9ff"/><path d="M29 30h24M29 39h15" stroke="white" stroke-width="4" stroke-linecap="round"/><circle cx="60" cy="55" r="15" fill="#fff"/><path d="M60 47v16m-8-8h16" stroke="#248ff1" stroke-width="4" stroke-linecap="round"/></svg>
            <span>新建作品</span>
          </button>
          <button class="home-start-button home-resume" id="resumeProject" type="button" hidden>
            <svg viewBox="0 0 80 72" aria-hidden="true"><rect x="12" y="10" width="57" height="48" rx="10" fill="#e0f2ff"/><path d="M35 26 23 38l12 12M25 38h22q14 0 14-14" fill="none" stroke="#278ce6" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <span>返回编辑</span>
          </button>
        </div>
      </div>
      <div class="home-demo" aria-hidden="true">
        <div class="home-demo-flow">
          <div class="home-demo-blocks"></div>
          <span class="home-demo-caption">编程演示</span>
        </div>
        <span class="home-demo-arrow">→</span>
        <div class="home-demo-robot">
          <svg viewBox="0 0 200 220" focusable="false">
            <defs><linearGradient id="homeRobotShell" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fff"/><stop offset="1" stop-color="#d8ecff"/></linearGradient></defs>
            <ellipse cx="101" cy="202" rx="70" ry="9" fill="#2a8be6" opacity=".12"/>
            <path d="M81 173v19m40-19v19" stroke="#84b9e5" stroke-width="17" stroke-linecap="round"/>
            <path d="M70 196h21m20 0h21" stroke="#f9fcff" stroke-width="17" stroke-linecap="round"/>
            <g class="home-robot-wave"><path d="M65 122 39 108 29 79" fill="none" stroke="#83baf0" stroke-width="16" stroke-linecap="round"/><rect x="17" y="60" width="24" height="30" rx="10" fill="url(#homeRobotShell)"/><path d="M25 61v-7m9 9 4-6" stroke="#83baf0" stroke-width="5" stroke-linecap="round"/></g>
            <path d="m136 123 22 14 8 22" fill="none" stroke="#83baf0" stroke-width="16" stroke-linecap="round"/><circle cx="167" cy="163" r="12" fill="url(#homeRobotShell)"/>
            <rect x="62" y="109" width="77" height="69" rx="23" fill="url(#homeRobotShell)" stroke="#c4dff4" stroke-width="2"/>
            <rect x="82" y="124" width="38" height="35" rx="8" fill="#277dc6"/>
            <g class="home-robot-lights" fill="#a9f8e2"><circle cx="93" cy="134" r="3"/><circle cx="109" cy="134" r="3"/><path d="M91 146q10 9 20 0" fill="none" stroke="#a9f8e2" stroke-width="3" stroke-linecap="round"/></g>
            <path d="M100 40V23" stroke="#8fbfe6" stroke-width="6"/><circle cx="100" cy="19" r="7" fill="#2394f3"/>
            <rect x="45" y="42" width="111" height="64" rx="24" fill="url(#homeRobotShell)" stroke="#c4dff4" stroke-width="2"/>
            <rect x="58" y="55" width="85" height="36" rx="14" fill="#b9e2fc"/>
            <path d="M77 73v2m46-2v2" stroke="#28658f" stroke-width="8" stroke-linecap="round"/><path d="M94 79q6 6 12 0" fill="none" stroke="#28658f" stroke-width="3" stroke-linecap="round"/>
          </svg>
        </div>
      </div>
    </section>
    <div class="home-section-heading"><h2></h2><span></span></div>
    <div class="home-grid"></div><div class="home-empty" hidden><img src="assets/home-icon-file.png" alt=""><p>还没有保存的作品</p></div>
    <p class="home-error" role="alert" hidden></p>
  </main>`;
  document.body.prepend(home);
  const dialog = document.createElement("dialog");
  dialog.className = "home-dialog";
  dialog.innerHTML = `<form><h2 id="projectDialogTitle"></h2><input aria-label="作品名称" maxlength="40" required><p hidden></p><div class="home-dialog-actions"><button type="button">取消</button><button type="submit">确定</button></div></form>`;
  dialog.setAttribute("aria-labelledby", "projectDialogTitle");
  document.body.append(dialog);
  let dialogAction = null;
  dialog.querySelector('[type="button"]').onclick = () => dialog.close();
  dialog.querySelector("form").onsubmit = event => {
    event.preventDefault();
    const name = dialog.querySelector("input").value.trim();
    if (!dialog.querySelector("input").hidden && !name) return;
    dialog.close();
    dialogAction?.(name);
  };
  function ask(title, initial, action, deletion = false) {
    dialogAction = action;
    dialog.querySelector("h2").textContent = title;
    const input = dialog.querySelector("input");
    input.hidden = deletion; input.required = !deletion; input.value = initial;
    const note = dialog.querySelector("p");
    note.hidden = !deletion; note.textContent = `删除“${initial}”？此操作无法撤销。`;
    dialog.querySelector('[type="submit"]').textContent = deletion ? "删除" : "确定";
    dialog.showModal();
    if (!deletion) { input.focus(); input.select(); }
  }
  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(projects)); return true; }
    catch {
      setStatus("保存失败：设备存储空间不足或不可用");
      const error = home.querySelector(".home-error");
      error.hidden = false; error.textContent = "保存失败：设备存储空间不足或不可用。";
      return false;
    }
  }
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) projects = parsed.filter(p => p && typeof p.id === "string" && typeof p.name === "string" && p.state);
    } else {
      const legacy = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
      if (legacy) {
        const state = JSON.parse(legacy);
        projects.push({id: crypto.randomUUID(), name: "原有作品", updated: Date.now(), state});
        persist();
      }
    }
    activeId = localStorage.getItem(ACTIVE);
  } catch { setStatus("作品列表读取失败，原有保存内容未修改"); }
  function saveActive() {
    const project = projects.find(p => p.id === activeId);
    if (!project) return false;
    project.state = serializeWorkspaceState(); project.updated = Date.now();
    if (persist()) setStatus("作品已保存");
    return true;
  }
  window.CardHome = {
    save: saveActive,
    load() {
      const project = projects.find(p => p.id === activeId);
      if (!project) return false;
      applyWorkspaceState(clone(project.state));renderProgram();renderPalette();commitHistory();setStatus("已读取作品");
      return true;
    }
  };
  function enter(project, navigate = true) {
    activeId = project.id;
    try { localStorage.setItem(ACTIVE, activeId); } catch { /* Saving reports storage failures. */ }
    home.hidden = true;document.body.classList.remove("home-open");
    applyWorkspaceState(clone(project.state));
    historySnapshots = [];historyIndex = -1;
    renderProgram();renderPalette();commitHistory();
    programCanvas.scrollLeft = 0;programCanvas.scrollTop = 0;
    document.querySelector(".brand-title").textContent = project.name;
    document.title = `${project.name} · 卡片编程`;
    if (navigate) location.hash = "editor";
  }
  function create(name, state = {program: [], stagedGroups: []}) {
    const project = {id: crypto.randomUUID(), name, updated: Date.now(), state: clone(state)};
    projects.unshift(project);
    if (persist()) enter(project);
  }
  function preview(items, includeStart = false) {
    const wrap = document.createElement("div");wrap.className = "home-preview";
    const sequence = document.createElement("div");sequence.className = "home-preview-chain";
    if (includeStart) {
      const start = document.createElement("div");
      start.className = "block start";
      start.setAttribute("aria-hidden", "true");
      sequence.append(start);
    }
    items.forEach(item => sequence.appendChild(createStagedPreviewNode(item)));
    sequence.querySelectorAll("[data-node-path], [data-mode]").forEach(el => {delete el.dataset.nodePath;delete el.dataset.mode;});
    const layout = BlockLayout.sequence(sequence);
    wrap.append(sequence);
    requestAnimationFrame(() => {
      const height = wrap.clientHeight || 110;
      const scale = Math.min(1, (wrap.clientWidth-12)/(layout.advance+8), height/layout.height);
      sequence.style.transform = `scale(${Math.max(.1,scale)})`;
      sequence.style.top = `${Math.max(0,(height-layout.height*scale)/2)}px`;
    });
    return wrap;
  }
  function card(project, index, example = false) {
    const article = document.createElement("article");article.className = "home-card";
    article.style.setProperty("--thumb-color", example ? project.color : ["#edf5ff","#fff5dc","#eef8f3","#f3edff"][index%4]);
    const open = document.createElement("button");open.className = "home-card-open";
    open.setAttribute("aria-label", `${example ? "使用示例" : "打开"}：${project.name}`);
    const thumb = document.createElement("div");thumb.className = "home-thumb";
    const state = project.state;
    const items = example ? project.items : (Array.isArray(state) ? state : state.program || []);
    thumb.append(preview(items, !example));
    const text = document.createElement("div");text.className = "home-card-text";
    const name = document.createElement("strong");name.textContent = project.name;
    const meta = document.createElement("small");
    meta.textContent = example ? `${countProgramItems(items)} 张积木` : new Date(project.updated).toLocaleString("zh-CN", {month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"});
    text.append(name,meta);open.append(thumb,text);article.append(open);
    open.onclick = () => example ? create(project.name,{program:project.items,stagedGroups:[]}) : enter(project);
    if (!example) {
      const menu = document.createElement("details");menu.className = "home-menu";
      const summary = document.createElement("summary");summary.textContent = "⋯";summary.setAttribute("aria-label",`${project.name}更多操作`);
      const actions = document.createElement("div");actions.className = "home-menu-items";
      const commands = {
        "重命名": () => ask("重命名作品", project.name, name => {project.name=name;persist();render();}),
        "复制": () => {projects.unshift({...clone(project),id:crypto.randomUUID(),name:`${project.name} 副本`,updated:Date.now()});persist();render();},
        "删除": () => ask("删除作品",project.name,()=>{projects=projects.filter(p=>p.id!==project.id);persist();render();},true)
      };
      Object.entries(commands).forEach(([label, action])=>{const button=document.createElement("button");button.textContent=label;button.onclick=()=>{menu.open=false;action();};actions.append(button);});
      menu.append(summary,actions);article.append(menu);
    }
    return article;
  }
  function render() {
    home.querySelectorAll(".home-nav").forEach(button=>button.setAttribute("aria-selected",String(button.dataset.view===view)));
    const example = view === "examples";
    const entries = example ? examples : [...projects].sort((a,b)=>b.updated-a.updated);
    home.querySelector(".home-section-heading h2").textContent = example ? "积木示例" : "最近作品";
    home.querySelector(".home-section-heading span").textContent = `${entries.length} 个${example ? "示例" : "作品"}`;
    home.querySelector(".home-grid").replaceChildren(...entries.map((p,i)=>card(p,i,example)));
    home.querySelector(".home-empty").hidden = Boolean(entries.length);
    home.querySelector('#resumeProject').hidden = !projects.some(p => p.id === activeId);
    const demo = preview([makeItem('motor-forward'), makeItem('matrix-display', {
      pattern: [0,0,0,0,0, 0,1,0,1,0, 0,0,0,0,0, 1,0,0,0,1, 0,1,1,1,0]
    })], true);
    // Decorative, read-only clones use the same shapes and layout as the editor.
    demo.querySelectorAll('button, [tabindex]').forEach(el => el.tabIndex = -1);
    home.querySelector('.home-demo-blocks').replaceChildren(demo);
  }
  function showHome() {
    closeParamEditor();home.hidden=false;document.body.classList.add("home-open");
    document.title="卡片编程";render();
  }
  home.querySelector("#newProject").onclick = () => ask("新建作品", `我的作品 ${projects.length+1}`, name=>create(name));
  home.querySelector('#resumeProject').onclick = () => {
    const project = projects.find(p => p.id === activeId);
    if (project) enter(project);
  };
  home.querySelectorAll(".home-nav").forEach(button=>button.onclick=()=>{view=button.dataset.view;render();});
  document.getElementById("homeBtn").onclick = () => {saveActive();location.hash="home";showHome();};
  window.addEventListener("hashchange",()=>{
    if(location.hash==="#bluetooth") return;
    if(location.hash!=="#editor") {if(home.hidden)saveActive();showHome();}
    else if(!home.hidden) {
      const project=projects.find(p=>p.id===activeId);
      if(project)enter(project);else {home.hidden=true;document.body.classList.remove("home-open");updateProgramAnchor();}
    }
  });
  window.addEventListener("beforeunload",()=>{if(home.hidden)saveActive();});
  window.addEventListener("resize",()=>{if(!home.hidden)render();});
  if(location.hash==="#editor" || location.hash==="#bluetooth") {
    const project=projects.find(p=>p.id===activeId);
    if(project)enter(project, false);else home.hidden=true;
  } else showHome();
})();
