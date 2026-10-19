/* Lab Chemical Manager · local-first browser application · MIT licensed */
'use strict';

const STORE_KEY='labchem.records.v1';
const CALC_MODES={
 'powder-molar':'Powder to molar stock',
 'powder-wv':'Powder to % w/v or mass/volume stock',
 'direct-molar':'Direct molar preparation',
 'direct-wv':'Direct % w/v or mass/volume preparation',
 'stock-dilute':'Stock-to-working dilution',
 'factor-dilute':'X-fold dilution',
 'lyo':'Lyophilized reconstitution',
 'vv':'Liquid % v/v preparation'
};
const CONC_UNITS=['M','mM','µM','nM','mg/mL','µg/mL','ng/mL','pg/mL','µg/µL','g/L','mg/L','% w/v','% v/v','U/mL','IU/mL','X'];
const MOLAR_UNITS=['M','mM','µM','nM'];
const MASS_CONC_UNITS=['mg/mL','µg/mL','ng/mL','pg/mL','µg/µL','g/L','mg/L','% w/v'];
const WEIGHT_UNITS=['g','mg','µg'];
const VOL_UNITS=['µL','mL','L'];
const DEFAULT_DB=()=>({version:1,chemicals:[],history:[],templates:[]});
let db=loadDB();
let latestPrep=null,latestDose=null,currentPage='home';
let timer;

