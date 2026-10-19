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
 const current=activeFactors().map(x=>x.name.trim());
 let names=current;
 if(source==='plate'){
  const records=Object.values(state.assignments);
  const indices=records.flatMap(r=>(r.labels||[]).map((v,i)=>String(v||'').trim()?i:-1)).filter(i=>i>=0);
  const length=indices.length?Math.max(...indices)+1:0;
  if(length)names=Array.from({length},(_,i)=>{
   const r=records.find(r=>String(r.labels?.[i]||'').trim());
   return r?.factorNames?.[i]?.trim()||current[i]||`Factor ${i+1}`;
  });
 }
 return names.slice(0,4).map((name,i)=>({name:name||`Factor ${i+1}`,rank:FACTOR_RANKS[i],color:FACTOR_COLORS[i]}));
}
function factorLegendHTML(source='plate'){
 const items=legendEntries(source);
 if(!items.length)return '';
 return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:11pt;line-height:1.5;margin:0 0 10px 0;padding:0;color:#374151"><strong style="font-weight:700">Factor colors: </strong>${items.map(f=>`<span style="display:inline-block;margin:0 14px 3px 0;white-space:nowrap"><strong style="font-weight:700;color:${f.color}">&#9632; ${esc(f.rank)}:</strong> <span style="color:${f.color};font-weight:600">${esc(f.name)}</span></span>`).join('')}</div>`;
}
function factorLegendPlain(source='plate'){
 const items=legendEntries(source);
 return items.length?'Factor colors: '+items.map(f=>`${f.rank} = ${f.name} (${['dark red','blue','green','purple'][FACTOR_RANKS.indexOf(f.rank)]})`).join(' | '):'';
}
function renderFactorLegend(){const el=$('pl-factor-legend');if(el)el.innerHTML=factorLegendHTML('plate')}

