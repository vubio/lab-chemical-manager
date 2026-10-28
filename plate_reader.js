(function plateReaderModule(){
'use strict';
const $=id=>document.getElementById(id);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const shapes={6:[2,3],12:[3,4],24:[4,6],48:[6,8],96:[8,12],384:[16,24]};
const well=(r,c)=>String.fromCharCode(65+r)+(c+1);
let matched=null,view=null,matchingMode='standard';
const formats={long:'Long · jamovi / Python',long_well:'Long + well position',prism:'Prism grouped',wide:'Wide · conditions × replicates',matrix:'Plate matrix · raw values'};
function parseDelimited(text){
 const raw=String(text||'').replace(/\r\n?/g,'\n').replace(/^\uFEFF/,'').replace(/\n+$/,'');
 if(!raw.trim())throw Error('Paste the copied plate-reader cells first.');
 const delim=raw.includes('\t')?'\t':raw.includes(';')&&!raw.includes(',')?';':',';
 let rows=[],row=[],cell='',quotes=false;
 for(let i=0;i<raw.length;i++){const c=raw[i];
  if(c==='"'){if(quotes&&raw[i+1]==='"'){cell+='"';i++}else quotes=!quotes}
  else if(!quotes&&c===delim){row.push(cell);cell=''}
  else if(!quotes&&c==='\n'){row.push(cell);rows.push(row);row=[];cell=''}
  else cell+=c;
 }
 if(quotes)throw Error('Unclosed quotation mark in CSV.');
 row.push(cell);rows.push(row);
 if(rows.length===1&&rows[0].length===1&&/\s/.test(rows[0][0]))rows=[rows[0][0].trim().split(/\s+/)];
 return rows.map(r=>r.map(v=>v.trim()));
}
function normalizeGrid(raw,rows,cols,order='rows'){
 let data=raw.map(r=>r.slice()),rowCount=order==='columns'?cols:rows,colCount=order==='columns'?rows:cols;
 const numericHead=a=>a.length===colCount&&a.every((v,i)=>String(v)===String(i+1));
 if(data.length===rowCount+1&&(numericHead(data[0].slice(1))||numericHead(data[0])))data.shift();
 if(data.length===rowCount&&data.every((r,i)=>r.length===colCount+1&&r[0].toUpperCase()===String.fromCharCode(65+i)))data=data.map(r=>r.slice(1));
 if(data.length===rowCount+1&&numericHead(data[0]))data.shift();
 const flattened=data.length===1&&data[0].length===rows*cols?data[0]:data.length===rows*cols&&data.every(r=>r.length===1)?data.map(r=>r[0]):null;
 if(flattened)data=Array.from({length:rowCount},(_,r)=>flattened.slice(r*colCount,(r+1)*colCount));
 if(data.length!==rowCount||data.some(r=>r.length!==colCount))throw Error(`Expected ${rowCount} × ${colCount} cells. Found ${data.length} row(s). Check the copied range and input orientation.`);
 const plate={};let filled=0,empty=0;
 for(let r=0;r<rowCount;r++)for(let c=0;c<colCount;c++){
  const pos=order==='columns'?well(c,r):well(r,c),txt=data[r][c];
  if(txt===''){plate[pos]=null;empty++;continue}
  const n=Number(/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(txt)?txt.replace(/,/g,''):txt);
  if(!Number.isFinite(n))throw Error(`Non-numeric reading in ${pos}: ${txt}`);
  plate[pos]=n;filled++;
 }
 return {plate,filled,empty,rows,cols};
}
function matchFactorNames(state,assignments){
 const entries=Object.values(assignments||{}).filter(r=>r&&r.kind!=='special');
 const current=(state.factors||[]).filter(f=>f.name?.trim()&&f.values?.trim()).map(f=>f.name.trim());
 const manual=[false,false,false];
 for(const record of entries)for(let i=0;i<3;i++)if(String(record.manualLevels?.[i]??'').trim())manual[i]=true;
 const generated=entries.some(r=>r.group!=='manual');
 let count=generated?current.length:manual.some(Boolean)?0:current.length;
 for(let i=0;i<3;i++)if(manual[i])count=Math.max(count,i+1);
 return Array.from({length:count},(_,i)=>manual[i]?String(state.manualLevelNames?.[i]||'').trim()||'Level '+(i+1):current[i]||'Level '+(i+1));
}
function matchedRecordLabels(record,count){
 const labels=Array.isArray(record.labels)?[...record.labels]:[];
 if(record.kind!=='special')for(let i=0;i<3;i++){
  const typed=String(record.manualLevels?.[i]??'').trim();
  if(typed)labels[i]=typed;
 }
 return Array.from({length:count},(_,i)=>labels[i]??'');
}
function matchReadings(state,input){
 if(state.factorDraftStale)throw Error('Apply the current experimental factors to the plate before matching.');
 const assignments=state.assignments||{};
 if(!Object.keys(assignments).length)throw Error('Generate or load labeled wells before matching reader values.');
 const factors=matchFactorNames(state,assignments);
 const [rows,cols]=shapes[state.format],data=[],controls=[],missing=[],unassigned=[],groups={},specialGroups={};
 for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
  const pos=well(r,c),item=assignments[pos],reading=input.plate[pos];
  if(!item){if(reading!==null)unassigned.push(pos);continue}
  if(reading===null){missing.push(pos);continue}
  const isSpecial=item.kind==='special'||(item.group==='manual'&&!item.kind);
  if(isSpecial){
   const label=String(item.controlName||item.labels?.[0]||'Special control').trim();
   specialGroups[label]=(specialGroups[label]||0)+1;
   controls.push({well:pos,label,replicate:'R'+specialGroups[label],reading});
  }else{
   const labels=matchedRecordLabels(item,factors.length);
   const key=JSON.stringify(labels);groups[key]=(groups[key]||0)+1;
   data.push({well:pos,labels,replicate:'R'+groups[key],reading});
  }
 }
 return {data,controls,missing,unassigned,factors,plate:input.plate,rows,cols,format:state.format,stateName:state.name};
}

/* Manual-only matching deliberately ignores generated factor labels.
   Match by physical well coordinates. Special controls are included separately. */
function matchManualReadings(state,input){
 const assignments=state.assignments||{},shape=shapes[state.format];
 if(!shape)throw Error('Choose a valid plate format.');
 const active=Object.entries(assignments).filter(([pos,record])=>
   record?.kind!=='special'&&Array.isArray(record?.manualLevels)&&
   record.manualLevels.some(v=>String(v??'').trim()));
 if(!active.length)throw Error('No manual Level 1–3 labels found. Right-click wells and assign at least one manual level first.');
 const used=Array.from({length:3},(_,i)=>i).filter(i=>active.some(([,record])=>String(record.manualLevels[i]??'').trim()));
 const factors=used.map(i=>String(state.manualLevelNames?.[i]||'').trim()||'Level '+(i+1));
 const [rows,cols]=shape,data=[],controls=[],missing=[],unassigned=[],incomplete=[],groups={},specialGroups={};
 const manualPositions=new Set(active.map(([pos])=>pos));
 for(let r=0;r<rows;r++)for(let col=0;col<cols;col++){
  const pos=well(r,col),record=assignments[pos],reading=input.plate[pos];
  const isSpecial=record?.kind==='special';
  if(!isSpecial&&!manualPositions.has(pos)){if(reading!==null)unassigned.push(pos);continue}
  const labels=isSpecial?[]:used.map(i=>String(record.manualLevels?.[i]??'').trim());
  if(!isSpecial&&labels.some(v=>!v))incomplete.push(pos);
  if(reading===null){missing.push(pos);continue}
  if(isSpecial){
   const label=String(record.controlName||record.labels?.[0]||'Special control').trim();
   specialGroups[label]=(specialGroups[label]||0)+1;
   controls.push({well:pos,label,replicate:'R'+specialGroups[label],reading});
  }else{
   const key=JSON.stringify(labels);groups[key]=(groups[key]||0)+1;
   data.push({well:pos,labels,replicate:'R'+groups[key],reading});
  }
 }
 return {data,controls,missing,unassigned,incomplete,factors,usedLevels:used,
   plate:input.plate,rows,cols,format:state.format,stateName:state.name,matchingMode:'manual'};
}

function controlTable(m){
 return {headers:['Well','Control label','Replicate','Read value'],rows:(m.controls||[]).map(x=>[x.well,x.label,x.replicate,x.reading]),description:'Special control wells, separate from experimental factors'};
}
function outputTable(m,kind,options={}){
 const d=m.data,f=m.factors,controls=m.controls||[],placement=options.controlPlacement||'separate';
 if(kind==='long'||kind==='long_well'){
  const withWell=kind==='long_well',include=controls.length&&(['top','bottom'].includes(placement));
  const headers=[...f,'Replicate','Read value',...(withWell?['Well']:[]),...(include?['Special control']:[])];
  const normalRows=d.map(x=>[...x.labels,x.replicate,x.reading,...(withWell?[x.well]:[]),...(include?['']:[])]);
  const extras=include?controls.map(x=>[...f.map(()=>''),x.replicate,x.reading,...(withWell?[x.well]:[]),x.label]):[];
  return {headers,rows:placement==='top'?[...extras,...normalRows]:[...normalRows,...extras],description:'One measurement per row'+(include?' (special controls '+placement+')':'')};
 }
 if(kind==='matrix')return {headers:['Row / column',...Array.from({length:m.cols},(_,i)=>String(i+1))],rows:Array.from({length:m.rows},(_,r)=>[String.fromCharCode(65+r),...Array.from({length:m.cols},(_,c)=>m.plate[well(r,c)]??'')]),description:'Complete plate grid, including unlabeled and control wells'};
 if(kind==='wide'){
  const groups=[...new Set(d.map(x=>JSON.stringify(x.labels)))].map(x=>JSON.parse(x));
  const lookup=new Map(d.map(x=>[JSON.stringify(x.labels)+'#'+x.replicate,x.reading]));
  const max=Math.max(0,...d.map(x=>Number(x.replicate.slice(1))));
  return {headers:['Replicate',...groups.map(x=>x.join(' | '))],rows:Array.from({length:max},(_,i)=>['R'+(i+1),...groups.map(x=>lookup.get(JSON.stringify(x)+'#R'+(i+1))??'')]),description:'Condition columns, replicate rows'};
 }
 if(kind==='prism'){
  if(f.length!==2)throw Error('Prism grouped format requires exactly two factors. Choose Long or Wide for this plate.');
  const primary=[...new Set(d.map(x=>x.labels[0]))],secondary=[...new Set(d.map(x=>x.labels[1]))];
  const counts=primary.map(p=>Math.max(0,...d.filter(x=>x.labels[0]===p).map(x=>Number(x.replicate.slice(1)))));
  const lookup=new Map(d.map(x=>[JSON.stringify(x.labels)+'#'+x.replicate,x.reading]));
  return {headers:[f[1],...primary.flatMap((p,i)=>Array.from({length:counts[i]},(_,j)=>`${p} · R${j+1}`))],rows:secondary.map(s=>[s,...primary.flatMap((p,i)=>Array.from({length:counts[i]},(_,j)=>lookup.get(JSON.stringify([p,s])+'#R'+(j+1))??''))]),description:`Prism grouped: ${f[1]} rows; ${f[0]} columns`};
 }
 throw Error('Choose a valid output format.');
}
function csvCell(v){
 if(typeof v==='number')return String(v);
 let s=String(v??'');if(/^[=+@-]/.test(s)&&!/^[-+]?\d+(\.\d+)?$/.test(s))s="'"+s;
 return /[",\n\r]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;
}
function makeCSV(t){return [t.headers,...t.rows].map(r=>r.map(csvCell).join(',')).join('\r\n')+'\r\n';}
function xesc(s){return String(s??'').replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));}
function zipFiles(entries){
 const enc=s=>new TextEncoder().encode(s),u16=n=>[n&255,n>>>8&255],u32=n=>[n&255,n>>>8&255,n>>>16&255,n>>>24&255];
 const lut=new Uint32Array(256);for(let i=0;i<256;i++){let c=i;for(let j=0;j<8;j++)c=c&1?0xedb88320^(c>>>1):c>>>1;lut[i]=c>>>0}
 const crc=b=>{let c=0xffffffff;for(const v of b)c=lut[(c^v)&255]^(c>>>8);return(c^0xffffffff)>>>0};
 let local=[],central=[],offset=0;
 for(const [name,content] of entries){
  const n=enc(name),d=enc(content),size=d.length,hash=crc(d);
  const head=Uint8Array.from([...u32(0x04034b50),...u16(20),...u16(0),...u16(0),...u16(0),...u16(0),...u32(hash),...u32(size),...u32(size),...u16(n.length),...u16(0)]);
  local.push(head,n,d);
  const ch=Uint8Array.from([...u32(0x02014b50),...u16(20),...u16(20),...u16(0),...u16(0),...u16(0),...u16(0),...u32(hash),...u32(size),...u32(size),...u16(n.length),...u16(0),...u16(0),...u16(0),...u16(0),...u32(0),...u32(offset)]);
  central.push(ch,n);offset+=head.length+n.length+d.length;
 }
 const cl=central.reduce((a,v)=>a+v.length,0);
 const end=Uint8Array.from([...u32(0x06054b50),...u16(0),...u16(0),...u16(entries.length),...u16(entries.length),...u32(cl),...u32(offset),...u16(0)]);
 let out=new Uint8Array(offset+cl+end.length),at=0;for(const p of [...local,...central,end]){out.set(p,at);at+=p.length}return out;
}
function excelCol(n){let s='';while(n){s=String.fromCharCode(65+(n-1)%26)+s;n=Math.floor((n-1)/26)}return s;}
function sheetXML(t){
 const values=[t.headers,...t.rows],body=values.map((row,i)=>`<row r="${i+1}">${row.map((v,j)=>{const address=excelCol(j+1)+(i+1),style=i===0?' s="1"':'';return typeof v==='number'&&Number.isFinite(v)?`<c r="${address}"${style}><v>${v}</v></c>`:`<c r="${address}"${style} t="inlineStr"><is><t xml:space="preserve">${xesc(v)}</t></is></c>`}).join('')}</row>`).join('');
 return `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>${body}</sheetData></worksheet>`;
}
function makeXlsx(sheets){
 const names=sheets.map((s,i)=>({name:s.name.slice(0,31),path:`xl/worksheets/sheet${i+1}.xml`}));
 const content=`<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${names.map((s,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`;
 const rels=`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
 const book=`<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((s,i)=>`<sheet name="${xesc(s.name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets></workbook>`;
 const wrels=`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((s,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}<Relationship Id="rId${names.length+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
 const styles=`<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Arial"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF25485F"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFill="1" applyFont="1"/></cellXfs></styleSheet>`;
 return zipFiles([['[Content_Types].xml',content],['_rels/.rels',rels],['xl/workbook.xml',book],['xl/_rels/workbook.xml.rels',wrels],['xl/styles.xml',styles],...sheets.map((s,i)=>[names[i].path,sheetXML(s.table)])]);
}
function download(content,name,type){const b=new Blob([content],{type}),url=URL.createObjectURL(b),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);}
const format=()=>$('pr-format').value;
const name=()=>String(matched.stateName||'plate').replace(/[^a-z0-9_-]+/gi,'_').slice(0,55)+'_'+matched.format+'well_'+(matched.matchingMode==='manual'?'manual_':'')+format();
function tablePreview(t){
 return `<div class="pr-table-wrap"><table class="pr-table"><thead><tr>${t.headers.map(x=>`<th>${esc(x)}</th>`).join('')}</tr></thead><tbody>${t.rows.slice(0,70).map(r=>`<tr>${r.map(x=>`<td>${esc(x)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function controlPlacement(){return $('pr-control-placement').value}
function separateControls(){return matched&&matched.controls?.length&&controlPlacement()!=='omit'&&(!['long','long_well'].includes(format())||!['top','bottom'].includes(controlPlacement()))}
function render(){
 if(!matched)return;
 try{
  view=outputTable(matched,format(),{controlPlacement:controlPlacement()});
  $('pr-error').textContent='';$('pr-export').hidden=false;
  let html=`<p class="pr-mini">${esc(view.description)} · ${view.rows.length} rows${view.rows.length>70?' (first 70 shown)':''}</p>`+tablePreview(view);
  if(separateControls()){
   const ct=controlTable(matched);
   html+=`<h3 class="pr-control-title">Special controls (${ct.rows.length})</h3><p class="pr-mini">These measurements are excluded from normal factor analysis. Download them separately, or use Excel to save both tables.</p>`+tablePreview(ct);
  }
  $('pr-preview').innerHTML=html;
  $('pr-controls-csv').hidden=!matched.controls?.length||controlPlacement()==='omit';
 }catch(e){view=null;$('pr-export').hidden=true;$('pr-error').textContent=e.message;}
}

function match(){
 const state=window.PlateLayoutCore.getSnapshot(),shape=shapes[state.format];
 try{
  const parsed=normalizeGrid(parseDelimited($('pr-paste').value),shape[0],shape[1],$('pr-order').value);
  matched=matchingMode==='manual'?matchManualReadings(state,parsed):matchReadings(state,parsed);
  $('pr-summary').textContent=(matchingMode==='manual'?'Manual levels · ':'')+`${matched.data.length} experimental readings · ${matched.controls.length} special controls · ${matched.missing.length} labeled wells missing readings · ${matched.unassigned.length} readings outside ${matchingMode==='manual'?'manual labels':'assigned wells'}.`;
  $('pr-warning').textContent=(matched.missing.length?'Missing labeled wells: '+matched.missing.slice(0,22).join(', ')+'. ':'')+
 (matched.incomplete?.length?'Incomplete manual level assignments at '+matched.incomplete.slice(0,16).join(', ')+'. Missing levels appear as blank factors; review before statistics. ':'')+
 (matched.unassigned.length?matched.unassigned.length+(matchingMode==='manual'?' readings outside manually labeled wells':' readings from unlabeled wells')+' excluded from analysis (retained in the plate-matrix export).':'');
  render();
 }catch(e){matched=null;view=null;$('pr-export').hidden=true;$('pr-preview').innerHTML='';$('pr-summary').textContent='';$('pr-warning').textContent='';$('pr-error').textContent=e.message;}
}
function excel(){
 if(!view||!matched)return;
 const sheets=[{name:'Selected format',table:view}];
 if(format()!=='long')sheets.push({name:'Long data',table:outputTable(matched,'long',{controlPlacement:controlPlacement()})});
 if(matched.controls.length&&controlPlacement()!=='omit')sheets.push({name:'Special controls',table:controlTable(matched)});
 if(format()!=='matrix')sheets.push({name:'Plate readings',table:outputTable(matched,'matrix')});
 sheets.push({name:'Metadata',table:{headers:['Field','Value'],rows:[['Experiment',matched.stateName],['Plate format',matched.format+' wells'],['Exported at',new Date().toLocaleString()],['Experimental readings',matched.data.length],['Special-control readings',matched.controls.length],['Special control handling',controlPlacement()],['Missing labeled well values',matched.missing.length],['Readings in unlabeled wells',matched.unassigned.length],['Factors',matched.factors.join(' / ')],['Matching mode',matched.matchingMode==='manual'?'Manual levels only':'Existing plate labels']]}});
 download(makeXlsx(sheets),name()+'.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}

async function copy(){
 if(!view)return;
 const makeRich=t=>'<table style="border-collapse:collapse;font:11pt Arial,sans-serif"><tr>'+t.headers.map(x=>`<th style="background:#eaf0f3;border:1px solid #9badb9;padding:7px">${esc(x)}</th>`).join('')+'</tr>'+t.rows.map(r=>'<tr>'+r.map(x=>`<td style="border:1px solid #cad4dc;padding:6px 8px">${esc(x)}</td>`).join('')+'</tr>').join('')+'</table>';
 const extras=separateControls()?controlTable(matched):null;
 const rich=makeRich(view)+(extras?'<p><b>Special controls</b></p>'+makeRich(extras):'');
 const plain=makeCSV(view)+(extras?'\r\nSpecial controls\r\n'+makeCSV(extras):'');
 try{if(navigator.clipboard?.write&&typeof ClipboardItem!=='undefined')await navigator.clipboard.write([new ClipboardItem({'text/html':new Blob([rich],{type:'text/html'}),'text/plain':new Blob([plain],{type:'text/plain'})})]);else await navigator.clipboard.writeText(plain);$('pr-summary').textContent+=' Table copied.';}catch(e){$('pr-error').textContent='Clipboard permission denied; download CSV or Excel instead.';}
}

function init(){
 const actions=document.querySelector('#page-plate .plate-grid-actions');if(!actions||!window.PlateLayoutCore)return;
 const btn=document.createElement('button');btn.type='button';btn.className='btn';btn.id='pr-open';btn.textContent='Match reader values';actions.appendChild(btn);
 const manualBtn=document.createElement('button');manualBtn.type='button';manualBtn.className='btn';manualBtn.id='pr-manual-open';manualBtn.textContent='Match manual labels';manualBtn.title='Match reader data using only the manually assigned Level 1–3 values';actions.appendChild(manualBtn);
 const overlay=document.createElement('div');overlay.id='pr-dialog';overlay.className='pr-overlay';overlay.hidden=true;
 overlay.innerHTML=`<section class="pr-modal" role="dialog" aria-modal="true" aria-labelledby="pr-title"><div class="pr-modal-head"><div><h2 id="pr-title">Match plate-reader values</h2><p id="pr-intro">Paste the complete plate grid. Measurements are matched to labeled wells by their positions.</p></div><button class="btn" type="button" id="pr-close">Close ×</button></div>
 <div class="pr-inputs"><label class="field"><span>Source order</span><select id="pr-order"><option value="rows">Rows A–H (8 × 12 for a 96-well plate)</option><option value="columns">Columns 1–12 (12 × 8 for a 96-well plate)</option></select></label><label class="field"><span>Special controls</span><select id="pr-control-placement"><option value="separate">Separate table (recommended)</option><option value="bottom">Append below (long format)</option><option value="top">Append above (long format)</option><option value="omit">Exclude controls from output</option></select></label><label class="field"><span>Output format</span><select id="pr-format">${Object.entries(formats).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></label></div>
 <label class="field"><span>Paste readings copied from Excel, CSV, or your plate-reader software</span><textarea id="pr-paste" spellcheck="false" rows="7" placeholder="Paste the 8 × 12 grid (or a one-column list of all 96 values)."></textarea></label>
 <div class="pr-run"><button class="btn btn-primary" id="pr-match">Match values</button><label class="pr-file">Or open a .csv/.tsv file<input type="file" id="pr-file" accept=".csv,.tsv,.txt,text/csv"/></label></div>
 <p id="pr-summary" class="pr-summary" aria-live="polite"></p><p id="pr-warning" class="pr-warning"></p><p id="pr-error" class="pr-error" role="alert"></p><div id="pr-preview"></div>
 <div class="pr-export" id="pr-export" hidden><button class="btn" id="pr-copy">Copy table</button><button class="btn" id="pr-csv">Download CSV</button><button class="btn" id="pr-controls-csv" hidden>Download controls CSV</button><button class="btn btn-primary" id="pr-xlsx">Download Excel (.xlsx)</button></div>
 </section>`;
 document.body.appendChild(overlay);
 const close=()=>{overlay.hidden=true;document.body.classList.remove('pr-open')};
 function openMatcher(mode){
  matchingMode=mode;
  matched=null;view=null;overlay.hidden=false;document.body.classList.add('pr-open');
  $('pr-title').textContent=mode==='manual'?'Match manual level labels':'Match plate-reader values';
  $('pr-intro').textContent=mode==='manual'
   ?'Uses only manually assigned Level 1–3 values, with the editable legend names as factor columns. Other generated labels are ignored; special controls stay separate.'
   :'Paste the complete plate grid. Measurements are matched to labeled wells by their positions.';
  $('pr-preview').innerHTML='';$('pr-export').hidden=true;$('pr-summary').textContent='';$('pr-warning').textContent='';$('pr-error').textContent='';$('pr-paste').focus();
 }
 btn.addEventListener('click',()=>openMatcher('standard'));
 manualBtn.addEventListener('click',()=>openMatcher('manual'));
 $('pr-close').addEventListener('click',close);overlay.addEventListener('mousedown',e=>{if(e.target===overlay)close()});document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!overlay.hidden)close()});
 $('pr-match').addEventListener('click',match);$('pr-format').addEventListener('change',render);$('pr-control-placement').addEventListener('change',render);
 $('pr-paste').addEventListener('input',()=>{matched=null;view=null;$('pr-export').hidden=true;$('pr-preview').innerHTML='';$('pr-summary').textContent=''});
 $('pr-order').addEventListener('change',()=>{matched=null;view=null;$('pr-export').hidden=true;$('pr-preview').innerHTML='';$('pr-summary').textContent=''});
 $('pr-file').addEventListener('change',async e=>{const file=e.target.files?.[0];if(file){$('pr-paste').value=await file.text();match()}e.target.value=''});
 $('pr-copy').addEventListener('click',copy);
 $('pr-csv').addEventListener('click',()=>{if(view)download(makeCSV(view),name()+'.csv','text/csv;charset=utf-8')});
 $('pr-controls-csv').addEventListener('click',()=>{if(matched?.controls?.length)download(makeCSV(controlTable(matched)),name()+'_special_controls.csv','text/csv;charset=utf-8')});
 $('pr-xlsx').addEventListener('click',excel);
}
window.PlateReadoutCore={parseDelimited,normalizeGrid,matchFactorNames,matchedRecordLabels,matchReadings,matchManualReadings,outputTable,controlTable,makeCSV,makeXlsx};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();