function byId(id){return document.getElementById(id)}
function uid(){return (globalThis.crypto&&crypto.randomUUID)?crypto.randomUUID():('r'+Date.now().toString(36)+Math.random().toString(36).slice(2))}
function escapeHTML(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function clean(s){return String(s??'').trim()}
function fmt(n,digits=6){if(!Number.isFinite(n))return '—';if(n===0)return '0';if(Math.abs(n)>=1e7||Math.abs(n)<0.0001)return n.toExponential(4);return Number(n.toPrecision(digits)).toLocaleString('en-US',{maximumFractionDigits:9})}
function numeric(value,label,allowZero=false){const n=Number(value);if(clean(value)===''||!Number.isFinite(n)||(allowZero?n<0:n<=0))throw Error(label+' must be '+(allowZero?'nonnegative':'greater than zero')+'.');return n}
function dt(date){return new Date(date).toLocaleString(undefined,{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false})}
function isoNow(){return new Date().toISOString()}
function today(){return new Date().toISOString().slice(0,10)}
function num(id,label,allowZero=false){return numeric(byId(id).value,label,allowZero)}
function val(id){return clean(byId(id).value)}
function setVal(id,v){if(byId(id))byId(id).value=(v===undefined||v===null?'':v)}
function loadDB(){try{const parsed=JSON.parse(localStorage.getItem(STORE_KEY));if(parsed&&Array.isArray(parsed.chemicals)&&Array.isArray(parsed.history)&&Array.isArray(parsed.templates))return {...DEFAULT_DB(),...parsed}}catch(e){console.warn('Could not load saved data',e)}return DEFAULT_DB()}
function store(){try{localStorage.setItem(STORE_KEY,JSON.stringify(db))}catch(e){toast('Unable to save: browser storage may be full or restricted.',true);throw e}updateCounts()}
function toast(msg,error=false){const el=byId('toast');el.textContent=msg;el.style.background=error?'#a34038':'#1c3441';el.classList.add('show');clearTimeout(timer);timer=setTimeout(()=>el.classList.remove('show'),3700)}
function errorMessage(id,msg){byId(id).innerHTML=`<div class="small-note warning">${escapeHTML(msg)}</div>`}
function options(items,selected){return items.map(v=>`<option value="${escapeHTML(v)}" ${selected===v?'selected':''}>${escapeHTML(v)}</option>`).join('')}
function inputField(label,id,value='',type='number',extra=''){return `<label class="field"><span>${label}</span><input id="${id}" type="${type}" value="${escapeHTML(value)}" ${type==='number'?'step="any"':''} ${extra}/></label>`}
function unitField(label,id,items,selected){return `<label class="field"><span>${label}</span><select id="${id}">${options(items,selected||items[0])}</select></label>`}
function fullField(label,id,value='',placeholder=''){return `<label class="field full"><span>${label}</span><input id="${id}" value="${escapeHTML(value)}" placeholder="${escapeHTML(placeholder)}"/></label>`}
function fields(contents){return `<div class="form-grid">${contents}</div>`}
function unitType(u){if(MOLAR_UNITS.includes(u))return 'molar';if(MASS_CONC_UNITS.includes(u))return 'mass';if(u==='X')return 'factor';if(u==='% v/v')return 'vv';if(['U/mL','IU/mL'].includes(u))return 'activity';throw Error('Unsupported concentration unit: '+u)}
function toMolar(n,u){return n*({M:1,mM:1e-3,'µM':1e-6,nM:1e-9}[u])}
function toMgML(n,u){return n*({'mg/mL':1,'µg/mL':.001,'ng/mL':.000001,'pg/mL':.000000001,'µg/µL':1,'g/L':1,'mg/L':.001,'% w/v':10}[u])}
function convertConc(n,from,to,mw){const a=unitType(from),b=unitType(to);if(a==='factor'||b==='factor'){if(a!==b)throw Error('X-fold labeling cannot be converted to molarity or mass concentration without composition data.');return n}if(a==='activity'||b==='activity'){if(from!==to)throw Error('Enzymatic/activity units (U/mL, IU/mL) are not interchangeable or convertible to other concentration types without reagent-specific information.');return n}if(a==='vv'||b==='vv'){if(a!==b)throw Error('% v/v cannot be converted to a molar or mass concentration directly.');return n}if(a==='molar'&&b==='molar')return toMolar(n,from)/toMolar(1,to);if(a==='mass'&&b==='mass')return toMgML(n,from)/toMgML(1,to);if(!mw||mw<=0)throw Error('A positive molecular weight (g/mol) is needed to convert between molar and mass/volume units.');const inMgML=a==='molar'?toMolar(n,from)*mw:toMgML(n,from);return b==='molar' ? (inMgML/mw)/toMolar(1,to) : inMgML/toMgML(1,to)}
function toML(v,u){return v*({'µL':.001,mL:1,L:1000}[u])}
function massMg(v,u){return v*({g:1000,mg:1,'µg':.001}[u])}
function fmtVolML(ml){if(ml>=1000)return `${fmt(ml/1000)} L`;if(ml>=1)return `${fmt(ml)} mL`;return `${fmt(ml*1000)} µL`}
function fmtMassMG(mg){if(mg>=1000)return `${fmt(mg/1000)} g`;if(mg>=1)return `${fmt(mg)} mg`;return `${fmt(mg*1000)} µg`}
function getChem(id){return db.chemicals.find(x=>x.id===id)}
function autoHistory(rec){const entry={id:uid(),timestamp:isoNow(),...rec};db.history.unshift(entry);store();return entry}
function updateCounts(){byId('stat-chem').textContent=db.chemicals.length;byId('stat-history').textContent=db.history.length;byId('stat-templates').textContent=db.templates.length}
function showPage(page){currentPage=page;document.querySelectorAll('.page').forEach(el=>el.classList.toggle('active',el.id==='page-'+page));document.querySelectorAll('.nav-link').forEach(el=>el.classList.toggle('active',el.dataset.page===page));const names={home:'Overview',calculator:'Preparation calculator',dosing:'Dosing planner',library:'Chemical library',history:'Calculation history',templates:'Saved templates'};byId('page-label').textContent=names[page]||page;if(page==='library')renderLibrary();if(page==='history')renderHistory();if(page==='templates')renderTemplates();window.scrollTo({top:0,behavior:'instant'})}
function renderChemicalOptions(){const rows=db.chemicals.slice().sort((a,b)=>a.name.localeCompare(b.name));const o=rows.map(r=>`<option value="${escapeHTML(r.id)}">${escapeHTML(r.name)}${r.lot?' · lot '+escapeHTML(r.lot):''}${r.stock?' · '+fmt(r.stock)+' '+escapeHTML(r.stockUnit):''}</option>`).join('');['calc-chemical','dose-chemical'].forEach(id=>{const el=byId(id),keep=el.value;el.innerHTML=`<option value="">${id==='calc-chemical'?'Enter new chemical details':'Manual stock entry'}</option>${o}`;el.value=rows.some(r=>r.id===keep)?keep:''})}

/* ---- Preparation calculator ---- */
function renderCalcMode(){const mode=val('calc-mode');let html='';
 const mw=inputField('Molecular weight (g/mol) *','f-mw','','number','min="0"');
 const solvent=fullField('Solvent / diluent','f-solvent','','e.g., DMSO, sterile water, PBS');
 const mass=inputField('Available powder mass','f-mass',5,'number','min="0"')+unitField('Mass unit','f-mass-unit',WEIGHT_UNITS,'mg');
 const targetM=inputField('Desired concentration','f-target',1,'number','min="0"')+unitField('Concentration unit','f-target-unit',MOLAR_UNITS,'mM');
 const targetW=inputField('Desired concentration','f-target',5,'number','min="0"')+unitField('Concentration unit','f-target-unit',MASS_CONC_UNITS,'% w/v');
 const volume=inputField('Desired final volume','f-volume',10,'number','min="0"')+unitField('Final volume unit','f-volume-unit',VOL_UNITS,'mL');
 if(mode==='powder-molar')html=fields(mw+mass+targetM+solvent);
 else if(mode==='powder-wv')html=fields(mass+targetW+solvent);
 else if(mode==='direct-molar')html=fields(mw+volume+targetM+solvent);
 else if(mode==='direct-wv')html=fields(volume+targetW+solvent);
 else if(mode==='stock-dilute')html=fields(inputField('Starting stock concentration','f-start',10)+unitField('Starting unit','f-start-unit',CONC_UNITS,'mM')+inputField('Desired working concentration','f-target',10)+unitField('Target unit','f-target-unit',CONC_UNITS,'µM')+volume+inputField('Molecular weight (only for unit crossing)','f-mw','')+solvent);
 else if(mode==='factor-dilute')html=fields(inputField('Starting concentrate (X)','f-start',1000)+inputField('Target strength (X)','f-target',1)+volume+solvent);
 else if(mode==='lyo')html=fields(inputField('Lyophilized mass (optional)','f-mass',1)+unitField('Mass unit','f-mass-unit',WEIGHT_UNITS,'mg')+inputField('Reconstitution volume','f-volume',1)+unitField('Volume unit','f-volume-unit',VOL_UNITS,'mL')+inputField('Molecular weight (if known)','f-mw','')+inputField('Resulting X label (optional)','f-x','')+solvent)+`<p class="small-note">If a manufacturer specifies an X-fold stock but does not disclose composition, enter the X label without assuming a molar concentration. The listed added volume is treated as the approximate final volume unless otherwise specified.</p>`;
 else if(mode==='vv')html=fields(inputField('Starting liquid strength (% v/v)','f-start',100)+inputField('Desired final concentration (% v/v)','f-target',1)+volume+solvent);
 byId('mode-fields').innerHTML=html;
 if(mode==='stock-dilute')setVal('f-target',10);
 const chosen=getChem(val('calc-chemical'));if(chosen){if(byId('f-mw'))setVal('f-mw',chosen.mw||'');if(byId('f-solvent'))setVal('f-solvent',chosen.solvent||'');if(mode==='stock-dilute'&&chosen.stock&&CONC_UNITS.includes(chosen.stockUnit)){setVal('f-start',chosen.stock);setVal('f-start-unit',chosen.stockUnit)}}
 latestPrep=null;byId('calc-result').className='empty-result';byId('calc-result').textContent='Enter the preparation details, then calculate to save a timestamped recipe.';byId('calc-actions').classList.add('hidden');byId('calc-status').textContent='READY';byId('calc-status').className='tag';
}
function prepInputSnapshot(){const obj={mode:val('calc-mode'),chemId:val('calc-chemical'),name:val('calc-name'),catalog:val('calc-catalog'),lot:val('calc-lot')};document.querySelectorAll('#mode-fields input,#mode-fields select').forEach(e=>obj[e.id]=e.value);return obj}
function computePrep(input){const g=k=>input[k],req=(k,lab,zero=false)=>numeric(g(k),lab,zero),mode=g('mode'),solvent=clean(g('f-solvent'))||'specified solvent',mw=g('f-mw')?req('f-mw','Molecular weight'):0;let result,detail=[],primary,secondary='',stockValue=null,stockUnit=null,preparedVolume='';
 if(['powder-molar','powder-wv'].includes(mode)){
  const mg=massMg(req('f-mass','Powder mass'),g('f-mass-unit'));const c=req('f-target','Desired concentration');const u=g('f-target-unit');let volML;
  if(mode==='powder-molar'){if(!mw)throw Error('Molecular weight is required for a molar calculation.');volML=(mg/1000/mw)/toMolar(c,u)*1000}
  else volML=mg/toMgML(c,u);
  primary=fmtVolML(volML)+' final volume';secondary=`Using ${fmtMassMG(mg)} powder to achieve ${fmt(c)} ${u}`;detail=[`Weigh ${fmtMassMG(mg)} of ${input.name}.`,`Add ${solvent}; dissolve, then adjust to a final solution volume of ${fmtVolML(volML)}.`,`Label stock: ${fmt(c)} ${u} in ${solvent}.`];stockValue=c;stockUnit=u;preparedVolume=fmtVolML(volML);if(volML>1000)detail.push('Check practicality: this requires more than 1 L of final solution.');
 }else if(['direct-molar','direct-wv'].includes(mode)){
  const volML=toML(req('f-volume','Target volume'),g('f-volume-unit'));const c=req('f-target','Desired concentration'),u=g('f-target-unit');let mg;
  if(mode==='direct-molar'){if(!mw)throw Error('Molecular weight is required for a molar calculation.');mg=toMolar(c,u)*(volML/1000)*mw*1000}
  else mg=toMgML(c,u)*volML;
  primary=fmtMassMG(mg)+' required';secondary=`To make ${fmtVolML(volML)} at ${fmt(c)} ${u}`;detail=[`Weigh ${fmtMassMG(mg)} of ${input.name}.`,`Dissolve in ${solvent}; bring to a final volume of ${fmtVolML(volML)}.`,`Final concentration: ${fmt(c)} ${u}.`];stockValue=c;stockUnit=u;preparedVolume=fmtVolML(volML);
 }else if(['stock-dilute','factor-dilute','vv'].includes(mode)){
  const v=toML(req('f-volume','Final volume'),g('f-volume-unit'));
  const from=req('f-start','Starting concentration'),to=req('f-target','Target concentration');
  const fromUnit=mode==='stock-dilute'?g('f-start-unit'):(mode==='factor-dilute'?'X':'% v/v');
  const toUnit=mode==='stock-dilute'?g('f-target-unit'):(mode==='factor-dilute'?'X':'% v/v');
  const c1=mode==='stock-dilute'?convertConc(from,fromUnit,toUnit,mw):from;
  if(to>c1*(1+1e-10))throw Error('Target concentration is greater than the starting stock. Dilution cannot increase concentration.');
  const v1=v*to/c1,v2=Math.max(0,v-v1);
  primary=fmtVolML(v1)+' starting stock';secondary=`Add ${fmtVolML(v2)} diluent to make ${fmtVolML(v)} final`;detail=[`Transfer ${fmtVolML(v1)} of ${fmt(from)} ${fromUnit} starting stock.`,`Add ${solvent} to a final volume of ${fmtVolML(v)} (approximately ${fmtVolML(v2)} diluent).`,`Result: ${fmt(to)} ${toUnit}.`];stockValue=to;stockUnit=toUnit;preparedVolume=fmtVolML(v);
  if(v1*1000<.5)detail.push(`⚠ Calculated direct transfer is ${fmt(v1*1000)} µL, below 0.5 µL: use an intermediate dilution.`);
 }else if(mode==='lyo'){
  const v=toML(req('f-volume','Reconstitution volume'),g('f-volume-unit'));const hasMass=clean(g('f-mass'))!=='';const hasX=clean(g('f-x'))!=='';
  if(!hasMass&&!hasX)throw Error('Enter either lyophilized mass or the manufacturer’s resulting X label.');
  const mg=hasMass?massMg(req('f-mass','Lyophilized mass'),g('f-mass-unit')):null;const cx=hasX?req('f-x','X label'):null;
  const mgml=mg===null?null:mg/v;const molar=(mg!==null&&mw)?mgml/mw:null;
  primary=`Add ${fmtVolML(v)} ${solvent}`;secondary=[mgml!==null?`${fmt(mgml)} mg/mL`:'',molar!==null?`${fmt(molar*1000)} mM`:'',cx!==null?`${fmt(cx)}X (label)`:''].filter(Boolean).join(' · ');
  detail=[`Add ${fmtVolML(v)} of ${solvent} to ${input.name} (manufacturer-recommended if applicable).`,`Mix according to supplier guidance. Approximate concentration: ${secondary}.`];if(hasMass)detail.unshift(`Vial content: ${fmtMassMG(mg)} (nominal).`);if(cx!==null){stockValue=cx;stockUnit='X'}else if(molar!==null){stockValue=molar*1000;stockUnit='mM'}else if(mgml!==null){stockValue=mgml;stockUnit='mg/mL'}preparedVolume=fmtVolML(v);
 }else throw Error('Unknown scenario.');
 return {primary,secondary,steps:detail,stockValue,stockUnit,solvent,preparedVolume,warnings:detail.filter(x=>x.startsWith('⚠')||x.startsWith('Check practicality'))};
}
function preparationNote(record){const inp=record.input,r=record.result;return `[LAB CHEMICAL PREPARATION]\nDate/time: ${dt(record.timestamp)}\nReagent: ${record.name}\nMethod: ${CALC_MODES[inp.mode]}\n${record.catalog?'Catalog: '+record.catalog+'\n':''}${record.lot?'Lot: '+record.lot+'\n':''}${inp['f-mw']?'Molecular weight: '+inp['f-mw']+' g/mol\n':''}Solvent/diluent: ${r.solvent}\nResult: ${r.primary}\n${r.secondary}\nPreparation:\n${r.steps.map((s,i)=>`${i+1}. ${s}`).join('\n')}\n${record.notes?'Notes: '+record.notes+'\n':''}`}
function calculatePreparation(){try{const input=prepInputSnapshot();input.name=input.name||getChem(input.chemId)?.name||'';if(!input.name)throw Error('Enter a chemical / reagent name.');const res=computePrep(input);latestPrep=autoHistory({kind:'preparation',mode:input.mode,name:input.name,catalog:input.catalog,lot:input.lot,chemicalId:input.chemId,input,result:res,notes:''});renderPrepResult(latestPrep);toast('Calculation completed and saved in history.')}catch(e){latestPrep=null;byId('calc-actions').classList.add('hidden');byId('calc-status').className='tag error';byId('calc-status').textContent='CHECK INPUT';errorMessage('calc-result',e.message)}}
function renderPrepResult(rec){const r=rec.result;byId('calc-result').className='';byId('calc-result').innerHTML=`<div class="result-highlight"><label>CALCULATED PREPARATION</label><strong>${escapeHTML(r.primary)}</strong><div class="result-sub">${escapeHTML(r.secondary)}</div></div><div class="result-section-title">Preparation steps</div><ol class="steps">${r.steps.map(s=>`<li>${escapeHTML(s)}</li>`).join('')}</ol><div class="small-note">Saved automatically at ${escapeHTML(dt(rec.timestamp))}. Verify solubility, stability, sterility, pH, and manufacturer instructions before preparing.</div><div class="result-section-title">Copy-ready note</div><div class="doc-preview">${escapeHTML(preparationNote(rec))}</div>`;byId('calc-actions').classList.remove('hidden');byId('calc-status').className='tag success';byId('calc-status').textContent='SAVED'}
function applyCalcChemical(){const x=getChem(val('calc-chemical'));if(!x)return;setVal('calc-name',x.name);setVal('calc-catalog',x.catalog);setVal('calc-lot',x.lot);if(byId('f-mw'))setVal('f-mw',x.mw||'');if(byId('f-solvent'))setVal('f-solvent',x.solvent||'');if(val('calc-mode')==='stock-dilute'&&x.stock&&x.stockUnit&&CONC_UNITS.includes(x.stockUnit)){setVal('f-start',x.stock);setVal('f-start-unit',x.stockUnit)}}
function stockFromPrep(){if(!latestPrep)return;const r=latestPrep.result;if(!r.stockUnit){toast('This result has no storable stock concentration.',true);return}const chem=latestPrep.chemicalId?getChem(latestPrep.chemicalId):null;if(chem){if(!confirm('Create a new stock entry for this preparation? This preserves the original bottle/stock entry.'))return}
 const entry={id:uid(),createdAt:isoNow(),updatedAt:isoNow(),name:latestPrep.name,maker:chem?.maker||'',catalog:latestPrep.catalog,lot:latestPrep.lot,cas:chem?.cas||'',mw:latestPrep.input['f-mw']||chem?.mw||'',stock:r.stockValue,stockUnit:r.stockUnit,solvent:r.solvent,storage:chem?.storage||'',prepdate:today(),expiry:'',notes:`Prepared: ${r.preparedVolume}. History record: ${latestPrep.id}`};db.chemicals.unshift(entry);store();renderChemicalOptions();toast('Prepared stock saved to Chemical library.')}

/* ---- multi-condition dosing planner ---- */
const DOSE_FIELDS=['dose-title','dose-chemical','dose-name','dose-stock','dose-stock-unit','dose-mw','dose-solvent','dose-targets','dose-target-unit','dose-wells','dose-well-volume','dose-volume-mode','dose-add','dose-minpip','dose-prep-volume','dose-overage','dose-max-prep','dose-strategy','dose-notes'];
// Per-target replicate counts remain stable when the user edits or reorders doses.
let doseWellCounts=Object.create(null);
function targetValues(raw){return String(raw||'').split(/[\s,;]+/).filter(Boolean).map(Number).filter(n=>Number.isFinite(n)&&n>=0)}
function renderDoseWellInputs(){
 const host=byId('dose-wells-list');if(!host)return;
 host.querySelectorAll('[data-dose-well]').forEach(el=>doseWellCounts[el.dataset.doseWell]=el.value);
 const unit=val('dose-target-unit')||'µM',targets=[...new Set(targetValues(val('dose-targets')))];
 host.innerHTML=targets.length?targets.map(v=>{
  const key=String(v),w=doseWellCounts[key]??val('dose-wells')??'1';
  return `<label class="dose-well-item"><span>${fmt(v)} ${escapeHTML(unit)}</span><input type="number" min="1" step="1" inputmode="numeric" data-dose-well="${key}" aria-label="Wells for ${fmt(v)} ${escapeHTML(unit)}" value="${escapeHTML(w)}"></label>`;
 }).join(''):'<span class="tiny muted">Enter valid target concentrations to set well counts.</span>';
}
function dosingInputs(){
 const values=Object.fromEntries(DOSE_FIELDS.map(k=>[k,val(k)]));
 const counts={...doseWellCounts};byId('dose-wells-list').querySelectorAll('[data-dose-well]').forEach(el=>counts[el.dataset.doseWell]=el.value);
 values['dose-wells-map']=JSON.stringify(counts);
 return values;
}
function applyDosingInputs(input){
 for(const k of DOSE_FIELDS)if(input[k]!==undefined)setVal(k,input[k]);
 doseWellCounts=Object.create(null);
 if(input['dose-wells-map'])try{const parsed=typeof input['dose-wells-map']==='string'?JSON.parse(input['dose-wells-map']):input['dose-wells-map'];if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))Object.assign(doseWellCounts,parsed)}catch(e){console.warn('Could not load per-condition wells',e)}
 renderDoseWellInputs();
}

