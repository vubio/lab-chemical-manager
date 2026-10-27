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
// Clear, accessible priority colors on white paper; meaning is always stated in text.
const FACTOR_COLORS=['#A41E22','#1E5196','#216A45','#68428B'];
const FACTOR_RANKS=['Primary','Secondary','Third','Fourth'];
function legendEntries(source='plate'){
 // Factor identity comes from the live editor, not old well assignments.
 // Keep an unnamed fallback for manually entered third/fourth labels.
 const current=activeFactors().map(x=>x.name.trim());
 let count=current.length;
 if(source==='plate')for(const r of Object.values(state.assignments)){
  if(r.group==='manual')for(let i=0;i<Math.min(4,(r.labels||[]).length);i++)if(String(r.labels[i]||'').trim())count=Math.max(count,i+1);
 }
 return Array.from({length:Math.min(4,count)},(_,i)=>({name:current[i]||state.factors[i]?.name.trim()||`Factor ${i+1}`,rank:FACTOR_RANKS[i],color:FACTOR_COLORS[i]}));
}
function factorLegendHTML(source='plate'){
 const items=legendEntries(source);
 if(!items.length)return '';
 return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:11pt;line-height:1.5;margin:0 0 10px 0;padding:0;color:#374151">${items.map(f=>`<span style="display:inline-block;margin:0 16px 3px 0;white-space:nowrap"><span style="font-weight:800;color:${f.color}">&#9632;</span> <span style="color:${f.color};font-weight:600">${esc(f.name)}</span></span>`).join('')}</div>`;
}
function factorLegendPlain(source='plate'){
 const items=legendEntries(source);
 return items.map(f=>`${f.name} (${['dark red','blue','green','purple'][FACTOR_RANKS.indexOf(f.rank)]})`).join(' | ');
}
function renderFactorLegend(){const el=$('pl-factor-legend');if(el)el.innerHTML=factorLegendHTML('plate')}

const defaults=()=>({id:null,name:'New experiment',format:'96',selection:[],rowNotes:{},colNotes:{},fillOrder:'rows',mode:'select',factors:[{id:'factor1',name:'Dose',values:'0 µM; 0.05 µM; 0.1 µM; 0.2 µM'},{id:'factor2',name:'Cell density',values:''},{id:'factor3',name:'',values:''},{id:'factor4',name:'',values:''}],counts:{},assignments:{},notes:'',generatedAt:null,manualLayoutChanges:false,factorDraftStale:false});
let state=defaults(),saved=[],activeCell=null,drag=null,suppressClick=false,selectionAnchor=null,checkedCombinations=new Set(),factorUpdateTimer=null,lastWellPointer=null,labelDialogTargets=[],notesVisible=false;
function normalize(s){const d=defaults();if(!s||typeof s!=='object')return d;return {...d,...s, format:SHAPES[String(s.format)]?String(s.format):'96',selection:Array.isArray(s.selection)?s.selection:[],rowNotes:s.rowNotes&&typeof s.rowNotes==='object'?s.rowNotes:{},colNotes:s.colNotes&&typeof s.colNotes==='object'?s.colNotes:{},fillOrder:s.fillOrder==='columns'?'columns':'rows', factors:Array.isArray(s.factors)&&s.factors.length?s.factors.slice(0,4).map((f,i)=>({id:String(f.id||'factor'+(i+1)),name:String(f.name||''),values:String(f.values||'')})):d.factors,counts:s.counts&&typeof s.counts==='object'?s.counts:{},assignments:s.assignments&&typeof s.assignments==='object'?s.assignments:{},manualLayoutChanges:!!s.manualLayoutChanges,factorDraftStale:!!s.factorDraftStale}}
function dimensions(){return SHAPES[state.format]}
function allCoords(){let [rows,cols]=dimensions(),arr=[];for(let r=0;r<rows;r++)for(let c=0;c<cols;c++)arr.push(cellName(r,c));return arr}
function available(){const all=allCoords(),chosen=new Set(state.selection);return chosen.size?all.filter(x=>chosen.has(x)):all}
function activeFactors(){return state.factors.map(f=>({...f,options:splitValues(f.values)})).filter(f=>f.name.trim()&&f.options.length)}
function combinations(factors){if(!factors.length)return [];let combos=[{key:'',parts:[]}];for(const f of factors){combos=combos.flatMap(c=>f.options.map(v=>({key:JSON.stringify([...c.parts.map(p=>[p.id,p.value]),[f.id,v]].sort((a,b)=>a[0].localeCompare(b[0]))),parts:[...c.parts,{id:f.id,name:f.name,value:v}]})))}return combos}
function desired(){return combinations(activeFactors()).map(c=>({...c,replicates:Math.max(1,Number(state.counts[c.key])||1)}))}
/* Group by the primary factor before assigning secondary-factor replicates.
   A complete primary group gets one horizontal/vertical run where possible;
   groups too large or irregular to fit fall back to compact condition runs. */
function place(availableCoords,combos,rows,cols,order='rows'){
 const colFirst=order==='columns',availableSet=new Set(availableCoords),out={},occupied=new Set();
 const total=combos.reduce((n,c)=>n+c.replicates,0);
 if(total>availableSet.size)throw Error(`Need ${total} wells, but only ${availableSet.size} are available. Select more wells or reduce replicates.`);
 const ordered=[];
 if(colFirst){for(let c=0;c<cols;c++)for(let r=0;r<rows;r++)ordered.push(cellName(r,c))}
 else{for(let r=0;r<rows;r++)for(let c=0;c<cols;c++)ordered.push(cellName(r,c))}
 const lineLength=colFirst?rows:cols;let cursor=0;
 const groups=[];
 for(const combo of combos){
  const first=combo.parts?.[0],key=first?JSON.stringify([first.id,first.value]):combo.key;
  let g=groups.find(x=>x.key===key);
  if(!g){g={key,combos:[],count:0};groups.push(g)}
  g.combos.push(combo);g.count+=combo.replicates;
 }
 function findRun(count,preferFresh){
  if(count>lineLength)return [];
  const runs=[];
  for(let i=0;i+count<=ordered.length;i++){
   if(Math.floor(i/lineLength)!==Math.floor((i+count-1)/lineLength))continue;
   const run=ordered.slice(i,i+count);
   if(run.every(w=>availableSet.has(w)&&!occupied.has(w)))runs.push({run,line:Math.floor(i/lineLength),start:i%lineLength,index:i});
  }
  if(!runs.length)return [];
  if(preferFresh){const unused=runs.filter(({line})=>ordered.slice(line*lineLength,(line+1)*lineLength).every(w=>!occupied.has(w)));
   if(unused.length)return unused[0].run;}
  return (runs.find(x=>x.index>=cursor)||runs[0]).run;
 }
 function write(combo,wells){
  if(wells.length!==combo.replicates)throw Error('Not enough unoccupied wells for all conditions.');
  wells.forEach(w=>{occupied.add(w);out[w]={labels:combo.parts.map(p=>p.value),factorNames:combo.parts.map(p=>p.name),group:combo.key}});
  cursor=Math.max(cursor,...wells.map(w=>ordered.indexOf(w)+1));
 }
 for(const group of groups){
  // Keep all the secondary-factor conditions for a primary value in one row.
  const groupRun=group.combos.length>1?findRun(group.count,true):[];
  if(groupRun.length){let at=0;for(const combo of group.combos){write(combo,groupRun.slice(at,at+combo.replicates));at+=combo.replicates}continue}
  // The group cannot occupy one intact row/column; keep individual conditions compact.
  for(const combo of group.combos){
   let run=findRun(combo.replicates,false);
   if(!run.length)run=ordered.filter(w=>availableSet.has(w)&&!occupied.has(w)).slice(0,combo.replicates);
   write(combo,run);
  }
 }
 return out;
}
/* A physical transpose swaps occupied grid axes. It refuses any pattern whose
   transposed footprint cannot fit without clipping labels or selected wells. */