const defaults=()=>({id:null,name:'New experiment',format:'96',selection:[],rowNotes:{},colNotes:{},fillOrder:'rows',mode:'select',factors:[{id:'factor1',name:'Dose',values:'0 µM; 0.05 µM; 0.1 µM; 0.2 µM'},{id:'factor2',name:'Cell density',values:''},{id:'factor3',name:'',values:''},{id:'factor4',name:'',values:''}],counts:{},assignments:{},notes:'',generatedAt:null});
let state=defaults(),saved=[],activeCell=null,drag=null,suppressClick=false,selectionAnchor=null,checkedCombinations=new Set();
function normalize(s){const d=defaults();if(!s||typeof s!=='object')return d;return {...d,...s, format:SHAPES[String(s.format)]?String(s.format):'96',selection:Array.isArray(s.selection)?s.selection:[],rowNotes:s.rowNotes&&typeof s.rowNotes==='object'?s.rowNotes:{},colNotes:s.colNotes&&typeof s.colNotes==='object'?s.colNotes:{},fillOrder:s.fillOrder==='columns'?'columns':'rows', factors:Array.isArray(s.factors)&&s.factors.length?s.factors.slice(0,4).map((f,i)=>({id:String(f.id||'factor'+(i+1)),name:String(f.name||''),values:String(f.values||'')})):d.factors,counts:s.counts&&typeof s.counts==='object'?s.counts:{},assignments:s.assignments&&typeof s.assignments==='object'?s.assignments:{}}}
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
function renderPlate(){const [rows,cols]=dimensions(),selected=new Set(state.selection),hasSelected=selected.size>0;const grid=$('pl-grid');grid.style.setProperty('--plate-cols',cols);
 let h='<span class="pl-header pl-corner"></span>';
 for(let c=1;c<=cols;c++)h+=`<label class="pl-header pl-axis-header pl-col-axis"><span class="pl-axis-id">${c}</span><input data-column-note="${c}" aria-label="Note for column ${c}" type="text" value="${esc(state.colNotes[c]||'')}" placeholder="Note" title="Optional note for column ${c}"/></label>`;
 for(let r=0;r<rows;r++){const row=String.fromCharCode(65+r);h+=`<label class="pl-header pl-axis-header pl-row-axis"><span class="pl-axis-id">${row}</span><input data-row-note="${row}" aria-label="Note for row ${row}" value="${esc(state.rowNotes[row]||'')}" placeholder="Note" title="Optional note for row ${row}"/></label>`;
 for(let c=0;c<cols;c++){const pos=cellName(r,c),record=state.assignments[pos],disabled=hasSelected&&!selected.has(pos),selectedHere=selected.has(pos);let classes='pl-well'+(record?' pl-assigned':'')+(selectedHere?' pl-selected':'')+(disabled?' pl-unselected':'')+(activeCell===pos?' pl-focus':'');let labels=record?.labels||[],labelText=labels.filter(Boolean).map(x=>String(x)).join(' | ');
 h+=`<button type="button" class="${classes}" data-well="${pos}" role="gridcell" title="${esc(pos+(labelText?' — '+labelText:''))}" aria-label="${esc(pos+(labelText?' '+labelText:''))}"><span class="pl-coord">${pos}</span><span class="pl-labels"><span class="pl-primary">${esc(labels[0]||'')}</span>${labels.length>1?`<span class="pl-secondary">${esc(labels[1])}</span>`:''}${labels[2]?`<span class="pl-tertiary">${esc(labels[2])}</span>`:''}${labels[3]?`<span class="pl-quaternary">${esc(labels[3])}</span>`:''}</span></button>`;
 }}grid.innerHTML=h;renderFactorLegend();
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
function copyPlateTable(){const rows=plateTable();return copyRich(factorLegendHTML('plate')+plateHTML(),[factorLegendPlain('plate'),'',...rows.map(r=>r.join('\t'))].join('\n'),'Plate table copied, including color legend and axis notes.')}
function persist(){try{localStorage.setItem(STORAGE,JSON.stringify({draft:state,saved}))}catch(e){notify('Could not save plate layout: browser storage full or unavailable.',true)}}
function bootStored(){try{const data=JSON.parse(localStorage.getItem(STORAGE)||'null');if(data){state=normalize(data.draft);saved=Array.isArray(data.saved)?data.saved.map(normalize):[]}}catch(e){state=defaults();saved=[]}}
function syncMeta(){state.name=$('pl-title').value;state.notes=$('pl-notes').value;state.mode=$('pl-mode').value;persist();updateNote()}
function refreshAll(){ $('pl-title').value=state.name;$('pl-format').value=state.format;$('pl-mode').value=state.mode;$('pl-fill-order').value=state.fillOrder;$('pl-notes').value=state.notes;renderFactors();renderCombinations();renderPlate();renderSaved();updateNote(); }
function renderSaved(){const select=$('pl-saved'),old=select.value;select.innerHTML='<option value="">Choose saved layout</option>'+saved.map(x=>`<option value="${esc(x.id)}">${esc(x.name)} · ${esc(x.format)}-well · ${esc(x.savedAt?new Date(x.savedAt).toLocaleString():'')}</option>`).join('');if(saved.some(s=>s.id===old))select.value=old}
function notify(message,problem=false){const el=$('pl-layout-status');el.textContent=message;el.classList.toggle('pl-error',problem)}
function selectionRect(start,end){const [r1,c1]=coord(start),[r2,c2]=coord(end);const arr=[];for(let r=Math.min(r1,r2);r<=Math.max(r1,r2);r++)for(let c=Math.min(c1,c2);c<=Math.max(c1,c2);c++)arr.push(cellName(r,c));return arr}
function coord(w){const m=/^([A-P])(\d+)$/.exec(w);if(!m)throw Error('Invalid well coordinate');return [m[1].charCodeAt(0)-65,Number(m[2])-1]}
function applySelection(region,mode,base){const result=new Set(base);if(mode==='replace')result.clear();for(const w of region){if(mode==='subtract')result.delete(w);else result.add(w)}return [...result]}
/* Translate a selected multiwell block without changing relative well positions.
   Reject partial moves and collisions; no label is silently overwritten. */
function moveBlock(assignments,selection,start,end,rows,cols){
 const picked=selection.includes(start)?selection.filter(w=>assignments[w]):[];
 const sources=picked.length?picked:(assignments[start]?[start]:[]);
 if(!sources.length)throw Error('Select labeled wells to move.');
 const [r0,c0]=coord(start),[r1,c1]=coord(end),dr=r1-r0,dc=c1-c0;
 const targets=sources.map(w=>{const [r,c]=coord(w);return [r+dr,c+dc]});
 if(targets.some(([r,c])=>r<0||c<0||r>=rows||c>=cols))throw Error('Cannot move the selected group beyond the plate edge. No labels were changed.');
 const destinations=targets.map(([r,c])=>cellName(r,c));
 const srcSet=new Set(sources);
 const occupied=destinations.filter(w=>!srcSet.has(w)&&assignments[w]);
 if(occupied.length&&sources.length>1)throw Error(`Move blocked: ${occupied.join(', ')} already contain labels. No labels were changed.`);
 const next={...assignments};
 if(occupied.length&&sources.length===1)next[start]=assignments[end]; // Preserve single-well swap.
 else sources.forEach(w=>delete next[w]);
 sources.forEach((w,i)=>next[destinations[i]]=assignments[w]);
 return {assignments:next,selection:destinations,sourceCount:sources.length};
}
function beginDrag(e){
 const well=e.target.closest('[data-well]');if(!well||e.button!==0)return;
 e.preventDefault();const start=well.dataset.well,selected=state.selection.includes(start);
 const mode=e.altKey?'subtract':e.ctrlKey||e.metaKey?'add':e.shiftKey?'shift':state.mode==='move'||(selected&&Boolean(state.assignments[start]))?'move':'replace';
 drag={start,last:start,mode,base:[...state.selection],moved:false};activeCell=start;renderPlate();
}
function moveDrag(e){
 if(!drag)return;
 const w=document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-well]');if(!w)return;
 const dest=w.dataset.well;if(dest===drag.last)return;
 drag.last=dest;drag.moved=true;
 if(drag.mode!=='move'&&drag.mode!=='shift'){
  state.selection=applySelection(selectionRect(drag.start,dest),drag.mode,drag.base);renderPlate();
 }
}
function finishDrag(){
 if(!drag)return;
 const {start,last,mode,base,moved}=drag;drag=null;suppressClick=true;
 if(moved&&(mode==='move'||mode==='shift')){
  try{
   const [rows,cols]=dimensions();
   const result=moveBlock(state.assignments,base,start,last,rows,cols);
   state.assignments=result.assignments;state.selection=result.selection;
   activeCell=last;selectionAnchor=last;
   notify(`Moved ${result.sourceCount} labeled well${result.sourceCount===1?'':'s'} to ${result.selection.join(', ')}.`);
  }catch(err){notify(err.message,true)}
 }else if(!moved&&mode==='shift'){
  const anchor=selectionAnchor||base[0]||start;
  state.selection=applySelection(selectionRect(anchor,start),'add',base);
  if(!selectionAnchor)selectionAnchor=anchor;
 }else if(!moved&&mode==='add'){
  const chosen=new Set(base);if(chosen.has(start))chosen.delete(start);else chosen.add(start);
  state.selection=[...chosen];selectionAnchor=start;
 }else if(!moved&&mode==='subtract'){
  state.selection=base.filter(w=>w!==start);selectionAnchor=start;
 }else if(!moved&&mode==='replace'){
  state.selection=[start];selectionAnchor=start;
 }else if(moved){
  state.selection=applySelection(selectionRect(start,last),mode,base);
  selectionAnchor=start;
 }
 renderPlate();updateNote();persist();
}
function generate(){syncFactors();const factors=activeFactors(),combos=desired();if(!factors.length)return notify('Enter a factor with at least one value.',true);if(!combos.every(c=>Number.isInteger(c.replicates)&&c.replicates>0))return notify('Replicates must be positive whole numbers.',true);
 if(Object.keys(state.assignments).length&&!window.confirm('Replace the current plate labels with a newly generated layout? Manual edits will be overwritten.'))return;
 try{const [rows,cols]=dimensions();state.assignments=place(available(),combos,rows,cols,state.fillOrder);state.generatedAt=new Date().toISOString();activeCell=null;selectionAnchor=null;renderPlate();updateNote();persist();notify(`Assigned ${Object.keys(state.assignments).length} wells across ${combos.length} conditions.`)}catch(e){notify(e.message,true)}
}
function syncFactors(){state.factors.forEach(f=>{const name=$('pl-factors').querySelector(`[data-fname="${f.id}"]`),values=$('pl-factors').querySelector(`[data-fvalues="${f.id}"]`);if(name)f.name=name.value;if(values)f.values=values.value});}
function fileDownload(text,name,type='text/plain'){const blob=new Blob([text],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000)}
function downloadTSV(){const safe=(state.name||'plate').replace(/[^\w-]+/g,'_').slice(0,50);fileDownload(plateTable().map(row=>row.map(x=>String(x).replace(/\n/g,' / ')).join('\t')).join('\n'),safe+'-plate.tsv','text/tab-separated-values')}
async function copyNote(){const title=`<p style="font-family:Arial,sans-serif"><b>${esc(state.name)}</b> · ${esc(state.format)}-well plate</p>`;
 const extra=state.notes.trim()?`<p style="font-family:Arial,sans-serif">${esc(state.notes)}</p>`:'';
 return copyRich(title+extra+factorLegendHTML('plate')+plateHTML(),makeNote(),'Plate note copied, including factor colors and axis notes.');}