function applyDoseChemical(){const x=getChem(val('dose-chemical'));if(!x)return;setVal('dose-name',x.name);setVal('dose-stock',x.stock||'');if(x.stockUnit)setVal('dose-stock-unit',x.stockUnit);setVal('dose-solvent',x.solvent||'');setVal('dose-mw',x.mw||'')}
function roundPrepVolume(volume){
 // Round up, never down: keep the stock transfer at or above the user's pipetting floor.
 // 0.1 µL granularity below 10 µL, whole µL below 100 µL, and 10 µL above.
 const quantum=volume<=10?0.1:volume<=100?1:10;
 return Math.ceil((volume-1e-10)/quantum)*quantum;
}
function dilutionLabel(from,to){const fold=from/to;return Math.abs(fold-1)<1e-9?'No dilution':`1:${fmt(fold)}`}
function dosingStockLabel(r){return `Stock (${fmt(r.stockValue)} ${r.stockUnit})`}
function buildDirectIntermediate(ci,requestedVolume,stockConcentration,minPip,maxPrep,preferSmallest){
 const ratio=stockConcentration/ci;
 let prepVolume=requestedVolume,steps=[];
 if(ratio>1+1e-10){
  // Prefer a single pipettable dilution, enlarging only this intermediate if allowed.
  const needed=Math.max(ratio*minPip,ratio*minPip/(ratio-1));
  const oneStepVolume=needed<=requestedVolume*(1+1e-10)?requestedVolume:roundPrepVolume(needed);
  if(!preferSmallest&&oneStepVolume<=maxPrep+1e-9)prepVolume=oneStepVolume;
  const maxFold=prepVolume/minPip;
  if(maxFold<=1+1e-10)throw Error('Increase intermediate preparation volume or reduce the minimum pipetting threshold.');
  const count=Math.max(1,Math.ceil(Math.log(ratio)/Math.log(maxFold)-1e-12));
  if(count>15)throw Error('Dilution requires more than 15 stages. Increase your maximum preparation volume.');
  let source=stockConcentration,remainingRatio=ratio;
  const convenient=[2,2.5,4,5,8,10,12.5,16,20,25,40,50,100,200,500,1000];
  for(let j=1;j<=count;j++){
   let fold=remainingRatio;
   if(j<count){
    const left=count-j,ideal=Math.pow(remainingRatio,1/(left+1));
    const choices=convenient.filter(f=>f<=maxFold+1e-9&&f<=remainingRatio+1e-9&&remainingRatio/f<=Math.pow(maxFold,left)*(1+1e-9));
    if(choices.length){
     const ease=f=>Math.abs(prepVolume/f*2-Math.round(prepVolume/f*2));
     choices.sort((aa,bb)=>5*(ease(aa)+(left===1?ease(remainingRatio/aa):0)-ease(bb)-(left===1?ease(remainingRatio/bb):0))+.25*(Math.abs(Math.log(aa/ideal))-Math.abs(Math.log(bb/ideal))));
     fold=choices[0];
    }else fold=ideal;
   }
   const dest=j===count?ci:source/fold,take=prepVolume/fold;
   steps.push({stage:j,from:source,to:dest,transfer:take,solvent:prepVolume-take,volume:prepVolume,sourceType:j===1?'stock':'stage'});
   source=dest;remainingRatio/=fold;
  }
 }
 return {steps,prepVolume};
}
function calculateDosing(input){
 const n=k=>numeric(input[k],k),stock=n('dose-stock'),stockUnit=input['dose-stock-unit'],targetUnit=input['dose-target-unit'],mw=input['dose-mw']?n('dose-mw'):0,mediumVol=n('dose-well-volume'),dose=n('dose-add'),minPip=n('dose-minpip'),minPrep=n('dose-prep-volume'),over=numeric(input['dose-overage'],'Overage',true);
 let wellMap={};if(input['dose-wells-map']){
  try{wellMap=typeof input['dose-wells-map']==='string'?JSON.parse(input['dose-wells-map']):input['dose-wells-map']}catch(e){throw Error('Invalid per-condition well counts. Please re-enter the well numbers.')}
  if(!wellMap||typeof wellMap!=='object'||Array.isArray(wellMap))throw Error('Invalid per-condition well counts.');
 }
 const legacyWells=input['dose-wells']===undefined?'1':input['dose-wells'];
 function wellsFor(v){const raw=Object.prototype.hasOwnProperty.call(wellMap,String(v))?wellMap[String(v)]:legacyWells;
  const wells=numeric(raw,`Wells for ${fmt(v)} ${targetUnit}`);
  if(!Number.isSafeInteger(wells))throw Error(`Wells for ${fmt(v)} ${targetUnit} must be a positive whole number.`);
  return wells;
 }
 const strategy=input['dose-strategy']||'shared',maxPrep=n('dose-max-prep' in input&&input['dose-max-prep']!==''?'dose-max-prep':'dose-prep-volume');
 if(!['shared','fewest','smallest'].includes(strategy))throw Error('Unknown dilution strategy.');
  if(over>200)throw Error('Overage must be 0–200%.');
 if(input['dose-volume-mode']==='final'&&dose>=mediumVol)throw Error('Fixed addition volume must be smaller than the desired final volume per well.');
 const totalVol=input['dose-volume-mode']==='final'?mediumVol:mediumVol+dose;
 if(!input['dose-name'])throw Error('Enter the reagent name.');
 const values=input['dose-targets'].split(/[\s,;]+/).filter(Boolean).map((v,i)=>numeric(v,`Concentration ${i+1}`,true));
 if(!values.length)throw Error('Enter at least one target concentration.');if(values.length>32)throw Error('A maximum of 32 concentrations is supported per plan.');
 const seen=new Set();if(values.some(x=>{if(seen.has(x))return true;seen.add(x);return false}))throw Error('Duplicate target concentrations: enter each condition only once.');
 // Highest intermediate first so downstream shared sources are already prepared.
 values.sort((x,y)=>y-x);
 const stockInTargetUnit=convertConc(stock,stockUnit,targetUnit,mw),solvent=input['dose-solvent']||'stock solvent';
 // Each concentration can have different replicates. Prepare enough for all wells,
 // one extra handling well, and the separately configured percentage overage.
 const requirements=new Map(values.map(v=>[v,{wells:wellsFor(v),extraWells:1}]));
 for(const v of values){
  const req=requirements.get(v);
  req.requiredVolume=dose*(req.wells+req.extraWells)*(1+over/100);
  req.basePrep=Math.max(minPrep,req.requiredVolume);
  if(v!==0&&req.basePrep>maxPrep+1e-9)throw Error(`${fmt(v)} ${targetUnit}: maximum intermediate prep must be at least ${fmt(req.basePrep)} µL to cover ${req.wells} wells + 1 extra well and ${fmt(over)}% overage. Increase the maximum prep limit.`);
 }
 if(minPrep<minPip*1.00001)throw Error('Minimum intermediate preparation volume must be at least as large as the minimum pipetting volume.');
 const basePrep=minPrep;
 const active=[],conditions=[];
 for(const v of values){
  if(v===0){const req=requirements.get(v);conditions.push({target:0,intermediate:0,steps:[],vehicle:true,prepVolume:req.requiredVolume,requiredVolume:req.requiredVolume,wells:req.wells,extraWells:1});continue}
  const ci=v*totalVol/dose;
  if(ci>stockInTargetUnit*(1+1e-9))throw Error(`${fmt(v)} ${targetUnit} needs an intermediate at ${fmt(ci)} ${targetUnit}, greater than the available stock (${fmt(stockInTargetUnit)} ${targetUnit}). Increase dose volume or use a more concentrated stock.`);
  const req=requirements.get(v),direct=buildDirectIntermediate(ci,req.basePrep,stockInTargetUnit,minPip,maxPrep,strategy==='smallest');
  const c={target:v,intermediate:ci,steps:direct.steps,vehicle:false,prepVolume:direct.prepVolume,requiredVolume:req.requiredVolume,wells:req.wells,extraWells:1,basePrep:req.basePrep,parentTarget:null};
  active.push(c);conditions.push(c);
 }
 if(strategy==='shared'){
  // Share a higher prepared working solution only when direct preparation would
  // require a larger volume or serial stages. Dense dose series remain independent.
  for(let i=0;i<active.length;i++){
   const c=active[i];
   if(c.prepVolume<=c.basePrep*(1+1e-8)&&c.steps.length<=1)continue;
   const parents=active.slice(0,i).filter(parent=>parent.intermediate<stockInTargetUnit*(1-1e-9)&&parent.intermediate/c.intermediate>=2-1e-9&&c.basePrep*c.intermediate/parent.intermediate>=minPip-1e-8);
   if(parents.length)c.parentTarget=parents[0].target;
  }
  // Work from the lowest solution upwards to reserve transfers for descendants.
  // If a parent exceeds the user's prep cap, reroute its largest consumer to stock.
  for(let attempt=0;attempt<=active.length;attempt++){
   const usage=new Map(active.map(c=>[c.target,0]));
   let overflow=null;
   for(let i=active.length-1;i>=0;i--){
    const c=active[i],needed=c.requiredVolume+usage.get(c.target),requested=Math.max(c.basePrep,needed);
    let volume=requested<=c.basePrep+1e-9?c.basePrep:roundPrepVolume(requested);
    if(volume>maxPrep+1e-8&&requested<=maxPrep+1e-8)volume=requested;
    if(volume>maxPrep+1e-8){overflow=c;break}
    if(c.parentTarget===null){
     const d=buildDirectIntermediate(c.intermediate,volume,stockInTargetUnit,minPip,maxPrep,false);
     c.prepVolume=d.prepVolume;c.steps=d.steps;
    }else c.prepVolume=volume;
    if(c.parentTarget!==null){
     const parent=active.find(x=>x.target===c.parentTarget);
     const transfer=c.prepVolume*c.intermediate/parent.intermediate;
     usage.set(parent.target,usage.get(parent.target)+transfer);
    }
   }
   if(!overflow){
    for(const c of active)if(c.parentTarget!==null){
     const parent=active.find(x=>x.target===c.parentTarget),transfer=c.prepVolume*c.intermediate/parent.intermediate;
     c.steps=[{stage:1,from:parent.intermediate,to:c.intermediate,transfer,solvent:c.prepVolume-transfer,volume:c.prepVolume,sourceType:'shared',sourceTarget:parent.target}];
    }
    break;
   }
   const children=active.filter(c=>c.parentTarget===overflow.target).sort((a,b)=>b.prepVolume*b.intermediate-a.prepVolume*a.intermediate);
   if(!children.length)throw Error('Cannot fit this dilution tree within the maximum preparation volume. Increase the cap or select independent preparations.');
   children[0].parentTarget=null;
   if(attempt===active.length)throw Error('Could not construct a feasible shared dilution tree. Select Independent preparations.');
  }
 }
 for(const c of active)for(const st of c.steps){
  if(st.transfer<minPip-1e-8||st.solvent>1e-8&&st.solvent<minPip-1e-8)throw Error('A planned transfer is below the minimum pipetting volume. Increase preparation limits or choose a different strategy.');
  if(Math.abs(st.from*st.transfer/st.volume-st.to)>Math.max(1e-8,st.to*1e-8))throw Error('Internal dilution balance check failed.');
 }
 const vehiclePercent=100*dose/totalVol;
 const warns=[];
 if(vehiclePercent>0.1)warns.push(`Vehicle addition corresponds to ${fmt(vehiclePercent)}% v/v ${solvent} (assuming stock/intermediates are entirely in that solvent). Assess vehicle tolerance for your model.`);
 if(!values.includes(0))warns.push('No vehicle-only (0 concentration) condition was entered. Consider including one.');
 if(/dmso/i.test(solvent))warns.push('Preparing every intermediate in DMSO keeps the added DMSO volume matched but may cause solubility/precipitation problems. Check compound solubility.');
 if(input['dose-volume-mode']==='existing')warns.push('Concentrations account for the treatment volume being added to the existing medium.');
 if(conditions.some(c=>!c.vehicle&&c.prepVolume>c.basePrep+1e-9))warns.push('Some preparations use more than the minimum volume to meet pipetting requirements or supply downstream dilutions.');
 if(conditions.some(c=>!c.vehicle&&c.steps.some(s=>s.transfer<=minPip*(1+1e-8))))warns.push(`One or more transfers are at the configured minimum (${fmt(minPip)} µL); consider a higher threshold for improved accuracy.`);
 const operations=active.reduce((a,c)=>a+c.steps.length,0);
 return {stockInTargetUnit,stockValue:stock,totalVol,mediumBefore:input['dose-volume-mode']==='final'?mediumVol-dose:mediumVol,vehiclePercent,solvent,conditions,prepVol:basePrep,maxPrep,strategy,wells:conditions.every(c=>c.wells===conditions[0].wells)?conditions[0].wells:null,over,warnings:warns,minPip,targetUnit,stockUnit,operations,sharedCount:active.filter(c=>c.parentTarget!==null).length};
}
function dosingSourceName(step,r){
 if(step.sourceType==='shared')return `${fmt(step.from)} ${r.targetUnit} intermediate`;
 if(step.stage>1)return `stage ${step.stage-1} (${fmt(step.from)} ${r.targetUnit})`;
 return `starting stock (${fmt(r.stockValue??'')} ${r.stockUnit})`;
}
function treatmentNote(rec){
 const inp=rec.input,r=rec.result;
 const strat={shared:'Shared intermediates',fewest:'Independent preparations (fewest steps)',smallest:'Independent preparations (smallest volume)'};
 let t=`[LAB EXPERIMENTAL DOSING PLAN]\nCalculated: ${dt(rec.timestamp)}\nExperiment: ${rec.name}\nChemical: ${rec.chemicalName}\n${rec.catalog?'Catalog: '+rec.catalog+'\n':''}${rec.lot?'Lot: '+rec.lot+'\n':''}Starting stock: ${inp['dose-stock']} ${inp['dose-stock-unit']} in ${r.solvent}\nPreparation method: ${strat[r.strategy]||'Previously saved plan'}\nFinal targets (high to low): ${r.conditions.map(c=>fmt(c.target)).join(', ')} ${r.targetUnit}\nWells by target: ${r.conditions.map(c=>`${fmt(c.target)} ${r.targetUnit} = ${c.wells??r.wells??1}`).join('; ')}\nPreparation includes 1 extra well per condition plus ${fmt(r.over)}% optional intermediate overage.\nMedium before dosing: ${fmt(r.mediumBefore)} µL per well\nAdd per well: ${fmt(Number(inp['dose-add']))} µL of intermediate or vehicle\nFinal volume: ${fmt(r.totalVol)} µL per well\nCalculated vehicle: ${fmt(r.vehiclePercent)}% v/v if all solutions are in ${r.solvent}\nMinimum prep: ${fmt(r.prepVol)} µL; maximum prep: ${fmt(r.maxPrep)} µL\nOverage: ${fmt(r.over)}%; pipetting minimum: ${fmt(r.minPip)} µL\n\nTREATMENT CONDITIONS / ORDER OF PREPARATION\n`;
 for(const c of r.conditions){
  t+=`\n${fmt(c.target)} ${r.targetUnit}: `;
  const actual=c.wells??r.wells??1,extra=actual+1,amount=Number(inp['dose-add']);
  t+=`${actual} wells: ${fmt(actual*amount)} µL ${c.vehicle?'vehicle':'treatment'} + ${fmt(actual*r.mediumBefore)} µL medium (${fmt(actual*r.totalVol)} µL final).\n`;
  t+=`  With 1 extra well (${extra} wells): ${fmt(extra*amount)} µL ${c.vehicle?'vehicle':'treatment'} + ${fmt(extra*r.mediumBefore)} µL medium (${fmt(extra*r.totalVol)} µL final).\n`;
  if(c.vehicle){t+=`  vehicle control — use pure ${r.solvent}; ${fmt(amount)} µL/well.\n`;continue}
  t+=`  prepare ${fmt(c.prepVolume??r.prepVol)} µL of ${fmt(c.intermediate)} ${r.targetUnit}; add ${fmt(amount)} µL/well. Intermediate preparation includes handling reserve and ${fmt(r.over)}% overage.\n`;
  if(!c.steps.length)t+=`  Use starting stock directly (no dilution).\n`;
  else for(const s of c.steps)t+=`  ${c.steps.length===1?'Dilute':`Stage ${s.stage}`}: ${fmt(s.transfer)} µL ${dosingSourceName(s,r)} + ${fmt(s.solvent)} µL ${r.solvent} → ${fmt(s.volume)} µL at ${fmt(s.to)} ${r.targetUnit} (${dilutionLabel(s.from,s.to)}).\n`;
 }
 if(inp['dose-notes'])t+=`\nExperiment notes: ${inp['dose-notes']}\n`;
 if(r.warnings.length)t+='\nCHECKS / WARNINGS\n'+r.warnings.map(s=>'- '+s).join('\n')+'\n';
 t+='\nVerify compound solubility and stability, downstream material availability, and pipette suitability.\n';return t;
}
function calculateDose(){try{const input=dosingInputs();const chemical=getChem(input['dose-chemical']);const result=calculateDosing(input);latestDose=autoHistory({kind:'dosing',name:input['dose-title']||'Experimental treatment',chemicalName:input['dose-name'],catalog:chemical?.catalog||'',lot:chemical?.lot||'',chemicalId:input['dose-chemical'],input,result,notes:input['dose-notes']||''});renderDosingResult(latestDose);toast('Dosing plan calculated and saved to history.')}catch(e){latestDose=null;byId('dose-actions').classList.add('hidden');byId('dose-status').textContent='CHECK INPUT';byId('dose-status').className='tag error';errorMessage('dose-result',e.message)}}
function renderDosingResult(rec){
 const r=rec.result,unit=escapeHTML(r.targetUnit),solvent=escapeHTML(r.solvent),dose=fmt(Number(rec.input['dose-add']));
 const choices=[['shared','Shared intermediates'],['fewest','Independent / fewest steps'],['smallest','Independent / smallest volume']];
 const switcher=`<div class="strategy-switch"><div class="result-section-title">Preparation strategy</div><div class="strategy-buttons" role="group" aria-label="Intermediate preparation strategy">${choices.map(([value,label])=>`<button type="button" class="btn small ${r.strategy===value?'selected':''}" data-dose-plan="${value}" aria-pressed="${r.strategy===value}">${label}</button>`).join('')}</div><div class="tiny muted">Choose another strategy to recalculate and save a separate dated plan. Shared mode uses prepared higher-concentration intermediates when advantageous.</div></div>`;
 const rows=r.conditions.map(c=>{
  const nw=c.wells??r.wells??1;
  const formatMix=count=>`${fmt(count*Number(rec.input['dose-add']))} µL <span class="muted">${c.vehicle?'vehicle':'treatment'} +</span> ${fmt(count*r.mediumBefore)} µL <span class="muted">medium</span><div class="tiny muted">${fmt(count*r.totalVol)} µL final</div>`;
  let source='—',fold='—',recipe='—';
  if(c.vehicle){source=`${solvent} only`;recipe=`${dose} µL vehicle/well`;}
  else if(!c.steps.length){source='Starting stock';fold='No dilution';recipe='Use stock directly';}
  else if(c.steps.length>1){source='Multi-stage';fold=`${c.steps.length} stages`;recipe='See recipes below ↓';}
  else{const st=c.steps[0];source=st.sourceType==='shared'?`${fmt(st.from)} ${unit} intermediate`:`Stock (${fmt(r.stockValue??rec.input['dose-stock'])} ${escapeHTML(r.stockUnit)})`;fold=dilutionLabel(st.from,st.to);recipe=`<strong>${fmt(st.transfer)} µL</strong> + ${fmt(st.solvent)} µL ${solvent}`;}
  return `<tr><td><strong>${fmt(c.target)} ${unit}</strong></td><td>${c.vehicle?'Vehicle only':fmt(c.intermediate)+' '+unit}</td><td>${source}</td><td>${fold}</td><td>${recipe}</td><td>${c.vehicle?'—':fmt(c.prepVolume??r.prepVol)+' µL'}</td><td>${dose} µL</td><td><strong>${nw}</strong></td><td class="mix-cell">${formatMix(nw)}</td><td class="mix-cell">${formatMix(nw+1)}</td></tr>`;
 }).join('');
 const details=r.conditions.map(c=>{
  const label=`<div class="result-section-title">${fmt(c.target)} ${unit}${c.vehicle?' · vehicle control':''}</div>`;
  if(c.vehicle)return label+`<p class="tiny">${c.wells??r.wells??1} treatment wells + 1 handling well. Add ${dose} µL pure ${solvent} per well. Prepare enough for replicate pipetting.</p>`;
  if(!c.steps.length)return label+`<p class="tiny">Use starting stock without predilution. Add ${dose} µL per well.</p>`;
  return label+`<p class="tiny">${c.wells??r.wells??1} treatment wells + 1 handling well. Prepare ${fmt(c.prepVolume??r.prepVol)} µL of ${fmt(c.intermediate)} ${unit}${c.parentTarget!==null&&c.parentTarget!==undefined?` from the previously prepared ${fmt(c.steps[0].from)} ${unit} intermediate`:''}.</p><ol class="steps">${c.steps.map(st=>`<li><strong>${c.steps.length===1?'Dilute':`Stage ${st.stage}`} (${dilutionLabel(st.from,st.to)}):</strong> ${fmt(st.transfer)} µL ${escapeHTML(dosingSourceName(st,r))} + ${fmt(st.solvent)} µL ${solvent} → ${fmt(st.volume)} µL of ${fmt(st.to)} ${unit}.</li>`).join('')}</ol>`;
 }).join('');
 const numberOfOps=r.operations??r.conditions.reduce((a,c)=>a+c.steps.length,0),numberOfShared=r.sharedCount??r.conditions.filter(c=>c.parentTarget!==null&&c.parentTarget!==undefined).length;
 byId('dose-result').className='';
 byId('dose-result').innerHTML=`<div class="result-highlight"><label>FIXED DOSE / VEHICLE PLAN</label><strong>${dose} µL per well</strong><div class="result-sub">${fmt(r.mediumBefore)} µL medium + ${dose} µL treatment = ${fmt(r.totalVol)} µL final. Vehicle: ${fmt(r.vehiclePercent)}% v/v (if homogeneous solvent).</div></div>${switcher}<div class="result-section-title">Condition summary · highest dose first</div><div class="table-scroll"><table class="data-table dose-summary"><thead><tr><th>Final target</th><th>Intermediate</th><th>Prepare from</th><th>Dilution</th><th>Recipe (source + diluent)</th><th>Prep</th><th>Add/well</th><th># wells</th><th>For actual wells</th><th>Including +1 well</th></tr></thead><tbody>${rows}</tbody></table></div><div class="small-note">${r.conditions.filter(c=>!c.vehicle).length} working concentrations · ${numberOfOps} preparation operation${numberOfOps===1?'':'s'} · ${numberOfShared} reused intermediate${numberOfShared===1?'':'s'}. Minimum ${fmt(r.prepVol)} µL/preparation; downstream withdrawals are included where intermediates are shared. One additional well per condition is included when estimating intermediate requirements, followed by ${fmt(r.over)}% optional overage. Solutions and vehicle should use the same solvent.</div>${r.warnings.map(w=>`<div class="small-note warning">${escapeHTML(w)}</div>`).join('')}<div class="result-section-title">Intermediate preparation recipes · highest first</div>${details}<div class="result-section-title">Copy-ready note</div><div class="doc-preview">${escapeHTML(treatmentNote(rec))}</div>`;
 byId('dose-actions').classList.remove('hidden');byId('dose-status').className='tag success';byId('dose-status').textContent='SAVED';
}
function saveTemplate(){if(!latestDose)return;const label=prompt('Name this reusable dosing template:',latestDose.name);if(label===null)return;if(!clean(label))return toast('Template name cannot be empty.',true);db.templates.unshift({id:uid(),name:clean(label),createdAt:isoNow(),inputs:{...latestDose.input}});store();toast('Dosing template saved. Open Templates to reuse it.')}
function loadTemplate(id){const t=db.templates.find(x=>x.id===id);if(!t)return;showPage('dosing');applyDosingInputs(t.inputs);latestDose=null;byId('dose-result').className='empty-result';byId('dose-result').textContent='Template loaded. Modify any field, then generate a new timestamped record.';byId('dose-actions').classList.add('hidden');byId('dose-status').className='tag';byId('dose-status').textContent='TEMPLATE LOADED';toast('Template loaded. Review inputs before recalculating.')}

