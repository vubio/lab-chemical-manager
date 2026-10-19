/* Independent plate mapping module. No dosing calculations or chemical data are read or changed. */
(() => {
'use strict';
const STORAGE='labchem.plate.layouts.v1';
const SHAPES={6:[2,3],12:[3,4],24:[4,6],48:[6,8],96:[8,12],384:[16,24]};
const $=id=>document.getElementById(id);
const cellName=(r,c)=>String.fromCharCode(65+r)+(c+1);
const numberOfWells=s=>SHAPES[s][0]*SHAPES[s][1];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const splitValues=s=>String(s||'').split(/[,;\n]+/).map(x=>x.trim()).filter(Boolean);
const defaults=()=>({id:null,name:'New experiment',format:'96',selection:[],rowNotes:{},colNotes:{},mode:'select',factors:[{id:'factor1',name:'Dose',values:'0 µM; 0.05 µM; 0.1 µM; 0.2 µM'},{id:'factor2',name:'Cell density',values:''},{id:'factor3',name:'',values:''},{id:'factor4',name:'',values:''}],counts:{},assignments:{},notes:'',generatedAt:null});
let state=defaults(),saved=[],activeCell=null,drag=null,suppressClick=false,checkedCombinations=new Set();
function normalize(s){const d=defaults();if(!s||typeof s!=='object')return d;return {...d,...s, format:SHAPES[String(s.format)]?String(s.format):'96',selection:Array.isArray(s.selection)?s.selection:[],rowNotes:s.rowNotes&&typeof s.rowNotes==='object'?s.rowNotes:{},colNotes:s.colNotes&&typeof s.colNotes==='object'?s.colNotes:{}, factors:Array.isArray(s.factors)&&s.factors.length?s.factors.slice(0,4).map((f,i)=>({id:String(f.id||'factor'+(i+1)),name:String(f.name||''),values:String(f.values||'')})):d.factors,counts:s.counts&&typeof s.counts==='object'?s.counts:{},assignments:s.assignments&&typeof s.assignments==='object'?s.assignments:{}}}
function dimensions(){return SHAPES[state.format]}
function allCoords(){let [rows,cols]=dimensions(),arr=[];for(let r=0;r<rows;r++)for(let c=0;c<cols;c++)arr.push(cellName(r,c));return arr}
function available(){const all=allCoords(),chosen=new Set(state.selection);return chosen.size?all.filter(x=>chosen.has(x)):all}
function activeFactors(){return state.factors.map(f=>({...f,options:splitValues(f.values)})).filter(f=>f.name.trim()&&f.options.length)}
function combinations(factors){if(!factors.length)return [];let combos=[{key:'',parts:[]}];for(const f of factors){combos=combos.flatMap(c=>f.options.map(v=>({key:JSON.stringify([...c.parts.map(p=>[p.id,p.value]),[f.id,v]].sort((a,b)=>a[0].localeCompare(b[0]))),parts:[...c.parts,{id:f.id,name:f.name,value:v}]})))}return combos}
function desired(){return combinations(activeFactors()).map(c=>({...c,replicates:Math.max(1,Number(state.counts[c.key])||1)}))}
function place(availableCoords,combos,rows,cols){
 const availableSet=new Set(availableCoords),out={},occupied=new Set();
 if(combos.reduce((n,c)=>n+c.replicates,0)>availableSet.size)throw Error(`Need ${combos.reduce((n,c)=>n+c.replicates,0)} wells, but only ${availableSet.size} are available. Select more wells or reduce replicates.`);
 for(const combo of combos){
  let remaining=combo.replicates;
  // Prefer a single contiguous horizontal run, starting in a fresh row.
  let best=null;
  for(let r=0;r<rows;r++){
    let rowUsed=0;for(let c=0;c<cols;c++)if(occupied.has(cellName(r,c)))rowUsed++;
    for(let c=0;c<cols;){let start=c,run=[];while(c<cols&&availableSet.has(cellName(r,c))&&!occupied.has(cellName(r,c))){run.push(cellName(r,c));c++}if(!run.length){c++;continue}
      if(run.length>=remaining){const score=(rowUsed?1000+rowUsed:0)+r*.01+start*.0001;if(!best||score<best.score)best={score,run:run.slice(0,remaining)}}
    }
  }
  const chosen=best?best.run:[];
  if(!chosen.length){ // Large/irregular groups: keep wells in row-local contiguous segments.
    for(let r=0;r<rows&&chosen.length<remaining;r++)for(let c=0;c<cols&&chosen.length<remaining;c++){
      const x=cellName(r,c);if(availableSet.has(x)&&!occupied.has(x))chosen.push(x);
    }
  }
  for(const coord of chosen){occupied.add(coord);out[coord]={labels:combo.parts.map(p=>p.value),factorNames:combo.parts.map(p=>p.name),group:combo.key}}
 }
 return out;
}
function renderPlate(){const [rows,cols]=dimensions(),selected=new Set(state.selection),hasSelected=selected.size>0;const grid=$('pl-grid');grid.style.setProperty('--plate-cols',cols);
 let h='<span class="pl-header pl-corner"></span><span class="pl-header pl-row-note-title">Row note</span>';
 for(let c=1;c<=cols;c++)h+=`<label class="pl-header pl-column-header"><span>${c}</span><input data-column-note="${c}" aria-label="Note for column ${c}" type="text" value="${esc(state.colNotes[c]||'')}" placeholder="" title="Optional note for column ${c}"/></label>`;
 for(let r=0;r<rows;r++){const row=String.fromCharCode(65+r);h+=`<span class="pl-header pl-row-letter">${row}</span><input class="pl-row-note" data-row-note="${row}" aria-label="Note for row ${row}" value="${esc(state.rowNotes[row]||'')}" placeholder="" title="Optional note for row ${row}"/>`;
 for(let c=0;c<cols;c++){const pos=cellName(r,c),record=state.assignments[pos],disabled=hasSelected&&!selected.has(pos),selectedHere=selected.has(pos);let classes='pl-well'+(record?' pl-assigned':'')+(selectedHere?' pl-selected':'')+(disabled?' pl-unselected':'')+(activeCell===pos?' pl-focus':'');let labels=record?.labels?.filter(Boolean)||[],labelText=labels.map(x=>String(x)).join(' | ');
 h+=`<button type="button" class="${classes}" data-well="${pos}" role="gridcell" title="${esc(pos+(labelText?' — '+labelText:''))}" aria-label="${esc(pos+(labelText?' '+labelText:''))}"><span class="pl-coord">${pos}</span><span class="pl-labels"><span class="pl-primary">${esc(labels[0]||'')}</span>${labels.length>1?`<span class="pl-secondary">${esc(labels[1])}</span>`:''}${labels.length>2?`<span class="pl-tertiary">${esc(labels.slice(2).join(' / '))}</span>`:''}</span></button>`;
 }}grid.innerHTML=h;
 $('pl-selection-count').textContent=hasSelected?`${selected.size} selected / ${numberOfWells(state.format)} total wells · ${Object.keys(state.assignments).length} labeled`: `Entire ${state.format}-well plate available · ${Object.keys(state.assignments).length} labeled`;
 $('pl-current-well').textContent=activeCell?`Well ${activeCell} · manual changes affect this well only`:'Click or double-click a well to edit its labels';
 renderEditor();
}
function renderFactors(){const el=$('pl-factors');el.innerHTML=state.factors.map((f,i)=>`<div class="plate-factor-row" data-factor="${esc(f.id)}"><span class="pl-number">${i+1}</span><input class="pl-fname" data-fname="${esc(f.id)}" value="${esc(f.name)}" placeholder="Factor ${i+1}" aria-label="Factor ${i+1} name"/><input class="pl-fvalues" data-fvalues="${esc(f.id)}" value="${esc(f.values)}" placeholder="e.g. 0, 0.05, 0.1" aria-label="Factor ${i+1} values"/><span class="plate-updown"><button type="button" data-movefactor="${esc(f.id)}" data-direction="-1" ${i===0?'disabled':''} title="Higher priority">↑</button><button type="button" data-movefactor="${esc(f.id)}" data-direction="1" ${i===state.factors.length-1?'disabled':''} title="Lower priority">↓</button></span></div>`).join('');}
function renderCombinations(){
 const combos=desired(),keys=new Set(combos.map(c=>c.key)),el=$('pl-combos');
 checkedCombinations=new Set([...checkedCombinations].filter(k=>keys.has(k)));
 el.innerHTML=combos.length?`<div class="pl-combo-head"><label class="pl-check-title"><input id="pl-check-all" type="checkbox" aria-label="Select all conditions" ${checkedCombinations.size===combos.length?'checked':''}/><span>Condition</span></label><span>Replicates</span></div>`+
 combos.map(c=>`<div class="pl-combo-row"><label class="pl-combo-label"><input type="checkbox" data-select-combo="${esc(c.key)}" ${checkedCombinations.has(c.key)?'checked':''} aria-label="Select condition ${esc(c.parts.map(p=>p.value).join(', '))}"/><span>${c.parts.map(p=>`<b>${esc(p.name)}:</b> ${esc(p.value)}`).join(' · ')}</span></label><input type="number" min="1" max="384" step="1" data-reps="${esc(c.key)}" value="${c.replicates}" aria-label="Replicates for ${esc(c.parts.map(x=>x.value).join(', '))}"/></div>`).join(''):'<p class="tiny muted">Enter at least one factor name and value to generate labeled wells. You can also add labels manually by clicking any well.</p>';
 const filter=$('pl-batch-factor'),before=filter.value;
 const opts=activeFactors().flatMap(f=>f.options.map(v=>({key:JSON.stringify([f.id,v]),label:`${f.name}: ${v}`})));
 filter.innerHTML='<option value="">Choose a factor value</option>'+opts.map(o=>`<option value="${esc(o.key)}">${esc(o.label)}</option>`).join('');
 filter.value=opts.some(o=>o.key===before)?before:'';
 $('pl-layout-status').textContent=combos.length?`${combos.length} combinations · ${combos.reduce((a,c)=>a+c.replicates,0)} wells requested · ${available().length} available`:'';
}
function applyBatchReplicates(){
 const count=Number($('pl-batch-count').value),scope=$('pl-batch-scope').value,combos=desired();
 if(!Number.isInteger(count)||count<1||count>384)return notify('Enter an integer between 1 and 384.',true);
 let targets=combos;
 if(scope==='checked')targets=combos.filter(c=>checkedCombinations.has(c.key));
 if(scope==='factor'){
  if(!$('pl-batch-factor').value)return notify('Choose a factor value first.',true);
  const [id,value]=JSON.parse($('pl-batch-factor').value);
  targets=combos.filter(c=>c.parts.some(p=>p.id===id&&p.value===value));
 }
 if(!targets.length)return notify('No matching conditions. Check rows or choose another factor.',true);
 targets.forEach(c=>state.counts[c.key]=count);
 persist();renderCombinations();notify(`Set ${count} replicate${count===1?'':'s'} for ${targets.length} condition${targets.length===1?'':'s'}. Existing plate labels are unchanged until regenerated.`);
}
function updateEditorFields(){if(!activeCell)return;let vals=[...Array(4)].map((_,i)=>$('pl-edit-'+i)?.value?.trim()||'');state.assignments[activeCell]={labels:vals,factorNames:state.factors.map(x=>x.name),group:'manual'};if(!vals.some(Boolean))delete state.assignments[activeCell];renderPlate();updateNote()}
function renderEditor(){const record=activeCell?state.assignments[activeCell]:null;const active=Boolean(activeCell);$('pl-save-label').disabled=!active;$('pl-remove-label').disabled=!active;
 $('pl-label-fields').innerHTML=Array.from({length:4},(_,i)=>`<label class="field"><span>${i===0?'Primary':i===1?'Secondary':i===2?'Third':'Fourth'} text</span><input id="pl-edit-${i}" ${active?'':'disabled'} value="${esc(record?.labels?.[i]||'')}" placeholder="${esc(state.factors[i]?.name||'Optional label')}"/></label>`).join('');
}
function updateNote(){const note=makeNote();$('pl-note-preview').textContent=note}
function makeNote(){let lines=['[PLATE LAYOUT]',`Title: ${state.name}`,`Plate format: ${state.format} wells`,`Mapped: ${Object.keys(state.assignments).length} wells`,`Available area: ${state.selection.length?state.selection.slice().sort().join(', '):'Entire plate'}`,''];
 if(state.notes.trim())lines.push(`Notes: ${state.notes.trim()}`,'');
 const [rows,cols]=dimensions();
 lines.push(['Row','Row note',...Array.from({length:cols},(_,i)=>String(i+1))].join('\t'));
 lines.push(['Column notes','',...Array.from({length:cols},(_,i)=>state.colNotes[i+1]||'')].join('\t'));
 for(let r=0;r<rows;r++){const row=String.fromCharCode(65+r);lines.push([row,state.rowNotes[row]||'',...Array.from({length:cols},(_,c)=>state.assignments[cellName(r,c)]?.labels?.filter(Boolean).join(' | ')||'')].join('\t'))}
 return lines.join('\n');
}
function conditionTable(){return desired().map(c=>[c.parts.map(p=>`${p.name}: ${p.value}`).join(' · '),c.replicates])}
function plateTable(){const [rows,cols]=dimensions();return [
 ['Row','Row note',...Array.from({length:cols},(_,i)=>String(i+1))],
 ['Column notes','',...Array.from({length:cols},(_,i)=>state.colNotes[i+1]||'')],
 ...Array.from({length:rows},(_,r)=>{const row=String.fromCharCode(65+r);return [row,state.rowNotes[row]||'',...Array.from({length:cols},(_,c)=>state.assignments[cellName(r,c)]?.labels?.filter(Boolean).join('\n')||'')]})
]}
function tableHTML(rows){return '<table style="border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;font-size:11pt;color:#16283b">'+rows.map((row,i)=>'<tr>'+row.map((value,j)=>{const heading=i===0||j===0,tag=heading?'th':'td';return `<${tag} style="border:1px solid #9eacb9;padding:7px 9px;text-align:left;vertical-align:top;white-space:pre-line;${heading?'background:#edf2f5;font-weight:700;':''}">${esc(value)}</${tag}>`}).join('')+'</tr>').join('')+'</table>'}
async function copyRich(html,plain,success){
 try{
  if(navigator.clipboard?.write&&typeof ClipboardItem!=='undefined'){
   await navigator.clipboard.write([new ClipboardItem({'text/html':new Blob([html],{type:'text/html'}),'text/plain':new Blob([plain],{type:'text/plain'})})]);
   notify(success+' Paste into OneNote as a formatted table.');return;
  }
  if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(plain);notify(success+' (plain text; rich clipboard unavailable).');return}
  const ta=document.createElement('textarea');ta.value=plain;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();if(!document.execCommand('copy'))throw Error('Clipboard unavailable');ta.remove();notify(success+' (plain text).');
 }catch(e){notify('Clipboard access was blocked. Try opening the site over HTTPS and allow clipboard access.',true)}
}
function copyConditionsTable(){const rows=[['Condition','Replicates'],...conditionTable()];return copyRich(tableHTML(rows),rows.map(r=>r.join('\t')).join('\n'),'Condition table copied.')}
function copyPlateTable(){const rows=plateTable();return copyRich(tableHTML(rows),rows.map(r=>r.join('\t')).join('\n'),'Plate table copied, including row and column notes.')}
function persist(){try{localStorage.setItem(STORAGE,JSON.stringify({draft:state,saved}))}catch(e){notify('Could not save plate layout: browser storage full or unavailable.',true)}}
function bootStored(){try{const data=JSON.parse(localStorage.getItem(STORAGE)||'null');if(data){state=normalize(data.draft);saved=Array.isArray(data.saved)?data.saved.map(normalize):[]}}catch(e){state=defaults();saved=[]}}
function syncMeta(){state.name=$('pl-title').value;state.notes=$('pl-notes').value;state.mode=$('pl-mode').value;persist();updateNote()}
function refreshAll(){ $('pl-title').value=state.name;$('pl-format').value=state.format;$('pl-mode').value=state.mode;$('pl-notes').value=state.notes;renderFactors();renderCombinations();renderPlate();renderSaved();updateNote(); }
function renderSaved(){const select=$('pl-saved'),old=select.value;select.innerHTML='<option value="">Choose saved layout</option>'+saved.map(x=>`<option value="${esc(x.id)}">${esc(x.name)} · ${esc(x.format)}-well · ${esc(x.savedAt?new Date(x.savedAt).toLocaleString():'')}</option>`).join('');if(saved.some(s=>s.id===old))select.value=old}
function notify(message,problem=false){const el=$('pl-layout-status');el.textContent=message;el.classList.toggle('pl-error',problem)}
function selectionRect(start,end){const [r1,c1]=coord(start),[r2,c2]=coord(end);const arr=[];for(let r=Math.min(r1,r2);r<=Math.max(r1,r2);r++)for(let c=Math.min(c1,c2);c<=Math.max(c1,c2);c++)arr.push(cellName(r,c));return arr}
function coord(w){const m=/^([A-P])(\d+)$/.exec(w);if(!m)throw Error('Invalid well coordinate');return [m[1].charCodeAt(0)-65,Number(m[2])-1]}
function applySelection(region,mode,base){const result=new Set(base);if(mode==='replace')result.clear();for(const w of region){if(mode==='subtract')result.delete(w);else result.add(w)}return [...result]}
function beginDrag(e){const well=e.target.closest('[data-well]');if(!well||e.button!==0)return;e.preventDefault();const start=well.dataset.well,mode=e.shiftKey||(state.mode==='move'&&!e.ctrlKey&&!e.metaKey&&!e.altKey)?'move':e.altKey?'subtract':e.ctrlKey||e.metaKey?'add':'replace';
 drag={start,last:start,mode,base:[...state.selection],moved:false};activeCell=start;renderPlate();}
function moveDrag(e){if(!drag)return;const w=document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-well]');if(!w)return;const dest=w.dataset.well;if(dest===drag.last)return;drag.last=dest;drag.moved=true;
 if(drag.mode!=='move'){state.selection=applySelection(selectionRect(drag.start,dest),drag.mode,drag.base);renderPlate()}}