function transposeMap(assignments,selection,rows,cols){
 const used=[...new Set([...Object.keys(assignments),...selection])];
 if(!used.length)throw Error('Nothing to transpose. Generate a layout or select a well area first.');
 const coords=used.map(coord);
 const minR=Math.min(...coords.map(x=>x[0])),minC=Math.min(...coords.map(x=>x[1]));
 const maxR=Math.max(...coords.map(x=>x[0])),maxC=Math.max(...coords.map(x=>x[1]));
 const height=maxR-minR+1,width=maxC-minC+1;
 if(width>rows||height>cols)throw Error(`Cannot transpose a ${height} × ${width} region into this ${rows} × ${cols} plate. Use the other fill direction and Generate instead.`);
 const startR=Math.min(minR,rows-width),startC=Math.min(minC,cols-height);
 const target=w=>{const [r,c]=coord(w);return cellName(startR+c-minC,startC+r-minR)};
 const swapped={};
 for(const [w,data] of Object.entries(assignments))swapped[target(w)]=structuredClone(data);
 return {assignments:swapped,selection:selection.map(target),oldSize:[height,width],newSize:[width,height]};
}
function clearSelectedAssignments(assignments,selectedWells){
 const next={...assignments};
 let count=0;
 for(const well of new Set(selectedWells)){
  if(Object.prototype.hasOwnProperty.call(next,well)){delete next[well];count++}
 }
 return {assignments:next,count};
}
function clearSelectedLabels(){
 if(drag){notify('Finish or cancel the current move before deleting labels.',true);return}
 const valid=new Set(allCoords());
 const selected=[...new Set(state.selection.filter(w=>valid.has(w)))];
 if(!selected.length){notify('Select the well(s) you want to clear first (click, Shift-click, or Ctrl/⌘-click).',true);return}
 const amount=selected.filter(w=>Object.prototype.hasOwnProperty.call(state.assignments,w)).length;
 if(!amount){notify('The selected wells have no labels to delete. Nothing changed.',true);return}
 if(amount>1&&!window.confirm('Clear labels from '+amount+' selected wells? Other wells and row/column notes will stay unchanged.'))return;
 const result=clearSelectedAssignments(state.assignments,selected);
 state.assignments=result.assignments;
 state.manualLayoutChanges=true;
 activeCell=null;
 renderPlate();updateNote();persist();
 notify('Cleared labels from '+result.count+' selected well'+(result.count===1?'':'s')+'. The selected wells are now empty.');
}
function axisHeaderHTML(axis,key,note=''){
 const kind=axis==='row'?'row':'column',label=String(key),value=String(note||'').trim();
 return `<div class="pl-header pl-axis-header pl-${kind==='row'?'row':'col'}-axis${value?' pl-axis-noted':''}"><button type="button" class="pl-axis-trigger" data-axis="${kind}" data-axis-key="${esc(label)}" title="${esc(value?`Edit ${kind} ${label} note: ${value}`:`Add note to ${kind} ${label}`)}" aria-label="${esc(value?`Edit note for ${kind} ${label}: ${value}`:`Add note for ${kind} ${label}`)}"><span class="pl-axis-id">${esc(label)}</span>${value?`<span class="pl-axis-note" title="${esc(value)}">${esc(value)}</span>`:''}</button></div>`;
}
function axisInlineHeaderHTML(axis,key,note=''){
 const kind=axis==='row'?'row':'column',value=String(note||'');
 return `<label class="pl-header pl-axis-header pl-${kind==='row'?'row':'col'}-axis pl-axis-inline"><span class="pl-axis-id">${esc(key)}</span><input type="text" data-${kind==='row'?'row':'column'}-note="${esc(key)}" aria-label="Note for ${kind} ${esc(key)}" placeholder="Note" maxlength="160" value="${esc(value)}" title="Optional ${kind} note"/></label>`;
}
function plateAxisGridStart(showNotes,cols,colNotes={}){
 if(!showNotes)return '';
 let content='<span class="pl-header pl-corner"></span>';
 for(let c=1;c<=cols;c++)content+=axisInlineHeaderHTML('column',c,colNotes[c]||'');
 return content;
}
function renderPlate(){
 const [rows,cols]=dimensions(),isMove=state.mode==='move';
 const selected=new Set(state.selection),hasSelected=selected.size>0;
 const preview=drag?.mode==='move'?drag.preview:null;
 const assignments=preview?.assignments||state.assignments;
 const targetSet=new Set(preview?.selection||[]);
 const sourceSet=new Set(drag?.mode==='move'?drag.sources||[]:[]);
 const changedSet=new Set(preview?.displaced||[]);
 const grid=$('pl-grid');grid.style.setProperty('--plate-cols',cols);
 grid.classList.toggle('pl-notes-expanded',notesVisible);
 const notesCount=Object.values(state.rowNotes).filter(x=>String(x).trim()).length+Object.values(state.colNotes).filter(x=>String(x).trim()).length;
 const toggle=$('pl-toggle-notes');
 if(toggle){
  toggle.textContent=(notesVisible?'Hide notes':'Show notes')+(notesCount?' ('+notesCount+')':'');
  toggle.setAttribute('aria-expanded',String(notesVisible));
  toggle.setAttribute('aria-pressed',String(notesVisible));
 }
 let h=plateAxisGridStart(notesVisible,cols,state.colNotes);
 for(let r=0;r<rows;r++){
  const row=String.fromCharCode(65+r);
  if(notesVisible)h+=axisInlineHeaderHTML('row',row,state.rowNotes[row]||'');
  for(let c=0;c<cols;c++){
   const pos=cellName(r,c),record=assignments[pos],disabled=!isMove&&hasSelected&&!selected.has(pos),selectedHere=selected.has(pos);
   const classes='pl-well'+(record?' pl-assigned':'')+(selectedHere?' pl-selected':'')+(disabled?' pl-unselected':'')+(activeCell===pos?' pl-focus':'')+(record?.kind==='special'?' pl-special':'')+(sourceSet.has(pos)?' pl-move-origin':'')+(targetSet.has(pos)?' pl-drop-target':'')+(changedSet.has(pos)?' pl-ripple':'')+(drag?.invalid===pos?' pl-drop-invalid':'');
   const labels=record?.labels||[],labelText=labels.filter(Boolean).map(x=>String(x)).join(' | ');
   h+=`<button type="button" class="${classes}" data-well="${pos}" role="gridcell" title="${esc(pos+(labelText?' — '+labelText:''))}" aria-label="${esc(pos+(labelText?' '+labelText:''))}" aria-selected="${selectedHere?'true':'false'}"><span class="pl-coord">${pos}</span><span class="pl-labels"><span class="pl-primary">${esc(labels[0]||'')}</span>${labels.length>1?`<span class="pl-secondary">${esc(labels[1])}</span>`:''}${labels[2]?`<span class="pl-tertiary">${esc(labels[2])}</span>`:''}${labels[3]?`<span class="pl-quaternary">${esc(labels[3])}</span>`:''}</span></button>`;
  }
 }
 grid.innerHTML=h;renderFactorLegend();
 const chosen=[...selected].sort((a,b)=>wellIndex(a,cols)-wellIndex(b,cols));
 const isContinuous=contiguous(chosen,cols);
 const countLabeled=chosen.filter(w=>state.assignments[w]).length;
 $('pl-clear-selected').disabled=countLabeled===0;
 $('pl-selection-count').textContent=hasSelected?`${selected.size} selected (${countLabeled} labeled) · ${chosen.length===1?chosen[0]:`${chosen[0]}–${chosen.at(-1)}`} · ${isContinuous?'Consecutive':'Not consecutive'} · ${Object.keys(state.assignments).length} total labeled`: `No wells selected · ${Object.keys(state.assignments).length} labeled on ${state.format}-well plate`;
 $('pl-selection-count').classList.toggle('pl-selection-active',hasSelected);
 const feedback=$('pl-drag-preview');
 if(feedback){
  if(drag?.mode==='move'){
   feedback.hidden=false;
   feedback.className='pl-drag-preview'+(drag.error?' pl-preview-error':'');
   feedback.textContent=drag.error?`Cannot drop here: ${drag.error} · Release to cancel, or press Esc.`:preview?`PREVIEW · ${preview.sourceCount} labeled well${preview.sourceCount===1?'':'s'} → ${preview.selection[0]}–${preview.selection.at(-1)} · ${preview.displaced.length?'Other labels shift automatically.':'Empty destination.'} Release to apply · Esc to cancel.`:`Moving ${drag.sources.length} well${drag.sources.length===1?'':'s'} · Hover over a destination to preview · Esc to cancel.`;
  }else{feedback.hidden=true;feedback.textContent=''}
 }
 $('pl-current-well').textContent=activeCell?`Well ${activeCell} · double-click to edit its labels`:'Click or double-click a well to edit its labels';
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
 persist();renderCombinations();if(Object.keys(state.assignments).length)autoSyncPlate();else notify(`Set ${count} replicate${count===1?'':'s'} for ${targets.length} condition${targets.length===1?'':'s'}. Click Apply factors to plate to create the first map.`);
}
function updateEditorFields(){if(!activeCell)return;let vals=[...Array(4)].map((_,i)=>$('pl-edit-'+i)?.value?.trim()||'');state.assignments[activeCell]={labels:vals,factorNames:state.factors.map(x=>x.name),group:'manual',kind:'normal'};state.manualLayoutChanges=true;if(!vals.some(Boolean))delete state.assignments[activeCell];renderPlate();updateNote()}
function renderEditor(){const record=activeCell?state.assignments[activeCell]:null;const active=Boolean(activeCell);$('pl-save-label').disabled=!active;$('pl-remove-label').disabled=!active;
 $('pl-label-fields').innerHTML=Array.from({length:4},(_,i)=>`<label class="field"><span>${i===0?'Primary':i===1?'Secondary':i===2?'Third':'Fourth'} text</span><input id="pl-edit-${i}" ${active?'':'disabled'} value="${esc(record?.labels?.[i]||'')}" placeholder="${esc(state.factors[i]?.name||'Optional label')}"/></label>`).join('');
}
function updateNote(){const note=makeNote();$('pl-note-preview').textContent=note}
function axisTitle(label,note){return note?`${label} (${note})`:String(label)}
function plateTable(){const [rows,cols]=dimensions();return [
 ['Row / column',...Array.from({length:cols},(_,i)=>axisTitle(i+1,state.colNotes[i+1]||''))],
 ...Array.from({length:rows},(_,r)=>{const row=String.fromCharCode(65+r);return [axisTitle(row,state.rowNotes[row]||''),...Array.from({length:cols},(_,c)=>state.assignments[cellName(r,c)]?.labels?.filter(Boolean).join(' / ')||'')]})
]}
function makeNote(){let lines=['[PLATE LAYOUT]',`Title: ${state.name}`,`Plate format: ${state.format} wells`,`Fill preference: ${state.fillOrder==='columns'?'Columns first':'Rows first'}`,`Mapped: ${Object.keys(state.assignments).length} wells`,`Available area: ${state.selection.length?state.selection.slice().sort().join(', '):'Entire plate'}`,''];
 if(state.notes.trim())lines.push(`Notes: ${state.notes.trim()}`,'');
 return lines.concat([factorLegendPlain('plate'),''],plateTable().map(row=>row.join('\t'))).join('\n');
}
function conditionTable(){return desired().map(c=>[c.parts.map(p=>`${p.name}: ${p.value}`).join(' · '),c.replicates])}
const tdStyle='border:1px solid #8797a6;padding:7px 8px;text-align:left;vertical-align:top;';
function axisHTML(label,note){return `<span style="display:block;font-size:12px;font-weight:700;color:#263d4d">${esc(label)}</span>${note?`<span style="display:block;font-size:10px;font-weight:400;color:#53687a;margin-top:3px">${esc(note)}</span>`:''}`}
function labelsHTML(record){if(!record||!Array.isArray(record.labels))return '';
 const vals=record.labels;
 if(record.kind==='special')return `<div style="font:700 12px/1.3 Arial,sans-serif;color:#495562">${esc(record.controlName||vals[0]||'Control')} <span style="font-size:9px;color:#64748b">(control)</span></div>`;
 return vals.map((value,i)=>!String(value||'').trim()?'':`<div style="display:block;line-height:1.25;margin-bottom:${i===0?'3':'2'}px;font-family:Arial,Helvetica,sans-serif;font-size:${i===0?13:i===1?11:10}px;font-weight:${i===0?'700':i===1?'600':'400'};font-style:${i>=2?'italic':'normal'};color:${FACTOR_COLORS[i]||'#344054'}">${esc(value)}</div>`).join('');
}
function plateHTML(){const [rows,cols]=dimensions(),cells=[];
 cells.push(`<tr><th style="${tdStyle}background:#eaf0f4;font-weight:700">Row / column</th>${Array.from({length:cols},(_,i)=>`<th style="${tdStyle}background:#eaf0f4">${axisHTML(i+1,state.colNotes[i+1]||'')}</th>`).join('')}</tr>`);
 for(let r=0;r<rows;r++){
  const row=String.fromCharCode(65+r);
  const head=`<th style="${tdStyle}background:#eaf0f4">${axisHTML(row,state.rowNotes[row]||'')}</th>`;
  const data=Array.from({length:cols},(_,c)=>{const record=state.assignments[cellName(r,c)];return `<td style="${tdStyle}background:${record?'#f1f6f9':'#fff'};min-width:75px">${labelsHTML(record)}</td>`}).join('');
  cells.push(`<tr>${head}${data}</tr>`);
 }
 return `<table style="border-collapse:collapse;border:1px solid #8797a6;font-family:Arial,Helvetica,sans-serif;font-size:11pt;color:#20354a">${cells.join('')}</table>`;
}
function conditionHTML(){const rows=desired();return `<table style="border-collapse:collapse;border:1px solid #8797a6;font-family:Arial,sans-serif;font-size:11pt"><tr><th style="${tdStyle}background:#eaf0f4">Condition</th><th style="${tdStyle}background:#eaf0f4">Replicates</th></tr>${rows.map(c=>`<tr><td style="${tdStyle}">${labelsHTML({labels:c.parts.map(p=>`${p.name}: ${p.value}`)})}</td><td style="${tdStyle}">${c.replicates}</td></tr>`).join('')}</table>`}
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
function copyConditionsTable(){const rows=[['Condition','Replicates'],...conditionTable()];return copyRich(factorLegendHTML('conditions')+conditionHTML(),[factorLegendPlain('conditions'),'',...rows.map(r=>r.join('\t'))].join('\n'),'Condition table copied.')}
function copyPlateTable(){if(state.factorDraftStale)return notify('Plate labels still reflect the previous factors. Click Apply factors to plate before copying.',true);const rows=plateTable();return copyRich(factorLegendHTML('plate')+plateHTML(),[factorLegendPlain('plate'),'',...rows.map(r=>r.join('\t'))].join('\n'),'Plate table copied, including color legend and axis notes.')}
function persist(){try{localStorage.setItem(STORAGE,JSON.stringify({draft:state,saved}))}catch(e){notify('Could not save plate layout: browser storage full or unavailable.',true)}if(typeof window.dispatchEvent==='function'&&typeof CustomEvent!=='undefined')window.dispatchEvent(new CustomEvent('labchem:data-changed',{detail:{section:'plates'}}))}
function bootStored(){try{const data=JSON.parse(localStorage.getItem(STORAGE)||'null');if(data){state=normalize(data.draft);saved=Array.isArray(data.saved)?data.saved.map(normalize):[]}}catch(e){state=defaults();saved=[]}}
function syncMeta(){state.name=$('pl-title').value;state.notes=$('pl-notes').value;state.mode=$('pl-mode').value;persist();updateNote()}
function refreshAll(){ $('pl-title').value=state.name;$('pl-format').value=state.format;$('pl-mode').value=state.mode;$('pl-fill-order').value=state.fillOrder;$('pl-notes').value=state.notes;renderFactors();renderCombinations();renderPlate();renderSaved();updateNote(); }
function renderSaved(){const select=$('pl-saved'),old=select.value;select.innerHTML='<option value="">Choose saved layout</option>'+saved.map(x=>`<option value="${esc(x.id)}">${esc(x.name)} · ${esc(x.format)}-well · ${esc(x.savedAt?new Date(x.savedAt).toLocaleString():'')}</option>`).join('');if(saved.some(s=>s.id===old))select.value=old}
function notify(message,problem=false){const el=$('pl-layout-status');el.textContent=message;el.classList.toggle('pl-error',problem)}
function selectionRect(start,end){const [r1,c1]=coord(start),[r2,c2]=coord(end);const arr=[];for(let r=Math.min(r1,r2);r<=Math.max(r1,r2);r++)for(let c=Math.min(c1,c2);c<=Math.max(c1,c2);c++)arr.push(cellName(r,c));return arr}
function coord(w){const m=/^([A-P])(\d+)$/.exec(w);if(!m)throw Error('Invalid well coordinate');return [m[1].charCodeAt(0)-65,Number(m[2])-1]}
function applySelection(region,mode,base){const result=new Set(base);if(mode==='replace')result.clear();for(const w of region){if(mode==='subtract')result.delete(w);else result.add(w)}return [...result]}
/* A selection is consecutive if its occupied grid positions form one row-major
   interval. The last cell of a row is next to the first cell of the next row. */