/* ---- Library ---- */
const LIB_FIELDS=['name','maker','catalog','lot','cas','mw','stock','stockUnit','solvent','storage','prepdate','expiry','notes'];
function resetLib(){setVal('lib-id','');LIB_FIELDS.forEach(k=>setVal('lib-'+k,''));setVal('lib-stock-unit','mM');byId('library-form-title').textContent='New chemical / stock'}
function editLib(id){const x=getChem(id);if(!x)return;setVal('lib-id',x.id);LIB_FIELDS.forEach(k=>setVal('lib-'+k,x[k]));byId('library-form-title').textContent='Edit chemical / stock';showPage('library');window.scrollTo({top:0,behavior:'instant'})}
function saveLib(){try{const name=val('lib-name');if(!name)throw Error('Chemical name is required.');const stock=val('lib-stock'),mw=val('lib-mw');if(stock)numeric(stock,'Stock concentration');if(mw)numeric(mw,'Molecular weight');const x=Object.fromEntries(LIB_FIELDS.map(k=>[k,val('lib-'+k)]));const id=val('lib-id');if(id){const index=db.chemicals.findIndex(y=>y.id===id);if(index<0)throw Error('Record no longer exists.');db.chemicals[index]={...db.chemicals[index],...x,updatedAt:isoNow()};toast('Chemical record updated.')}else{db.chemicals.unshift({...x,id:uid(),createdAt:isoNow(),updatedAt:isoNow()});toast('New chemical saved.')}store();renderChemicalOptions();resetLib();renderLibrary()}catch(e){toast(e.message,true)}}
function renderLibrary(){const search=val('library-search').toLowerCase();const items=db.chemicals.filter(x=>[x.name,x.maker,x.catalog,x.lot,x.cas,x.solvent,x.notes].join(' ').toLowerCase().includes(search));byId('library-count').textContent=`(${items.length})`;byId('library-list').innerHTML=items.length?items.map(x=>`<div class="record"><div class="record-top"><strong>${escapeHTML(x.name)}</strong><span class="inline-badge">${x.stock?fmt(+x.stock)+' '+escapeHTML(x.stockUnit):'REAGENT'}</span></div><div class="record-meta">${escapeHTML(x.maker||'Manufacturer not entered')} ${x.catalog?'· Cat. '+escapeHTML(x.catalog):''} ${x.lot?'· Lot '+escapeHTML(x.lot):''}</div><div class="record-desc">${x.solvent?'Solvent: '+escapeHTML(x.solvent)+' · ':''}${x.mw?'MW: '+escapeHTML(x.mw)+' g/mol · ':''}${x.storage?'Storage: '+escapeHTML(x.storage):''}</div><div class="record-actions"><button class="btn" data-libedit="${x.id}">Edit</button><button class="btn" data-libcalc="${x.id}">Use in calculator</button>${x.stock?`<button class="btn" data-libdose="${x.id}">Use for dosing</button>`:''}<button class="btn danger" data-libdelete="${x.id}">Delete</button></div></div>`).join(''):'<div class="empty-result">No chemical records match. Add your first reagent using the form.</div>'}