function finishDrag(){if(!drag)return;const {start,last,mode,base,moved}=drag;drag=null;suppressClick=true;
 if(mode==='move'){
  if(moved&&start!==last){if(!state.assignments[start]){notify('The source well has no label to move.',true)}else{const existing=state.assignments[last]||null;state.assignments[last]=state.assignments[start];if(existing)state.assignments[start]=existing;else delete state.assignments[start];activeCell=last;notify(existing?`Swapped labels ${start} and ${last}.`:`Moved label ${start} → ${last}.`);}}
 }else if(moved || !state.assignments[start] || mode!=='replace') state.selection=applySelection(selectionRect(start,last),mode,base);
 renderPlate();updateNote();persist();}
function generate(){syncFactors();const factors=activeFactors(),combos=desired();if(!factors.length)return notify('Enter a factor with at least one value.',true);if(!combos.every(c=>Number.isInteger(c.replicates)&&c.replicates>0))return notify('Replicates must be positive whole numbers.',true);
 if(Object.keys(state.assignments).length&&!window.confirm('Replace the current plate labels with a newly generated layout? Manual edits will be overwritten.'))return;
 try{const [rows,cols]=dimensions();state.assignments=place(available(),combos,rows,cols);state.generatedAt=new Date().toISOString();activeCell=null;renderPlate();updateNote();persist();notify(`Assigned ${Object.keys(state.assignments).length} wells across ${combos.length} conditions.`)}catch(e){notify(e.message,true)}
}
function syncFactors(){state.factors.forEach(f=>{const name=$('pl-factors').querySelector(`[data-fname="${f.id}"]`),values=$('pl-factors').querySelector(`[data-fvalues="${f.id}"]`);if(name)f.name=name.value;if(values)f.values=values.value});}
function fileDownload(text,name,type='text/plain'){const blob=new Blob([text],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000)}
function downloadTSV(){const safe=(state.name||'plate').replace(/[^\w-]+/g,'_').slice(0,50);fileDownload(plateTable().map(row=>row.map(x=>String(x).replace(/\n/g,' / ')).join('\t')).join('\n'),safe+'-plate.tsv','text/tab-separated-values')}
async function copyNote(){const title=`<p style="font-family:Arial,sans-serif"><b>${esc(state.name)}</b> · ${esc(state.format)}-well plate</p>`;
 const extra=state.notes.trim()?`<p style="font-family:Arial,sans-serif">${esc(state.notes)}</p>`:'';
 return copyRich(title+extra+tableHTML(plateTable()),makeNote(),'Plate note copied, including labels and axis notes.');}
