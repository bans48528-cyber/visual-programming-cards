window.viewerVisit=new URLSearchParams(location.search).get('visit');
window.viewerBase=new URL('./',location.href).href;
window.viewerExit=function(type='close'){if(parent!==window)parent.postMessage({source:'building-viewer',type,visit:window.viewerVisit},location.origin);};
window.addEventListener('message',event=>{if(event.source!==parent||event.origin!==location.origin)return;if(event.data?.source==='building-host'&&event.data.type==='back'){
 if(window.viewerSettingsBack){window.viewerSettingsBack();return;}
 if(location.pathname.endsWith('/settings.html'))document.getElementById('settings-back')?.click();
 else {const close=document.getElementById('preview_background');if(close&&close.getClientRects().length)close.click();else window.viewerExit();}
}});
document.addEventListener('click',event=>{const link=event.target.closest('a');if(!link)return;const url=new URL(link.href,location.href);if(url.pathname.endsWith('/exit.html')){event.preventDefault();window.viewerExit();}else if(url.origin!==location.origin){event.preventDefault();}},true);