/* ---- History ---- */
function renderHistory(){const q=val('history-search').toLowerCase(),filter=val('history-filter');const items=db.history.filter(x=>(filter==='all'||x.kind===filter)&&[x.name,x.chemicalName,x.catalog,x.lot,x.notes].join(' ').toLowerCase().includes(q));byId('history-list').innerHTML=items.length?items.map(x=>{const result=x.kind==='preparation'?x.result?.primary:`${x.result?.conditions?.length||0} conditions · ${fmt(x.result?.vehiclePercent||0)}% vehicle`;return `<div class="record"><div class="record-top"><div><strong>${escapeHTML(x.name)}</strong><div class="record-meta">${escapeHTML(dt(x.timestamp))} · ${x.kind==='dosing'?'Dosing':'Preparation'}${x.chemicalName?' · '+escapeHTML(x.chemicalName):''}</div></div><span class="inline-badge">${x.kind==='dosing'?'DOSING':'PREP'}</span></div><div class="record-desc">${escapeHTML(result)}${x.catalog?' · Catalog: '+escapeHTML(x.catalog):''}${x.lot?' · Lot: '+escapeHTML(x.lot):''}</div><div class="record-actions"><button class="btn" data-historycopy="${x.id}">Copy lab note</button><button class="btn" data-historyreuse="${x.id}">Reuse inputs</button><button class="btn" data-historyedit="${x.id}">Edit metadata</button><button class="btn" data-historydownload="${x.id}">Download .txt</button><button class="btn danger" data-historydelete="${x.id}">Delete</button></div><div id="meta-${x.id}"></div></div>`}).join(''):'<div class="empty-result">No matching calculations yet. Every successful calculation appears here automatically.</div>'}
function recordNote(rec){return rec.kind==='dosing'?treatmentNote(rec):preparationNote(rec)}
function editHistoryMetadata(id){const x=db.history.find(r=>r.id===id);if(!x)return;const container=byId('meta-'+id);if(container.classList.contains('editing')){container.classList.remove('editing');container.innerHTML='';return}container.classList.add('editing');container.innerHTML=`<div class="edit-meta"><div class="form-grid"><label class="field"><span>Catalog number</span><input data-meta="catalog" value="${escapeHTML(x.catalog||'')}"></label><label class="field"><span>Lot number</span><input data-meta="lot" value="${escapeHTML(x.lot||'')}"></label><label class="field full"><span>Notes</span><textarea data-meta="notes" rows="3">${escapeHTML(x.notes||'')}</textarea></label></div><button class="btn btn-primary" data-metasave="${x.id}">Save metadata</button> <span class="tiny muted">Original calculation and timestamp remain unchanged.</span></div>`}
function saveHistoryMetadata(id){const x=db.history.find(r=>r.id===id);if(!x)return;byId('meta-'+id).querySelectorAll('[data-meta]').forEach(el=>x[el.dataset.meta]=el.value);store();renderHistory();toast('Metadata updated. Calculated values unchanged.')}
function reuseHistory(id){const x=db.history.find(r=>r.id===id);if(!x)return;if(x.kind==='dosing'){showPage('dosing');applyDosingInputs(x.input);byId('dose-actions').classList.add('hidden');byId('dose-result').className='empty-result';byId('dose-result').textContent='Previous values loaded. Edit as needed, then calculate to create a NEW history record.'}else{showPage('calculator');setVal('calc-mode',x.input.mode);renderCalcMode();setVal('calc-chemical',getChem(x.input.chemId)?x.input.chemId:'');setVal('calc-name',x.input.name);setVal('calc-catalog',x.catalog);setVal('calc-lot',x.lot);Object.keys(x.input).filter(k=>k.startsWith('f-')).forEach(k=>setVal(k,x.input[k]));byId('calc-result').className='empty-result';byId('calc-result').textContent='Previous values loaded. Edit as needed, then calculate to create a NEW history record.'}toast('Inputs loaded. Historical calculation preserved.')}