function save(){syncMeta();syncFactors();const item=structuredClone(state);item.id='plate-'+Date.now()+'-'+Math.random().toString(36).slice(2,6);item.savedAt=new Date().toISOString();saved.unshift(item);state.id=item.id;persist();renderSaved();$('pl-saved').value=item.id;notify('Layout saved. Older saved layouts are kept unchanged.')}
function bind(){const grid=$('pl-grid');grid.addEventListener('pointerdown',e=>{if(e.pointerType==='touch')return;beginDrag(e)});document.addEventListener('pointermove',e=>{if(drag)moveDrag(e)});document.addEventListener('pointerup',()=>{if(drag)finishDrag()});grid.addEventListener('click',e=>{const w=e.target.closest('[data-well]');if(!w)return;if(suppressClick){suppressClick=false;return}activeCell=w.dataset.well;renderPlate()});grid.addEventListener('dblclick',e=>{const w=e.target.closest('[data-well]');if(!w)return;activeCell=w.dataset.well;renderPlate();$('pl-edit-0').focus();$('pl-well-panel').scrollIntoView({block:'nearest',behavior:'smooth'})});
 // Keyboard support: arrow navigation is native via tab, Enter opens the inline editor.
 grid.addEventListener('keydown',e=>{if(e.key!=='Enter')return;const w=e.target.closest('[data-well]');if(w){activeCell=w.dataset.well;renderPlate();$('pl-edit-0').focus()}});
 $('pl-grid').addEventListener('input',e=>{const t=e.target;if(t.matches('[data-row-note]'))state.rowNotes[t.dataset.rowNote]=t.value;else if(t.matches('[data-column-note]'))state.colNotes[t.dataset.columnNote]=t.value;else return;persist();updateNote()});
 $('pl-format').addEventListener('change',e=>{const selected=state.selection.length||Object.keys(state.assignments).length;if(selected&&!confirm('Changing plate format clears selection and current labels. Continue?')){e.target.value=state.format;return}state.format=e.target.value;state.selection=[];state.assignments={};state.rowNotes={};state.colNotes={};activeCell=null;renderCombinations();renderPlate();updateNote();persist()});
 $('pl-mode').addEventListener('change',syncMeta);$('pl-title').addEventListener('input',syncMeta);$('pl-notes').addEventListener('input',syncMeta);
 $('pl-all').addEventListener('click',()=>{state.selection=[];renderPlate();persist();notify('Entire plate available for layout.')});$('pl-clear').addEventListener('click',()=>{if(Object.keys(state.assignments).length&&!confirm('Clear all well labels from the current plate? Saved layouts remain available.'))return;state.assignments={};activeCell=null;renderPlate();updateNote();persist();notify('All well labels cleared. Selected well areas are unchanged.')});
 $('pl-factors').addEventListener('input',e=>{if(!e.target.matches('[data-fname],[data-fvalues]'))return;syncFactors();renderCombinations();persist()});
 $('pl-factors').addEventListener('click',e=>{const b=e.target.closest('[data-movefactor]');if(!b)return;syncFactors();const i=state.factors.findIndex(f=>f.id===b.dataset.movefactor),j=i+Number(b.dataset.direction);if(j<0||j>=state.factors.length)return;[state.factors[i],state.factors[j]]=[state.factors[j],state.factors[i]];renderFactors();renderCombinations();persist()});
 $('pl-preview').addEventListener('click',()=>{syncFactors();renderCombinations();persist()});
 $('pl-batch-apply').addEventListener('click',applyBatchReplicates);$('pl-batch-scope').addEventListener('change',e=>{$('pl-batch-factor-wrap').classList.toggle('hidden',e.target.value!=='factor')});
 $('pl-combos').addEventListener('change',e=>{if(e.target.id==='pl-check-all'){const keys=desired().map(c=>c.key);checkedCombinations=e.target.checked?new Set(keys):new Set();renderCombinations();return}if(e.target.matches('[data-select-combo]')){if(e.target.checked)checkedCombinations.add(e.target.dataset.selectCombo);else checkedCombinations.delete(e.target.dataset.selectCombo);const all=$('pl-check-all');if(all)all.checked=checkedCombinations.size===desired().length;}});
 $('pl-combos').addEventListener('input',e=>{const el=e.target;if(!el.matches('[data-reps]'))return;const n=Number(el.value);state.counts[el.dataset.reps]=Number.isInteger(n)&&n>0?n:1;persist();const combos=desired();notify(`${combos.reduce((a,c)=>a+c.replicates,0)} wells requested · ${available().length} available`)});
 $('pl-copy-table').addEventListener('click',copyPlateTable);$('pl-copy-conditions').addEventListener('click',copyConditionsTable);
 $('pl-generate').addEventListener('click',generate);$('pl-save-label').addEventListener('click',()=>{if(activeCell)updateEditorFields();persist()});$('pl-remove-label').addEventListener('click',()=>{if(activeCell){delete state.assignments[activeCell];renderPlate();updateNote();persist()}});
 $('pl-save').addEventListener('click',save);$('pl-copy').addEventListener('click',copyNote);$('pl-tsv').addEventListener('click',downloadTSV);
 $('pl-new').addEventListener('click',()=>{if(!confirm('Start a new blank plate layout? Your saved layouts remain available.'))return;state=defaults();checkedCombinations.clear();activeCell=null;persist();refreshAll()});
 $('pl-load').addEventListener('click',()=>{const src=saved.find(x=>x.id===$('pl-saved').value);if(!src)return notify('Choose a saved layout.',true);state=normalize(structuredClone(src));checkedCombinations.clear();activeCell=null;persist();refreshAll();notify('Saved plate layout loaded. You can edit and save it as another version.')});
 $('pl-delete').addEventListener('click',()=>{const id=$('pl-saved').value;if(!id)return notify('Choose a saved layout.',true);if(!confirm('Permanently delete this saved layout?'))return;saved=saved.filter(x=>x.id!==id);persist();renderSaved();notify('Saved layout deleted. Current working map is unchanged.')});
 $('pl-export').addEventListener('click',()=>{syncMeta();syncFactors();fileDownload(JSON.stringify({version:1,draft:state,saved,exportedAt:new Date().toISOString()},null,2),'LabChem-plates-backup.json','application/json')});
 $('pl-import').addEventListener('change',async e=>{const file=e.target.files?.[0];if(!file)return;try{const data=JSON.parse(await file.text());if(data.version!==1||!Array.isArray(data.saved)||!data.draft)throw Error('Unsupported layout backup.');if(!confirm('Replace the current plate draft and all saved plate layouts with the selected backup? Dosing records will not change.'))return;state=normalize(data.draft);saved=data.saved.map(normalize);checkedCombinations.clear();activeCell=null;persist();refreshAll();notify('Plate layouts restored successfully.')}catch(err){notify('Import failed: '+err.message,true)}finally{e.target.value=''}});
}
function init(){if(!$('pl-grid'))return;bootStored();bind();refreshAll()}
window.PlateLayoutCore={SHAPES,place,combinations,splitValues,cellName,applySelection,selectionRect,tableHTML,plateTable,conditionTable};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
