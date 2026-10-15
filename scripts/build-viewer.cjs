const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),out=path.join(root,'dist/viewer');
fs.cpSync(path.join(root,'viewer-source'),out,{recursive:true});
function edit(name,fn){const p=path.join(out,name);fs.writeFileSync(p,fn(fs.readFileSync(p,'utf8')));}
for(const name of ['instructions.html','view.html','settings.html'])edit(name,s=>s.replace(/(src|href)="\/(app|js)\//g,'$1="$2/').replace("'/instructions.html?id='","'instructions.html?id='").replace("homeLink: '/'","homeLink: 'exit.html'").replace('href="/"','href="exit.html"').replace('<head>','<head><script src="host.js"></script>'));
edit('app/importer.js',s=>s.replace("from '/app/zip-full.min.js'","from './zip-full.min.js'"));
edit('app/library.js',s=>s.replace("fetch(url)","fetch(window.viewerBase+url.slice(1))").replace('const [standard,custom]=records;',`const [standard,custom]=records;
for(const record of records)for(const part of Object.values(record.manifest.parts))if(part.url?.startsWith('/'))part.url=window.viewerBase+part.url.slice(1);`));
edit('app/viewer-adapter.js',s=>s.replace("back.href='/'","back.href='exit.html'").replace('返回选择模型','返回搭建图列表').replace('请返回首页重新选择文件','请返回搭建图列表重新选择').replace("||'/library/'","||window.viewerBase+'library/'").replace("id=>'/library/textures/'","id=>window.viewerBase+'library/textures/'").replace("location.pathname==='/instructions.html'","location.pathname.endsWith('/instructions.html')").replace('prepareSettingsPage();',"prepareSettingsPage();LDR.InstructionsManager.prototype.clickDone=()=>{};"));
for(const name of ['app/settings-navigation.js','app/settings.js'])edit(name,s=>s.replace("new URL('/settings.html',location.origin)","new URL('settings.html',window.viewerBase)").replace("new URL('/instructions.html',location.origin)","new URL('instructions.html',window.viewerBase)"));
edit('app/toolbar.js',s=>s.replace("buttons.homeButton.href='/'","buttons.homeButton.href='exit.html'").replace("image.src='/app/icons/'","image.src=window.viewerBase+'app/icons/'"));
edit('app/store.js',s=>s.replace('lego-local-models','xiaobai-building-models-v1'));
console.log('Built offline viewer subdirectory, without file-import UI or sample catalog.');

edit('view.html',s=>s.replace('<body>', '<body><a href="exit.html" aria-label="返回首页" style="position:fixed;top:8px;left:8px;z-index:20;width:clamp(24px,10.43vmin,60px);height:clamp(24px,10.43vmin,60px)"><img src="app/icons/return.svg" alt="" style="width:100%;height:100%"></a>'));

require('node:child_process').execFileSync(process.execPath,[path.join(__dirname,'prepare-buildings.mjs')],{stdio:'inherit'});
