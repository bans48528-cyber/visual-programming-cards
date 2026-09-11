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
    <header class="home-heading"><div><h1>卡片编程</h1><p>电机 · 传感 · 声光</p></div><button class="home-primary" id="newProject"><span aria-hidden="true">+</span>新建作品</button></header>
    <div class="home-feature" aria-hidden="true"></div>
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
      const scale = Math.min(1, (wrap.clientWidth-12)/(layout.advance+8), 110/layout.height);
      sequence.style.transform = `scale(${Math.max(.1,scale)})`;
      sequence.style.top = `${Math.max(0,(110-layout.height*scale)/2)}px`;
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
    home.querySelector(".home-feature").replaceChildren(preview([
      makeItem("motor-forward"),makeItem("loop-count",{count:3},[makeItem("combo-forward"),makeItem("wait-time")]),makeItem("matrix-display")
    ]));
  }
  function showHome() {
    closeParamEditor();home.hidden=false;document.body.classList.add("home-open");
    document.title="卡片编程";render();
  }
  home.querySelector("#newProject").onclick = () => ask("新建作品", `我的作品 ${projects.length+1}`, name=>create(name));
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