function wellIndex(w,cols){const [r,c]=coord(w);return r*cols+c}
function wellAt(i,cols){return cellName(Math.floor(i/cols),i%cols)}
function contiguous(wells,cols){const n=[...new Set(wells)].map(w=>wellIndex(w,cols)).sort((a,b)=>a-b);return n.every((i,j)=>j===0||i===n[j-1]+1)}
function linearRange(a,b,cols){const lo=Math.min(wellIndex(a,cols),wellIndex(b,cols)),hi=Math.max(wellIndex(a,cols),wellIndex(b,cols));return Array.from({length:hi-lo+1},(_,i)=>wellAt(lo+i,cols))}
/* Move a consecutive block, following the grabbed well. A clear destination
   is moved into directly. On collision, insert the block by rotating the
   intervening plate cells, keeping every label, never swapping/overwriting. */
function moveBlock(assignments,selection,start,end,rows,cols){
 const total=rows*cols;
 const picked=selection.includes(start)?[...new Set(selection)]:[start];
 const sources=picked.sort((a,b)=>wellIndex(a,cols)-wellIndex(b,cols));
 if(!sources.length||sources.some(w=>!assignments[w]))throw Error('Select only labeled wells for a group move.');
 if(!contiguous(sources,cols))throw Error('The selected wells must be consecutive (row end connects to the next row). Use Shift-click to select one range.');
 const indexes=sources.map(w=>wellIndex(w,cols));
 const blockStart=indexes[0],count=sources.length,offset=wellIndex(start,cols)-blockStart;
 const targetStart=wellIndex(end,cols)-offset;
 if(targetStart<0||targetStart+count>total)throw Error('The selected block would extend outside this plate.');
 const target=Array.from({length:count},(_,i)=>wellAt(targetStart+i,cols));
 if(targetStart===blockStart)return {assignments:{...assignments},selection:target,sourceCount:count,displaced:[],method:'unchanged'};
 const originals=Array.from({length:total},(_,i)=>assignments[wellAt(i,cols)]||null);
 const block=originals.slice(blockStart,blockStart+count);
 let after=originals.slice(),displaced=[],method='empty';
 const sourceSet=new Set(indexes);
 const clearTarget=Array.from({length:count},(_,i)=>targetStart+i).every(i=>sourceSet.has(i)||!after[i]);
 if(clearTarget){
  for(const i of indexes)after[i]=null;
  for(let j=0;j<count;j++)after[targetStart+j]=block[j];
 }else{
  method='insert';
  // Shift the occupants toward the next empty slots after the destination.
  // We never move another label back into the origin, and never swap.
  indexes.forEach(i=>after[i]=null);
  const tail=after.slice(targetStart);
  const shifted=[...block];
  let freed=0;
  for(const record of tail){
   if(record===null&&freed<count){freed++;continue}
   shifted.push(record);
  }
  if(freed!==count)throw Error('Not enough empty wells after the destination to insert without replacing labels. Choose another destination.');
  after=after.slice(0,targetStart).concat(shifted);
  if(after.length!==total)throw Error('Internal move size error.');
  for(let i=0;i<total;i++)if(originals[i]!==after[i]&&!sourceSet.has(i)&&!(i>=targetStart&&i<targetStart+count)&&after[i])displaced.push(wellAt(i,cols));

 }
 const next={};after.forEach((record,i)=>{if(record)next[wellAt(i,cols)]=record});
 return {assignments:next,selection:target,sourceCount:count,displaced,method};
}
function openWellLabelDialog(well,applySelection=false){
 const targets=applySelection&&state.selection.length?state.selection.filter(w=>allCoords().includes(w)):[well];
 if(!targets.length){notify('Select one or more wells first.',true);return}
 labelDialogTargets=[...new Set(targets)];
 const record=state.assignments[well]||null;
 const kind=record?.kind==='special'||(!record&&applySelection)?'special':record?'normal':'special';
 $('pl-dialog-title').textContent=labelDialogTargets.length===1?'Edit '+well:'Label '+labelDialogTargets.length+' selected wells';
 $('pl-dialog-targets').textContent=labelDialogTargets.length===1?'Applies to '+well:'Will apply the same label to '+labelDialogTargets.length+' selected wells: '+labelDialogTargets.slice(0,16).join(', ')+(labelDialogTargets.length>16?'…':'');
 $('pl-dialog-kind').value=kind;
 $('pl-dialog-main').value=record?.controlName||record?.labels?.[0]||'';
 for(let i=1;i<4;i++)$('pl-dialog-extra-'+i).value=kind==='normal'?(record?.labels?.[i]||''):'';
 const displayExtra=()=>{$('pl-dialog-normal-fields').hidden=$('pl-dialog-kind').value!=='normal';$('pl-dialog-main-caption').textContent=$('pl-dialog-kind').value==='special'?'Control label (e.g. Media only)':'Primary factor label'};
 displayExtra();
 $('pl-label-dialog').hidden=false;
 $('pl-dialog-main').focus();
}
function installAxisNoteDialog(){
 if($('pl-axis-dialog'))return;
 const overlay=document.createElement('div');
 overlay.id='pl-axis-dialog';overlay.className='pl-label-overlay';overlay.hidden=true;
 overlay.innerHTML=`<section class="pl-label-modal" role="dialog" aria-modal="true" aria-labelledby="pl-axis-dialog-title">
 <h3 id="pl-axis-dialog-title">Row or column note</h3>
 <p class="tiny muted">Notes remain attached to the plate header and are included in copied plate tables.</p>
 <label class="field"><span>Header note</span><input id="pl-axis-note-input" type="text" maxlength="160" placeholder="e.g. Media only, No cells, Control"/></label>
 <div class="action-row"><button type="button" class="btn btn-primary" id="pl-axis-note-save">Save note</button><button type="button" class="btn" id="pl-axis-note-clear">Clear note</button><button type="button" class="btn" id="pl-axis-note-cancel">Cancel</button></div></section>`;
 document.body.appendChild(overlay);
 let editing=null;
 const close=()=>{overlay.hidden=true;editing=null};
 const save=value=>{
  if(!editing)return;
  const {axis,key}=editing;
  const map=axis==='row'?state.rowNotes:state.colNotes;
  const note=String(value||'').trim();
  if(note)map[key]=note;else delete map[key];
  close();renderPlate();updateNote();persist();
  const node=$('pl-grid').querySelector(`[data-axis="${axis}"][data-axis-key="${key}"]`);
  node?.focus();
  notify(note?`Saved note for ${axis} ${key}.`:`Cleared note for ${axis} ${key}.`);
 };
 $('pl-axis-note-save').addEventListener('click',()=>save($('pl-axis-note-input').value));
 $('pl-axis-note-clear').addEventListener('click',()=>save(''));
 $('pl-axis-note-cancel').addEventListener('click',close);
 $('pl-axis-note-input').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();save(e.target.value)}});
 overlay.addEventListener('mousedown',e=>{if(e.target===overlay)close()});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!overlay.hidden){e.stopPropagation();close()}});
 window.openPlateAxisNote=(axis,key)=>{
  if(!['row','column'].includes(axis))return;
  const valid=axis==='row'?Array.from({length:dimensions()[0]},(_,i)=>String.fromCharCode(65+i)):Array.from({length:dimensions()[1]},(_,i)=>String(i+1));
  if(!valid.includes(String(key)))return;
  editing={axis,key:String(key)};
  $('pl-axis-dialog-title').textContent=`Note for ${axis} ${key}`;
  $('pl-axis-note-input').value=(axis==='row'?state.rowNotes:state.colNotes)[key]||'';
  overlay.hidden=false;
  $('pl-axis-note-input').focus();
  $('pl-axis-note-input').select();
 };
}
function installWellLabelDialog(){
 if($('pl-label-dialog'))return;
 const overlay=document.createElement('div');
 overlay.id='pl-label-dialog';overlay.className='pl-label-overlay';overlay.hidden=true;
 overlay.innerHTML=`<section class="pl-label-modal" role="dialog" aria-modal="true" aria-labelledby="pl-dialog-title">
 <h3 id="pl-dialog-title">Edit well label</h3>
 <p class="tiny muted" id="pl-dialog-targets"></p>
 <label class="field"><span>Label type</span><select id="pl-dialog-kind"><option value="special">Special control / extra well</option><option value="normal">Normal factor labels</option></select></label>
 <label class="field"><span id="pl-dialog-main-caption">Control label</span><input id="pl-dialog-main" placeholder="Media only" maxlength="160"/></label>
 <div id="pl-dialog-normal-fields" class="pl-dialog-factors">${[1,2,3].map(i=>`<label class="field"><span>${['','Secondary','Third','Fourth'][i]} label</span><input id="pl-dialog-extra-${i}" maxlength="160"/></label>`).join('')}</div>
 <p class="tiny muted">Special controls are matched to reader measurements but kept separate from treatment-factor data.</p>
 <div class="action-row"><button class="btn btn-primary" id="pl-dialog-save" type="button">Apply labels</button><button class="btn" id="pl-dialog-cancel" type="button">Cancel</button></div></section>`;
 document.body.appendChild(overlay);
 const close=()=>{overlay.hidden=true;labelDialogTargets=[]};
 $('pl-dialog-cancel').addEventListener('click',close);
 overlay.addEventListener('mousedown',e=>{if(e.target===overlay)close()});
 $('pl-dialog-kind').addEventListener('change',()=>{$('pl-dialog-normal-fields').hidden=$('pl-dialog-kind').value!=='normal';$('pl-dialog-main-caption').textContent=$('pl-dialog-kind').value==='special'?'Control label (e.g. Media only)':'Primary factor label'});
 $('pl-dialog-save').addEventListener('click',()=>{
  const kind=$('pl-dialog-kind').value,label=$('pl-dialog-main').value.trim();
  if(!label){$('pl-dialog-main').focus();notify('Enter a label such as “Media only”.',true);return}
  const vals=kind==='special'?[label]:[label,...[1,2,3].map(i=>$('pl-dialog-extra-'+i).value.trim())];
  const count=labelDialogTargets.length;
  for(const w of labelDialogTargets){
   state.assignments[w]={labels:[...vals],factorNames:kind==='special'?['Control']:state.factors.map(x=>x.name),group:'manual',kind,controlName:kind==='special'?label:undefined};
  }
  state.manualLayoutChanges=true;state.factorDraftStale=false;
  close();renderPlate();updateNote();persist();
  notify('Applied “'+label+'” to '+count+' well'+(count===1?'':'s')+'.'+(kind==='special'?' Reader matching will identify these as special controls.':''));
 });
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!overlay.hidden){close();e.stopPropagation()}});
}
function beginDrag(e){
 const well=e.target.closest('[data-well]');if(!well||e.button!==0)return;
 e.preventDefault();const start=well.dataset.well,now=Date.now();
 if(lastWellPointer?.well===start&&now-lastWellPointer.time<420&&!e.shiftKey&&!e.ctrlKey&&!e.metaKey&&!e.altKey){
  lastWellPointer=null;drag=null;suppressClick=true;activeCell=start;openWellLabelDialog(start);return;
 }
 lastWellPointer={well:start,time:now};
 const selected=state.selection.includes(start),[rows,cols]=dimensions();
 // Modifiers act on the selection; dragging a selected labeled block in Move
 // mode moves it. In Select mode an existing selected group is also draggable.
 const mode=e.altKey?'subtract':e.ctrlKey||e.metaKey?'add':e.shiftKey?'shift':(state.mode==='move'&&state.assignments[start])||(selected&&state.assignments[start])?'move':'replace';
 const sources=mode==='move'?(selected?[...state.selection]:[start]):[];
 drag={start,last:start,mode,base:[...state.selection],sources,moved:false,preview:null,error:null,invalid:null};
 activeCell=start;renderPlate();
}
function moveDrag(e){
 if(!drag)return;
 const well=document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-well]');
 if(!well)return;
 const dest=well.dataset.well;if(dest===drag.last)return;
 drag.last=dest;drag.moved=true;
 if(drag.mode==='move'){
  try{const [rows,cols]=dimensions();drag.preview=moveBlock(state.assignments,drag.sources,drag.start,dest,rows,cols);drag.error=null;drag.invalid=null}
  catch(err){drag.preview=null;drag.error=err.message;drag.invalid=dest}
  renderPlate();
 }else if(drag.mode!=='shift'){
  state.selection=applySelection(selectionRect(drag.start,dest),drag.mode,drag.base);renderPlate();
 }
}
function finishDrag(){
 if(!drag)return;
 const {start,last,mode,base,moved,preview,error}=drag;drag=null;suppressClick=true;
 if(mode==='move'&&moved){
  if(preview&&!error&&preview.method!=='unchanged'){
   state.assignments=preview.assignments;state.selection=preview.selection;state.manualLayoutChanges=true;
   activeCell=preview.selection[0];selectionAnchor=activeCell;
   notify(`Moved ${preview.sourceCount} label${preview.sourceCount===1?'':'s'} to ${preview.selection[0]}–${preview.selection.at(-1)}.${preview.method==='insert'?' Other labels shifted; none were replaced.':''}`);
  }else if(error)notify('Move canceled: '+error,true);
 }else if(!moved&&mode==='shift'){
  const anchor=selectionAnchor||base[0]||start;
  state.selection=linearRange(anchor,start,dimensions()[1]);
  selectionAnchor=anchor;
 }else if(!moved&&mode==='add'){
  const chosen=new Set(base);if(chosen.has(start))chosen.delete(start);else chosen.add(start);
  state.selection=[...chosen];selectionAnchor=start;
 }else if(!moved&&mode==='subtract'){
  state.selection=base.filter(w=>w!==start);selectionAnchor=start;
 }else if(!moved&&mode==='replace'||!moved&&mode==='move'){
  state.selection=[start];selectionAnchor=start;
 }else if(moved&&mode!=='move'){
  state.selection=applySelection(selectionRect(start,last),mode,base);
  selectionAnchor=start;
 }
 renderPlate();updateNote();persist();
}
function plannedAvailable(combos){
 const needed=combos.reduce((total,c)=>total+c.replicates,0),all=allCoords();
 if(!state.selection.length||state.selection.length>=needed)return {wells:available(),clearSelection:false};
 // An incidental editing selection doesn't become a permanent restriction
 // when the existing labeled map already extends beyond that selection.
 const chosen=new Set(state.selection),hadLabeledOutside=Object.keys(state.assignments).some(w=>!chosen.has(w));
 if(hadLabeledOutside&&needed<=all.length)return {wells:all,clearSelection:true};
 return {wells:available(),clearSelection:false};
}
function replan(silent=false){
 const factors=activeFactors(),combos=desired();
 if(!factors.length){if(Object.keys(state.assignments).length)state.factorDraftStale=true;if(!silent)notify('Enter at least one factor with values.',true);return false}
 try{
  const [rows,cols]=dimensions(),plan=plannedAvailable(combos);
  const next=place(plan.wells,combos,rows,cols,state.fillOrder);
  state.assignments=next;
  if(plan.clearSelection)state.selection=[];
  state.generatedAt=new Date().toISOString();state.manualLayoutChanges=false;state.factorDraftStale=false;activeCell=null;selectionAnchor=null;
  renderPlate();updateNote();persist();
  notify(`${silent?'Updated':'Generated'} ${Object.keys(next).length} wells for ${combos.length} conditions.${plan.clearSelection?' Cleared a previous editing selection and used the entire plate.':''}`);
  return true;
 }catch(e){if(Object.keys(state.assignments).length)state.factorDraftStale=true;persist();notify(`${e.message} ${state.selection.length?'Use “Use entire plate” to remove an intentional well restriction.':''}`,true);return false}
}
function generate(){syncFactors();
 if(Object.keys(state.assignments).length&&!window.confirm('Replace existing plate labels with the current factors? Manual edits, if any, will be overwritten.'))return;
 replan(false);
}
function autoSyncPlate(){
 renderFactorLegend();
 if(!Object.keys(state.assignments).length)return;
 if(state.manualLayoutChanges||Object.values(state.assignments).some(r=>r.group==='manual')){
  state.factorDraftStale=true;persist();notify('Factor names updated. Manual well edits prevent automatic relabeling. Click Apply factors to plate before copying.');return;
 }
 replan(true);
}
function syncFactors(){
 const previous=state.factors.map(f=>({...f}));
 state.factors.forEach(f=>{const name=$('pl-factors').querySelector(`[data-fname="${f.id}"]`),values=$('pl-factors').querySelector(`[data-fvalues="${f.id}"]`);if(name)f.name=name.value;if(values)f.values=values.value});
 // Preserve replicate counts by factor position when the user renames values;
 // an added level inherits the final existing level's replicate count.
 const before=previous.map(f=>({...f,options:splitValues(f.values)})).filter(f=>f.name.trim()&&f.options.length);
 const after=activeFactors();
 for(const combo of combinations(after)){
  if(Number.isInteger(state.counts[combo.key]))continue;
  const nearest=combo.parts.map(p=>{const current=after.find(x=>x.id===p.id),old=before.find(x=>x.id===p.id);if(!old)return null;const idx=current.options.indexOf(p.value);return [p.id,old.options[Math.min(idx,old.options.length-1)]]}).filter(Boolean);
  if(!nearest.length)continue;
  const oldKey=JSON.stringify(nearest.sort((a,b)=>a[0].localeCompare(b[0])));
  if(Number.isInteger(state.counts[oldKey]))state.counts[combo.key]=state.counts[oldKey];
 }
}
function fileDownload(text,name,type='text/plain'){const blob=new Blob([text],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000)}
function downloadTSV(){const safe=(state.name||'plate').replace(/[^\w-]+/g,'_').slice(0,50);fileDownload(plateTable().map(row=>row.map(x=>String(x).replace(/\n/g,' / ')).join('\t')).join('\n'),safe+'-plate.tsv','text/tab-separated-values')}
async function copyNote(){if(state.factorDraftStale)return notify('Plate labels still reflect the previous factors. Click Apply factors to plate before copying.',true);const title=`<p style="font-family:Arial,sans-serif"><b>${esc(state.name)}</b> · ${esc(state.format)}-well plate</p>`;
 const extra=state.notes.trim()?`<p style="font-family:Arial,sans-serif">${esc(state.notes)}</p>`:'';
 return copyRich(title+extra+factorLegendHTML('plate')+plateHTML(),makeNote(),'Plate note copied, including factor colors and axis notes.');}
