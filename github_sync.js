/* LabChem GitHub sync: separate public data branch, browser-local backups, safe conflicts. */
(() => {
'use strict';
const REPO='vubio/lab-chemical-manager';
const BRANCH='labchem-data';
const PATH='data/labchem.json';
const API='https://api.github.com/repos/'+REPO+'/contents/'+PATH;
const META_KEY='labchem.github.sync.meta.v1';
const SESSION_TOKEN='labchem.github.token.session';
const SAVED_TOKEN='labchem.github.token.remember';
const $=id=>document.getElementById(id);
const root=typeof window!=='undefined'?window:{};
const emptyChem=()=>({version:1,chemicals:[],history:[],templates:[]});
const emptyPlates=()=>({draft:null,saved:[]});
const safeParse=(s,fallback)=>{try{return JSON.parse(s)}catch{return fallback}};
let token=typeof sessionStorage!=='undefined'?(sessionStorage.getItem(SESSION_TOKEN)||localStorage.getItem(SAVED_TOKEN)||''):'';
let meta=(typeof localStorage!=='undefined'?safeParse(localStorage.getItem(META_KEY),{}):{})||{};
let baseSha=meta.baseSha||null,baseDigest=meta.baseDigest||null,dirty=!!meta.dirty,revision=0;
let ready=false,busy=false,applying=false,conflict=false,error='',remoteCached=null,remoteSha=null,lastSaved=null,timer=null;
function current(){return {chemicals:root.LabChemCloud.getSnapshot(),plates:root.PlateLayoutCloud.getSnapshot()}}
function validateSnapshot(s){
 if(!s||typeof s!=='object'||!s.chemicals||!s.plates)throw Error('Invalid LabChem data snapshot.');
 const a=s.chemicals,b=s.plates;
 if(a.version!==1||!Array.isArray(a.chemicals)||!Array.isArray(a.history)||!Array.isArray(a.templates))throw Error('Invalid chemical, calculation-history, or template records.');
 if(!Array.isArray(b.saved)||!(b.draft===null||b.draft&&typeof b.draft==='object'))throw Error('Invalid plate layouts.');
 return s;
}
function validateCloud(x){
 if(!x||x.schema!==1)throw Error('Unsupported GitHub LabChem database version.');
 validateSnapshot(x);
 return x;
}
function hasContent(s){
 if(!s||!s.chemicals||!s.plates)return false;
 const d=s.chemicals,p=s.plates,q=p.draft;
 return !!(d.chemicals?.length||d.history?.length||d.templates?.length||p.saved?.length||q&&(
 Object.keys(q.assignments||{}).length||q.selection?.length||Object.keys(q.rowNotes||{}).length||
 Object.keys(q.colNotes||{}).length||String(q.notes||'').trim()||
 (q.name&&q.name!=='New experiment')||q.generatedAt||
 Object.keys(q.counts||{}).length||q.fillOrder==='columns'||(q.factors||[]).some((f,i)=>String(f.name||'')!==['Dose','Cell density','',''][i]||String(f.values||'')!==['0 µM; 0.05 µM; 0.1 µM; 0.2 µM','','',''][i])
 ));
}
function digest(x){
 const str=JSON.stringify(x);let h=2166136261;
 for(let i=0;i<str.length;i++){h^=str.charCodeAt(i);h=Math.imul(h,16777619)}
 return str.length.toString(36)+'-'+(h>>>0).toString(16);
}
function decision(local,remote,storedMeta,sha){
 const localHas=hasContent(local),remoteHas=hasContent(remote),sig=digest(local);
 const prior=storedMeta||{};
 if(prior.baseSha){
  if(prior.baseSha===sha)return (prior.dirty||sig!==prior.baseDigest)?'upload':'synced';
  return (!prior.dirty&&prior.baseDigest===sig)?'load':'conflict';
 }
 if(!localHas)return remoteHas?'load':'synced';
 return remoteHas?'conflict':'upload';
}
function encodeUtf8(s){
 const bytes=new TextEncoder().encode(s);let raw='';
 for(let i=0;i<bytes.length;i+=16384)raw+=String.fromCharCode(...bytes.subarray(i,i+16384));
 return btoa(raw);
}
function decodeUtf8(s){
 const clean=String(s).replace(/\s/g,'');const binary=atob(clean);
 const bytes=new Uint8Array(binary.length);
 for(let i=0;i<bytes.length;i++)bytes[i]=binary.charCodeAt(i);
 return new TextDecoder().decode(bytes);
}
function remember(){
 try{localStorage.setItem(META_KEY,JSON.stringify({baseSha,baseDigest,dirty}))}catch(err){console.warn('Could not store GitHub sync metadata',err)}
}
function tell(msg,isError){const el=$('sync-message');if(el){el.textContent=msg||'';el.classList.toggle('error',!!isError)}}
function render(){
 const dot=$('sync-dot'),status=$('sync-status-label'),detail=$('sync-status-detail');
 if(!dot||!status)return;
 let label='Saved on this device',desc='Connect GitHub for cross-device saving',mode='local';
 if(busy){label='Syncing with GitHub…';desc='Checking and saving shared records';mode='busy'}
 else if(conflict){label='GitHub conflict: review needed';desc='Both versions preserved · choose a copy';mode='error'}
 else if(error){label='GitHub sync needs attention';desc='Local data preserved: '+error;mode='error'}
 else if(dirty){label=token?'Changes waiting to sync':'Unsynced changes on this device';desc=token?'Preparing upload to GitHub':'Open GitHub settings to connect';mode='pending'}
 else if(ready&&baseSha){label='GitHub saved';desc=token?'All records current · automatic sync on':'Cloud records available · connect to publish';mode='ok'}
 else if(ready){label='Local only';desc='GitHub database not available yet';mode='pending'}
 status.textContent=label;detail.textContent=desc;dot.className='storage-dot sync-state-'+mode;
 $('sync-save-now').disabled=busy;$('sync-check-now').disabled=busy;
 $('sync-reconcile').hidden=!conflict;
}
function openModal(){
 $('sync-modal').hidden=false;
 $('sync-token').value=token;
 $('sync-remember').checked=!!localStorage.getItem(SAVED_TOKEN);
 render();
}
function closeModal(){$('sync-modal').hidden=true;$('sync-token').value=''}
async function api(method,url,payload,allow404=false){
 const headers={'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};
 if(token)headers.Authorization='Bearer '+token;
 if(payload!==undefined)headers['Content-Type']='application/json';
 const response=await fetch(url,{method,headers,cache:'no-store',body:payload===undefined?undefined:JSON.stringify(payload)});
 if(response.status===404&&allow404)return null;
 if(!response.ok){
  let why='';try{why=(await response.json()).message||''}catch{}
  throw Error('GitHub '+response.status+(why?': '+why:''));
 }
 return response.json();
}
async function fetchCloud(){
 const info=await api('GET',API+'?ref='+BRANCH+'&t='+Date.now(),undefined,true);
 if(!info)return {snapshot:{schema:1,...{chemicals:emptyChem(),plates:emptyPlates()}},sha:null};
 if(info.type!=='file'||!info.content)throw Error('GitHub did not return the database file.');
 return {snapshot:validateCloud(JSON.parse(decodeUtf8(info.content))),sha:info.sha};
}
function backupDownload(data,tag){
 const name='LabChem-'+tag+'-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';
 const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
 const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function markSynced(sha,content){
 baseSha=sha;baseDigest=digest(content);dirty=digest(current())!==baseDigest;conflict=false;error='';
 remember();render();
}
function applyCloud(snapshot,sha){
 validateCloud(snapshot);
 applying=true;
 try{
  root.LabChemCloud.replaceSnapshot(snapshot.chemicals);
  root.PlateLayoutCloud.replaceSnapshot(snapshot.plates);
 }finally{applying=false}
 markSynced(sha,current());
}
function makeConflict(remote){
 remoteCached=remote.snapshot;remoteSha=remote.sha;conflict=true;dirty=true;remember();render();
 tell('Another device has changes, or this device contains an independent local draft. Nothing was overwritten.',true);
}
async function refresh(options={}){
 if(busy)return;
 busy=true;error='';render();
 try{
  const remote=await fetchCloud();remoteCached=remote.snapshot;remoteSha=remote.sha;
  const local=current();
  const policy=decision(local,remote.snapshot,{baseSha,baseDigest,dirty},remote.sha);
  if(policy==='load'){
   applyCloud(remote.snapshot,remote.sha);
   tell('Latest GitHub version loaded.');
  }else if(policy==='conflict')makeConflict(remote);
  else if(policy==='synced'){
   baseSha=remote.sha;baseDigest=digest(local);dirty=false;conflict=false;remember();
   tell('GitHub data checked; this device is current.');
  }else{
   if(!baseSha&&!hasContent(remote.snapshot))baseSha=remote.sha;
   dirty=true;conflict=false;remember();
   tell(token?'Local records are ready for upload.':'Local records are safe. Connect GitHub to upload.');
  }
 }catch(e){error=e.message;dirty=dirty||!!meta.dirty;tell(error,true)}
 finally{busy=false;ready=true;render()}
 if(dirty&&token&&!conflict&&!error)queue(1400);
}
function queue(ms=6000){clearTimeout(timer);if(!token||!ready||conflict)return;timer=setTimeout(()=>syncNow(),ms)}
function changed(){
 if(applying)return;
 revision++;dirty=true;remember();render();
 queue(6000);
}
async function syncNow(){
 clearTimeout(timer);
 if(busy)return;
 if(!ready){await refresh();if(!ready)return}
 if(conflict){openModal();tell('Resolve the newer remote version before saving.',true);return}
 if(!token){openModal();tell('Connect a repository-limited GitHub token to publish records.');return}
 const snapshot=validateSnapshot(current()),sentDigest=digest(snapshot);
 busy=true;error='';render();
 try{
  const remote=await fetchCloud();remoteCached=remote.snapshot;remoteSha=remote.sha;
  if(remote.sha!==baseSha){
   makeConflict(remote);return;
  }
  if(!dirty&&sentDigest===baseDigest){tell('All data is already saved to GitHub.');return}
  const payload={schema:1,updatedAt:new Date().toISOString(),chemicals:snapshot.chemicals,plates:snapshot.plates};
  const body={message:'Sync LabChem chemical records and plate layouts',content:encodeUtf8(JSON.stringify(payload,null,2)+'\n'),branch:BRANCH};
  if(remote.sha)body.sha=remote.sha;
  const result=await api('PUT',API,body);
  baseSha=result.content?.sha||null;baseDigest=sentDigest;
  dirty=digest(current())!==sentDigest;
  conflict=false;error='';remember();lastSaved=new Date();
  tell('Saved to GitHub at '+lastSaved.toLocaleTimeString()+'.');
 }catch(e){
  if(/GitHub (409|422)/.test(e.message)){
   error='GitHub changed during save; refresh before retrying.';conflict=true;
  }else error=e.message;
  dirty=true;remember();tell('Sync failed: '+error+'. Your records remain in this browser.',true);
 }finally{busy=false;render()}
 if(dirty&&!conflict&&!error)queue(1800);
}
async function connect(){
 const entered=$('sync-token').value.trim();
 if(!entered){tell('Enter a fine-grained GitHub token.',true);return}
 const old=token;token=entered;
 try{
  await api('GET','https://api.github.com/repos/'+REPO);
  if($('sync-remember').checked){localStorage.setItem(SAVED_TOKEN,token);sessionStorage.removeItem(SESSION_TOKEN)}
  else{sessionStorage.setItem(SESSION_TOKEN,token);localStorage.removeItem(SAVED_TOKEN)}
  tell('GitHub connected. '+(conflict?'Resolve the versions below.':'Data syncing is enabled.'));
  error='';render();
  if(!conflict){closeModal();await refresh();if(dirty&&!conflict)queue(300)}
 }catch(e){token=old;tell('Could not validate this token: '+e.message,true);render()}
}
async function loadCloudSafely(){
 if(!conflict){tell('No conflict to resolve.');return}
 if(!confirm('Replace the current chemical records, dosing history, templates, and plate layouts on this device with the GitHub copy? A JSON backup of this device will download first.'))return;
 backupDownload({schema:1,...current()},'device-before-cloud');
 try{
  const remote=await fetchCloud();
  applyCloud(remote.snapshot,remote.sha);tell('GitHub version loaded. A backup of previous device data was downloaded.');closeModal()
 }catch(e){error=e.message;render();tell(error,true)}
}
async function publishDevice(){
 if(!conflict){tell('No conflict to resolve.');return}
 if(!token){tell('Connect GitHub before publishing.',true);return}
 if(!confirm('Publish this device INSTEAD of the current GitHub database? This overwrites the cloud copy. A backup of the cloud version will download first.'))return;
 busy=true;render();
 try{
  const remote=await fetchCloud();
  backupDownload(remote.snapshot,'cloud-before-replacement');
  const snapshot=validateSnapshot(current()),sent=digest(snapshot);
  const data={schema:1,updatedAt:new Date().toISOString(),chemicals:snapshot.chemicals,plates:snapshot.plates};
  const payload={message:'Resolve LabChem sync by publishing selected device data',content:encodeUtf8(JSON.stringify(data,null,2)+'\n'),branch:BRANCH};
  if(remote.sha)payload.sha=remote.sha;
  const response=await api('PUT',API,payload);
  baseSha=response.content?.sha||null;baseDigest=sent;dirty=digest(current())!==sent;
  conflict=false;error='';remember();closeModal();tell('Device database published to GitHub. Remote backup downloaded.');
 }catch(e){error=e.message;conflict=true;tell('Could not publish: '+error,true)}
 finally{busy=false;render()}
 if(dirty&&!conflict&&!error)queue(2000);
}
function bind(){
 $('sync-open').addEventListener('click',openModal);
 $('sync-save-now').addEventListener('click',syncNow);
 $('sync-check-now').addEventListener('click',()=>refresh());
 $('sync-close').addEventListener('click',closeModal);
 $('sync-connect').addEventListener('click',connect);
 $('sync-forget').addEventListener('click',()=>{
  token='';sessionStorage.removeItem(SESSION_TOKEN);localStorage.removeItem(SAVED_TOKEN);
  $('sync-token').value='';tell('Token forgotten. Cloud reads remain available; changes save locally until reconnected.');render();
 });
 $('sync-load-cloud').addEventListener('click',loadCloudSafely);
 $('sync-publish-device').addEventListener('click',publishDevice);
 $('sync-download-device').addEventListener('click',()=>backupDownload({schema:1,...current()},'device'));
 $('sync-modal').addEventListener('mousedown',e=>{if(e.target===$('sync-modal'))closeModal()});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('sync-modal').hidden)closeModal()});
 root.addEventListener('labchem:data-changed',changed);
 root.addEventListener('online',()=>{if(dirty&&token)queue(1000);else refresh()});
 root.addEventListener('focus',()=>{if(ready&&!busy&&!dirty)refresh()});
 setInterval(()=>{if(ready&&!busy&&!dirty)refresh()},120000);
}
async function init(){
 if(!$('sync-status-label')||!root.LabChemCloud||!root.PlateLayoutCloud)return;
 bind();render();await refresh();
}
root.LabChemGithubSyncCore={digest,decision,validateCloud,hasContent,encodeUtf8,decodeUtf8};
if(typeof document!=='undefined'){
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);
 else init();
}
})();