function transposeCurrent(){
 try{const [rows,cols]=dimensions(),result=transposeMap(state.assignments,state.selection,rows,cols);state.assignments=result.assignments;state.selection=result.selection;activeCell=null;renderPlate();updateNote();persist();notify(`Transposed ${result.oldSize.join(' × ')} → ${result.newSize.join(' × ')}. Row and column notes stay with their physical plate axes.`)}catch(e){notify(e.message,true)}
}
function save(){syncMeta();syncFactors();const item=structuredClone(state);item.id='plate-'+Date.now()+'-'+Math.random().toString(36).slice(2,6);item.savedAt=new Date().toISOString();saved.unshift(item);state.id=item.id;persist();renderSaved();$('pl-saved').value=item.id;notify('Layout saved. Older saved layouts are kept unchanged.')}
function bind(){const grid=$('pl-grid');grid.addEventListener('pointerdown',e=>{if(e.pointerType==='touch')return;beginDrag(e)});document.addEventListener('pointermove',e=>{if(drag)moveDrag(e)});document.addEventListener('pointerup',()=>{if(drag)finishDrag()});grid.addEventListener('click',e=>{const w=e.target.closest('[data-well]');if(!w)return;if(suppressClick){suppressClick=false;return}activeCell=w.dataset.well;renderPlate()});grid.addEventListener('dblclick',e=>{const w=e.target.closest('[data-well]');if(!w)return;activeCell=w.dataset.well;renderPlate();$('pl-edit-0').focus();$('pl-well-panel').scrollIntoView({block:'nearest',behavior:'smooth'})});
 // Keyboard support: arrow navigation is native via tab, Enter opens the inline editor.
 grid.addEventListener('keydown',e=>{if(e.key!=='Enter')return;const w=e.target.closest('[data-well]');if(w){activeCell=w.dataset.well;renderPlate();$('pl-edit-0').focus()}});
 $('pl-grid').addEventListener('input',e=>{const t=e.target;if(t.matches('[data-row-note]'))state.rowNotes[t.dataset.rowNote]=t.value;else if(t.matches('[data-column-note]'))state.colNotes[t.dataset.columnNote]=t.value;else return;persist();updateNote()});
 $('pl-format').addEventListener('change',e=>{const selected=state.selection.length||Object.keys(state.assignments).length;if(selected&&!confirm('Changing plate format clears selection and current labels. Continue?')){e.target.value=state.format;return}state.format=e.target.value;state.selection=[];state.assignments={};state.rowNotes={};state.colNotes={};activeCell=null;selectionAnchor=null;renderCombinations();renderPlate();updateNote();persist()});
 $('pl-fill-order').addEventListener('change',e=>{state.fillOrder=e.target.value==='columns'?'columns':'rows';persist();notify('Fill preference saved. Click Generate to apply it; current labels are unchanged.')});$('pl-transpose').addEventListener('click',transposeCurrent);$('pl-mode').addEventListener('change',syncMeta);$('pl-title').addEventListener('input',syncMeta);$('pl-notes').addEventListener('input',syncMeta);
 $('pl-all').addEventListener('click',()=>{state.selection=[];renderPlate();persist();notify('Entire plate available for layout.')});$('pl-clear').addEventListener('click',()=>{if(Object.keys(state.assignments).length&&!confirm('Clear all well labels from the current plate? Saved layouts remain available.'))return;state.assignments={};activeCell=null;renderPlate();updateNote();persist();notify('All well labels cleared. Selected well areas are unchanged.')});
 $('pl-factors').addEventListener('input',e=>{if(!e.target.matches('[data-fname],[data-fvalues]'))return;syncFactors();renderCombinations();renderFactorLegend();persist()});
 $('pl-factors').addEventListener('click',e=>{const b=e.target.closest('[data-movefactor]');if(!b)return;syncFactors();const i=state.factors.findIndex(f=>f.id===b.dataset.movefactor),j=i+Number(b.dataset.direction);if(j<0||j>=state.factors.length)return;[state.factors[i],state.factors[j]]=[state.factors[j],state.factors[i]];renderFactors();renderCombinations();renderFactorLegend();persist()});
 $('pl-preview').addEventListener('click',()=>{syncFactors();renderCombinations();persist()});
 $('pl-batch-apply').addEventListener('click',applyBatchReplicates);$('pl-batch-scope').addEventListener('change',e=>{$('pl-batch-factor-wrap').classList.toggle('hidden',e.target.value!=='factor')});
 $('pl-combos').addEventListener('change',e=>{if(e.target.id==='pl-check-all'){const keys=desired().map(c=>c.key);checkedCombinations=e.target.checked?new Set(keys):new Set();renderCombinations();return}if(e.target.matches('[data-select-combo]')){if(e.target.checked)checkedCombinations.add(e.target.dataset.selectCombo);else checkedCombinations.delete(e.target.dataset.selectCombo);const all=$('pl-check-all');if(all)all.checked=checkedCombinations.size===desired().length;}});
 $('pl-combos').addEventListener('input',e=>{const el=e.target;if(!el.matches('[data-reps]'))return;const n=Number(el.value);state.counts[el.dataset.reps]=Number.isInteger(n)&&n>0?n:1;persist();const combos=desired();notify(`${combos.reduce((a,c)=>a+c.replicates,0)} wells requested · ${available().length} available`)});
 $('pl-copy-table').addEventListener('click',copyPlateTable);$('pl-copy-conditions').addEventListener('click',copyConditionsTable);
 $('pl-generate').addEventListener('click',generate);$('pl-save-label').addEventListener('click',()=>{if(activeCell)updateEditorFields();persist()});$('pl-remove-label').addEventListener('click',()=>{if(activeCell){delete state.assignments[activeCell];renderPlate();updateNote();persist()}});
 $('pl-save').addEventListener('click',save);$('pl-copy').addEventListener('click',copyNote);$('pl-tsv').addEventListener('click',downloadTSV);
 $('pl-new').addEventListener('click',()=>{if(!confirm('Start a new blank plate layout? Your saved layouts remain available.'))return;state=defaults();checkedCombinations.clear();activeCell=null;selectionAnchor=null;persist();refreshAll()});
 $('pl-load').addEventListener('click',()=>{const src=saved.find(x=>x.id===$('pl-saved').value);if(!src)return notify('Choose a saved layout.',true);state=normalize(structuredClone(src));checkedCombinations.clear();activeCell=null;selectionAnchor=null;persist();refreshAll();notify('Saved plate layout loaded. You can edit and save it as another version.')});
 $('pl-delete').addEventListener('click',()=>{const id=$('pl-saved').value;if(!id)return notify('Choose a saved layout.',true);if(!confirm('Permanently delete this saved layout?'))return;saved=saved.filter(x=>x.id!==id);persist();renderSaved();notify('Saved layout deleted. Current working map is unchanged.')});
 $('pl-export').addEventListener('click',()=>{syncMeta();syncFactors();fileDownload(JSON.stringify({version:1,draft:state,saved,exportedAt:new Date().toISOString()},null,2),'LabChem-plates-backup.json','application/json')});
 $('pl-import').addEventListener('change',async e=>{const file=e.target.files?.[0];if(!file)return;try{const data=JSON.parse(await file.text());if(data.version!==1||!Array.isArray(data.saved)||!data.draft)throw Error('Unsupported layout backup.');if(!confirm('Replace the current plate draft and all saved plate layouts with the selected backup? Dosing records will not change.'))return;state=normalize(data.draft);saved=data.saved.map(normalize);checkedCombinations.clear();activeCell=null;selectionAnchor=null;persist();refreshAll();notify('Plate layouts restored successfully.')}catch(err){notify('Import failed: '+err.message,true)}finally{e.target.value=''}});
}
function init(){if(!$('pl-grid'))return;bootStored();bind();refreshAll()}
window.PlateLayoutCore={SHAPES,place,moveBlock,transposeMap,combinations,splitValues,cellName,applySelection,selectionRect,plateHTML,plateTable,conditionHTML,conditionTable,labelsHTML,legendEntries,factorLegendHTML,factorLegendPlain};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();