function transposeCurrent(){
 try{const [rows,cols]=dimensions(),result=transposeMap(state.assignments,state.selection,rows,cols);state.manualLayoutChanges=true;state.assignments=result.assignments;state.selection=result.selection;activeCell=null;renderPlate();updateNote();persist();notify(`Transposed ${result.oldSize.join(' × ')} → ${result.newSize.join(' × ')}. Row and column notes stay with their physical plate axes.`)}catch(e){notify(e.message,true)}
}
function save(){syncMeta();syncFactors();const item=structuredClone(state);item.id='plate-'+Date.now()+'-'+Math.random().toString(36).slice(2,6);item.savedAt=new Date().toISOString();saved.unshift(item);state.id=item.id;persist();renderSaved();$('pl-saved').value=item.id;notify('Layout saved. Older saved layouts are kept unchanged.')}
function bind(){installWellLabelDialog();installAxisNoteDialog();const grid=$('pl-grid');
 $('pl-toggle-notes').addEventListener('click',()=>{
  notesVisible=!notesVisible;
  renderPlate();
  notify(notesVisible?'Row and column notes are now editable in their headers.':'Row and column notes are hidden; existing notes are preserved.');
 });grid.addEventListener('pointerdown',e=>{if(e.pointerType==='touch')return;beginDrag(e)});document.addEventListener('pointermove',e=>{if(drag)moveDrag(e)});document.addEventListener('pointerup',e=>{if(!drag)return;if(drag.mode==='move'&&!document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-well]')){drag=null;renderPlate();notify('Move canceled: release over a well to apply it.');return}finishDrag()});grid.addEventListener('click',e=>{const w=e.target.closest('[data-well]');if(!w)return;if(suppressClick){suppressClick=false;return}activeCell=w.dataset.well;renderPlate()});grid.addEventListener('dblclick',e=>{const w=e.target.closest('[data-well]');if(w&&$('pl-label-dialog').hidden)openWellLabelDialog(w.dataset.well)});
 grid.addEventListener('click',e=>{const axis=e.target.closest('[data-axis]');if(axis&&axis.dataset.axisKey){window.openPlateAxisNote(axis.dataset.axis,axis.dataset.axisKey)}});
 grid.addEventListener('input',e=>{
  const element=e.target;
  if(element.matches('[data-row-note]')){const key=element.dataset.rowNote;if(element.value.trim())state.rowNotes[key]=element.value;else delete state.rowNotes[key]}
  else if(element.matches('[data-column-note]')){const key=element.dataset.columnNote;if(element.value.trim())state.colNotes[key]=element.value;else delete state.colNotes[key]}
  else return;
  persist();updateNote();
 });
 grid.addEventListener('change',e=>{
  if(!e.target.matches('[data-row-note],[data-column-note]'))return;
  const control=e.target;const key=control.matches('[data-row-note]')?control.dataset.rowNote:control.dataset.columnNote;
  const map=control.matches('[data-row-note]')?state.rowNotes:state.colNotes;
  if(map[key])map[key]=map[key].trim();
  control.value=map[key]||'';
  renderPlate();persist();updateNote();
 });
 // Keyboard support: arrow navigation is native via tab, Enter opens the inline editor.
 grid.addEventListener('keydown',e=>{
  const w=e.target.closest('[data-well]');
  if(!w)return;
  if(e.key==='Enter'){e.preventDefault();openWellLabelDialog(w.dataset.well)}
  else if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();clearSelectedLabels()}
 });
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&drag){drag=null;renderPlate();notify('Move canceled. No labels changed.')}});
 $('pl-format').addEventListener('change',e=>{const selected=state.selection.length||Object.keys(state.assignments).length;if(selected&&!confirm('Changing plate format clears selection and current labels. Continue?')){e.target.value=state.format;return}state.format=e.target.value;state.selection=[];state.assignments={};state.manualLayoutChanges=false;state.rowNotes={};state.colNotes={};activeCell=null;selectionAnchor=null;renderCombinations();renderPlate();updateNote();persist()});
 $('pl-fill-order').addEventListener('change',e=>{state.fillOrder=e.target.value==='columns'?'columns':'rows';persist();notify('Fill preference saved. Click Generate to apply it; current labels are unchanged.')});$('pl-transpose').addEventListener('click',transposeCurrent);$('pl-mode').addEventListener('change',syncMeta);$('pl-title').addEventListener('input',syncMeta);$('pl-notes').addEventListener('input',syncMeta);
 $('pl-clear-selected').addEventListener('click',clearSelectedLabels);
 $('pl-all').addEventListener('click',()=>{state.selection=[];renderPlate();persist();notify('Entire plate available for layout.')});$('pl-clear').addEventListener('click',()=>{if(Object.keys(state.assignments).length&&!confirm('Clear all well labels from the current plate? Saved layouts remain available.'))return;state.assignments={};state.manualLayoutChanges=false;activeCell=null;renderPlate();updateNote();persist();notify('All well labels cleared. Selected well areas are unchanged.')});
 $('pl-factors').addEventListener('input',e=>{if(!e.target.matches('[data-fname],[data-fvalues]'))return;syncFactors();renderCombinations();renderFactorLegend();persist();clearTimeout(factorUpdateTimer);factorUpdateTimer=setTimeout(autoSyncPlate,650)});
 $('pl-factors').addEventListener('change',e=>{if(!e.target.matches('[data-fname],[data-fvalues]'))return;clearTimeout(factorUpdateTimer);syncFactors();renderCombinations();autoSyncPlate()});
 $('pl-factors').addEventListener('click',e=>{const b=e.target.closest('[data-movefactor]');if(!b)return;syncFactors();const i=state.factors.findIndex(f=>f.id===b.dataset.movefactor),j=i+Number(b.dataset.direction);if(j<0||j>=state.factors.length)return;[state.factors[i],state.factors[j]]=[state.factors[j],state.factors[i]];renderFactors();renderCombinations();autoSyncPlate();persist()});
 $('pl-preview').addEventListener('click',()=>{syncFactors();renderCombinations();autoSyncPlate();persist()});
 $('pl-batch-apply').addEventListener('click',applyBatchReplicates);$('pl-batch-scope').addEventListener('change',e=>{$('pl-batch-factor-wrap').classList.toggle('hidden',e.target.value!=='factor')});
 $('pl-combos').addEventListener('change',e=>{if(e.target.id==='pl-check-all'){const keys=desired().map(c=>c.key);checkedCombinations=e.target.checked?new Set(keys):new Set();renderCombinations();return}if(e.target.matches('[data-select-combo]')){if(e.target.checked)checkedCombinations.add(e.target.dataset.selectCombo);else checkedCombinations.delete(e.target.dataset.selectCombo);const all=$('pl-check-all');if(all)all.checked=checkedCombinations.size===desired().length;}});
 $('pl-combos').addEventListener('input',e=>{const el=e.target;if(!el.matches('[data-reps]'))return;const n=Number(el.value);state.counts[el.dataset.reps]=Number.isInteger(n)&&n>0?n:1;persist();const combos=desired();notify(`${combos.reduce((a,c)=>a+c.replicates,0)} wells requested · ${available().length} available`)});
 $('pl-combos').addEventListener('change',e=>{if(!e.target.matches('[data-reps]'))return;if(Object.keys(state.assignments).length)autoSyncPlate()});
 $('pl-copy-table').addEventListener('click',copyPlateTable);$('pl-copy-conditions').addEventListener('click',copyConditionsTable);
 $('pl-label-selected').addEventListener('click',()=>{const targets=state.selection.length?state.selection:activeCell?[activeCell]:[];if(!targets.length){notify('Select wells on the plate, then click “Label selected wells”.',true);return}openWellLabelDialog(targets[0],true)});
 $('pl-generate').addEventListener('click',generate);$('pl-save-label').addEventListener('click',()=>{if(activeCell)updateEditorFields();persist()});$('pl-remove-label').addEventListener('click',()=>{if(activeCell){delete state.assignments[activeCell];state.manualLayoutChanges=true;renderPlate();updateNote();persist()}});
 $('pl-save').addEventListener('click',save);$('pl-copy').addEventListener('click',copyNote);$('pl-tsv').addEventListener('click',downloadTSV);
 $('pl-new').addEventListener('click',()=>{if(!confirm('Start a new blank plate layout? Your saved layouts remain available.'))return;state=defaults();checkedCombinations.clear();activeCell=null;selectionAnchor=null;persist();refreshAll()});
 $('pl-load').addEventListener('click',()=>{const src=saved.find(x=>x.id===$('pl-saved').value);if(!src)return notify('Choose a saved layout.',true);state=normalize(structuredClone(src));checkedCombinations.clear();activeCell=null;selectionAnchor=null;persist();refreshAll();notify('Saved plate layout loaded. You can edit and save it as another version.')});
 $('pl-delete').addEventListener('click',()=>{const id=$('pl-saved').value;if(!id)return notify('Choose a saved layout.',true);if(!confirm('Permanently delete this saved layout?'))return;saved=saved.filter(x=>x.id!==id);persist();renderSaved();notify('Saved layout deleted. Current working map is unchanged.')});
 $('pl-export').addEventListener('click',()=>{syncMeta();syncFactors();fileDownload(JSON.stringify({version:1,draft:state,saved,exportedAt:new Date().toISOString()},null,2),'LabChem-plates-backup.json','application/json')});
 $('pl-import').addEventListener('change',async e=>{const file=e.target.files?.[0];if(!file)return;try{const data=JSON.parse(await file.text());if(data.version!==1||!Array.isArray(data.saved)||!data.draft)throw Error('Unsupported layout backup.');if(!confirm('Replace the current plate draft and all saved plate layouts with the selected backup? Dosing records will not change.'))return;state=normalize(data.draft);saved=data.saved.map(normalize);checkedCombinations.clear();activeCell=null;selectionAnchor=null;persist();refreshAll();notify('Plate layouts restored successfully.')}catch(err){notify('Import failed: '+err.message,true)}finally{e.target.value=''}});
}
function init(){if(!$('pl-grid'))return;bootStored();bind();refreshAll()}
window.PlateLayoutCloud={
 getSnapshot:()=>structuredClone({draft:state,saved}),
 replaceSnapshot(payload){
  if(!payload||!Array.isArray(payload.saved)||payload.draft===undefined)throw Error('Invalid plate layout data in cloud snapshot.');
  state=normalize(payload.draft);saved=payload.saved.map(normalize);activeCell=null;selectionAnchor=null;checkedCombinations.clear();notesVisible=false;
  persist();refreshAll();
 }
};
window.PlateLayoutCore={SHAPES,clearSelectedAssignments,axisHeaderHTML,axisInlineHeaderHTML,plateAxisGridStart,place,moveBlock,transposeMap,combinations,splitValues,cellName,applySelection,selectionRect,contiguous,linearRange,plateHTML,plateTable,conditionHTML,conditionTable,labelsHTML,legendEntries,factorLegendHTML,factorLegendPlain,getSnapshot:()=>structuredClone(state)};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();