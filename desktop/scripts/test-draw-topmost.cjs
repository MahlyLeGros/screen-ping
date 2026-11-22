const assert=require('assert/strict');
const windowsPath=require.resolve('../dist/main/windows.js');
const nativePath=require.resolve('../dist/main/win32Overlay.js');
const calls=[];
require.cache[windowsPath]={id:windowsPath,filename:windowsPath,loaded:true,exports:{
 showOverlayWindow:()=>calls.push('show'),parkOverlayWindow:()=>calls.push('park'),
 applyOverlayTopMost:()=>{},reinforceOverlayWindow:(_,raise)=>calls.push(raise?'raise':'light'),
}};
require.cache[nativePath]={id:nativePath,filename:nativePath,loaded:true,exports:{enableOverlayZOrderGuard:()=>{},disableOverlayZOrderGuard:()=>{}}};
const {drawOverlay}=require('../dist/main/drawOverlay.js');
const win={isDestroyed:()=>false,getOpacity:()=>1,webContents:{send:()=>{}}};
drawOverlay.setWindow(win);
drawOverlay.begin({sessionId:'test'});
assert(calls.includes('raise'));
calls.length=0;
setTimeout(()=>{
 try{
  assert(calls.includes('raise'),'Active drawing must reassert z-order even if always-on-top is still true');
  drawOverlay.setPingShowing(true);calls.length=0;
  drawOverlay.stroke({sessionId:'test'});assert(calls.includes('raise'));
  drawOverlay.end({sessionId:'test'});drawOverlay.setPingShowing(false);drawOverlay.onRendererIdle();
  assert(calls.includes('park'));
  calls.length=0;
  setTimeout(()=>{assert.equal(calls.length,0,'Idle drawing must stop raising');console.log('PASS draw initial raise, periodic raise, ping coexistence and idle stop');},900);
 }catch(error){console.error(error);process.exit(1);}
},900);