/* ---- Templates & portability ---- */
function renderTemplates(){byId('template-list').innerHTML=db.templates.length?db.templates.map(t=>`<div class="record"><div class="record-top"><strong>${escapeHTML(t.name)}</strong><span class="inline-badge">DOSING</span></div><div class="record-meta">Saved ${escapeHTML(dt(t.createdAt))}</div><div class="record-desc">${escapeHTML(t.inputs['dose-name'])||'Reagent not entered'} · Targets: ${escapeHTML(t.inputs['dose-targets'])} ${escapeHTML(t.inputs['dose-target-unit'])}</div><div class="record-actions"><button class="btn btn-primary" data-templateload="${t.id}">Load & modify</button><button class="btn danger" data-templatedelete="${t.id}">Delete</button></div></div>`).join(''):'<div class="empty-result">No saved templates yet. Generate a dosing plan and select “Save template”.</div>'}
function download(text,filename,mime='text/plain'){const blob=new Blob([text],{type:mime+';charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),3000)}
function safeName(s){return String(s||'record').replace(/[^a-zA-Z0-9_-]+/g,'-').slice(0,55)}
function downloadRecord(rec){download(recordNote(rec),safeName(rec.name)+'-'+rec.timestamp.slice(0,10)+'.txt')}
function exportBackup(){download(JSON.stringify({...db,exportedAt:isoNow()},null,2),'LabChem-backup-'+today()+'.json','application/json');toast('Full JSON backup downloaded.')}
function exportCSV(){const columns=['Date/time (ISO)','Type','Chemical / experiment','Catalog','Lot','Result summary','Notes'];const values=db.history.map(x=>[x.timestamp,x.kind,x.name,x.catalog||'',x.lot||'',x.kind==='preparation'?(x.result?.primary||''):`${x.result?.conditions?.map(c=>c.target).join(' / ')} ${x.result?.targetUnit}`,x.notes||'']);const rows=[columns,...values].map(r=>r.map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(','));download('\ufeff'+rows.join('\r\n'),'LabChem-history-'+today()+'.csv','text/csv');toast('History CSV exported.')}
async function importBackup(file){if(!file)return;try{const raw=await file.text();const incoming=JSON.parse(raw);if(incoming.version!==1||!['chemicals','history','templates'].every(k=>Array.isArray(incoming[k])))throw Error('This file is not a supported LabChem v1 backup.');if(!confirm(`Replace all local data with ${incoming.chemicals.length} chemicals, ${incoming.history.length} history records, and ${incoming.templates.length} templates from this backup? This cannot be undone except by restoring another backup.`))return;db={version:1,chemicals:incoming.chemicals,history:incoming.history,templates:incoming.templates};store();renderChemicalOptions();renderLibrary();renderHistory();renderTemplates();toast('JSON backup imported successfully.')}catch(e){toast('Import failed: '+e.message,true)}finally{byId('backup-import').value=''}}
async function copyText(s){try{if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(s)}else{const t=document.createElement('textarea');t.value=s;t.style.position='fixed';t.style.opacity='0';document.body.append(t);t.select();if(!document.execCommand('copy'))throw Error('Clipboard not available');t.remove()}toast('Lab-note text copied to clipboard.')}catch(e){toast('Could not copy automatically. Select the text in the preview or download the .txt file.',true)}}

/* ---- Events and initialization ---- */
function init(){
 byId('now-date').textContent=new Date().toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric',year:'numeric'});
 byId('dose-stock-unit').innerHTML=options(CONC_UNITS,'mM');byId('dose-target-unit').innerHTML=options(CONC_UNITS,'µM');byId('lib-stock-unit').innerHTML=options(CONC_UNITS,'mM');
 renderChemicalOptions();renderCalcMode();updateCounts();
 byId('nav').addEventListener('click',e=>{const b=e.target.closest('[data-page]');if(b)showPage(b.dataset.page)});
 document.querySelectorAll('[data-goto]').forEach(b=>b.addEventListener('click',()=>showPage(b.dataset.goto)));
 byId('calc-mode').addEventListener('change',renderCalcMode);byId('calc-chemical').addEventListener('change',applyCalcChemical);
 byId('calculate-prep').addEventListener('click',calculatePreparation);
 byId('copy-prep').addEventListener('click',()=>latestPrep&&copyText(preparationNote(latestPrep)));
 byId('save-prep-stock').addEventListener('click',stockFromPrep);
 byId('download-prep').addEventListener('click',()=>latestPrep&&downloadRecord(latestPrep));
 byId('dose-chemical').addEventListener('change',applyDoseChemical);
 byId('dose-targets').addEventListener('input',renderDoseWellInputs);
 byId('dose-target-unit').addEventListener('change',renderDoseWellInputs);
 byId('dose-wells-list').addEventListener('input',e=>{if(e.target.matches('[data-dose-well]'))doseWellCounts[e.target.dataset.doseWell]=e.target.value;});
 renderDoseWellInputs();
 byId('calculate-dose').addEventListener('click',calculateDose);
 byId('dose-result').addEventListener('click',e=>{const btn=e.target.closest('[data-dose-plan]');if(!btn)return;if(btn.dataset.dosePlan===val('dose-strategy'))return;setVal('dose-strategy',btn.dataset.dosePlan);calculateDose();});
 byId('copy-dose').addEventListener('click',()=>latestDose&&copyText(treatmentNote(latestDose)));
 byId('save-dose-template').addEventListener('click',saveTemplate);
 byId('download-dose').addEventListener('click',()=>latestDose&&downloadRecord(latestDose));
 byId('library-new').addEventListener('click',resetLib);byId('library-reset').addEventListener('click',resetLib);byId('library-save').addEventListener('click',saveLib);byId('library-search').addEventListener('input',renderLibrary);
 byId('library-list').addEventListener('click',e=>{const btn=e.target.closest('button');if(!btn)return;const a=btn.dataset;if(a.libedit)editLib(a.libedit);if(a.libdelete&&confirm('Delete this saved chemical? Calculation history remains unchanged.')){db.chemicals=db.chemicals.filter(x=>x.id!==a.libdelete);store();renderChemicalOptions();renderLibrary()};if(a.libcalc){showPage('calculator');setVal('calc-chemical',a.libcalc);applyCalcChemical()}if(a.libdose){showPage('dosing');setVal('dose-chemical',a.libdose);applyDoseChemical()}});
 byId('history-search').addEventListener('input',renderHistory);byId('history-filter').addEventListener('change',renderHistory);byId('history-export-csv').addEventListener('click',exportCSV);
 byId('history-list').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;const a=b.dataset;const id=a.historycopy||a.historyreuse||a.historyedit||a.historydelete||a.historydownload||a.metasave;const r=db.history.find(x=>x.id===id);if(a.historycopy&&r)copyText(recordNote(r));if(a.historyreuse)reuseHistory(a.historyreuse);if(a.historyedit)editHistoryMetadata(a.historyedit);if(a.metasave)saveHistoryMetadata(a.metasave);if(a.historydownload&&r)downloadRecord(r);if(a.historydelete&&confirm('Permanently delete this history record?')){db.history=db.history.filter(x=>x.id!==a.historydelete);store();renderHistory()}});
 byId('template-list').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.templateload)loadTemplate(b.dataset.templateload);if(b.dataset.templatedelete&&confirm('Delete this template?')){db.templates=db.templates.filter(x=>x.id!==b.dataset.templatedelete);store();renderTemplates()}});
 byId('export-backup-top').addEventListener('click',exportBackup);byId('backup-export').addEventListener('click',exportBackup);byId('backup-import').addEventListener('change',e=>importBackup(e.target.files[0]));
}
window.LabChemMath={computePrep,calculateDosing,convertConc,massMg,toML,fmt};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();