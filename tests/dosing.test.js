'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const script=fs.readFileSync('app.js','utf8');
const html=fs.readFileSync('index.html','utf8');
for(const id of ['dose-max-prep','dose-strategy','dose-plate-format','plate-grid','plate-select-all','plate-clear-selection','dose-density-values','dose-label-priority1','dose-label-priority2','dose-wells-list']){
 assert(html.includes('id="'+id+'"'),'Missing website input '+id);
}
const scope=vm.createContext({console,Date,Number,Math,Error,Set,Map,Array,String,Intl,JSON,
 localStorage:{getItem:()=>null,setItem:()=>{}},document:{readyState:'loading',addEventListener:()=>{}},window:{},setTimeout,clearTimeout});
vm.runInContext(script,scope);
const base={
 'dose-title':'Plate design test','dose-name':'Test chemical','dose-stock':'10','dose-stock-unit':'mM',
 'dose-mw':'','dose-solvent':'DMSO','dose-targets':'0,0.05,0.1,0.2','dose-target-unit':'µM',
 'dose-wells':'2','dose-plate-format':'96','dose-plate-selected':'[]','dose-well-volume':'500',
 'dose-volume-mode':'final','dose-add':'1','dose-minpip':'0.5','dose-prep-volume':'100',
 'dose-max-prep':'500','dose-strategy':'fewest','dose-overage':'20',
 'dose-density-values':'','dose-density-unit':'cells/well','dose-factor3-name':'',
 'dose-factor3-values':'','dose-factor4-name':'','dose-factor4-values':'',
 'dose-label-priority1':'dose','dose-label-priority2':'density',
 'dose-label-priority3':'extra1','dose-label-priority4':'extra2'
};
const plan=(overrides={})=>scope.calculateDosing({...base,...overrides});
const layout=(overrides={})=>scope.allocatePlateWells({...base,...overrides});
function near(a,b){assert(Math.abs(a-b)<1e-6,`${a} ≠ ${b}`)}
function getDose(result,v){const c=result.conditions.find(x=>x.target===v);assert(c,'Missing dose '+v);return c}
const p=plan();near(p.vehiclePercent,0.2);near(p.mediumBefore,499);
assert.equal(getDose(p,0).vehicle,true);
for(const [dose,concentration,volume,stockAdded] of [[0.05,25,200,.5],[0.1,50,100,.5],[0.2,100,100,1]]){
 const c=getDose(p,dose);assert.equal(c.steps.length,1,`Unexpected stages for ${dose}`);
 near(c.intermediate,concentration);near(c.prepVolume,volume);
 near(c.steps[0].transfer,stockAdded);
 near(c.steps[0].from*c.steps[0].transfer/c.steps[0].volume,c.intermediate);
}
assert.equal(getDose(plan({'dose-strategy':'smallest'}),.05).steps.length,2);
const pip1=getDose(plan({'dose-minpip':'1'}),.05);
assert.equal(pip1.steps.length,1);near(pip1.steps[0].transfer,1);near(pip1.prepVolume,400);
assert.equal(getDose(plan({'dose-max-prep':'150'}),.05).steps.length,2);
assert.equal(getDose(plan({'dose-targets':'0,0.01'}),.01).steps.length,2);
assert.equal(getDose(plan({'dose-stock':'25','dose-stock-unit':'µM','dose-targets':'0,0.05'}),.05).steps.length,0);
near(plan({'dose-volume-mode':'existing'}).totalVol,501);
assert.throws(()=>plan({'dose-max-prep':'50'}),/maximum intermediate prep/i);
for(const c of plan({'dose-targets':'0,0.00001,0.05'}).conditions){
 for(const st of c.steps){assert(st.transfer>=.5-1e-7);assert(st.solvent>=.5-1e-7);near(st.from*st.transfer/st.volume,st.to)}
}
const four=layout({'dose-wells-map':JSON.stringify({'0':10,'0.05':10,'0.1':10,'0.2':10})});
assert.equal(four.totalWells,40);assert.equal(four.groups.length,4);
assert.deepEqual(Array.from(four.groups.map(x=>x.wells[0])),['A1','B1','C1','D1']);
for(let i=0;i<4;i++)assert.equal(four.groups[i].wells.at(-1),String.fromCharCode(65+i)+'10');
assert.equal(Object.keys(four.assignments).length,40);
const geo=scope.plateGeometry(96),rect=scope.plateArea('A1','H10',geo);
assert.equal(rect.length,80);
assert.equal(layout({'dose-plate-selected':JSON.stringify(rect)}).capacity,80);
const detached=[...scope.plateArea('A1','D4',geo),...scope.plateArea('A8','D12',geo)];
const masked=layout({'dose-plate-selected':JSON.stringify(detached)});
assert.equal(masked.capacity,36);for(const well of Object.keys(masked.assignments))assert(detached.includes(well));
assert.throws(()=>layout({'dose-plate-selected':'["A1"]'}),/Plate needs/);
assert.throws(()=>layout({'dose-plate-format':'6'}),/Plate needs/);
const map={'0':3,'0.05':6,'0.1':10,'0.2':1};
const irregular=plan({'dose-wells-map':JSON.stringify(map)});
assert.deepEqual(Array.from(irregular.conditions.map(x=>x.wells)),[1,10,6,3]);
assert.equal(irregular.plate.totalWells,20);
const density=plan({'dose-density-values':'5000,10000','dose-wells-map':JSON.stringify({'0':10,'0.05':10,'0.1':10,'0.2':10})});
assert.equal(density.plate.groups.length,8);assert.equal(density.plate.totalWells,80);
assert.equal(getDose(density,.1).wells,20);assert.equal(getDose(density,.1).extraWells,2);
assert.equal(density.plate.groups[0].labels[0].id,'dose');
const densityFirst=layout({'dose-density-values':'5000,10000','dose-label-priority1':'density','dose-label-priority2':'dose'});
assert.equal(densityFirst.groups[0].labels[0].id,'density');
assert.equal(densityFirst.groups[1].values.density.key,'5000');
assert.equal(densityFirst.groups[4].values.density.key,'10000');
const factorial=layout({'dose-targets':'0,0.1','dose-wells-map':JSON.stringify({'0':2,'0.1':2}),'dose-density-values':'5000;10000','dose-factor3-name':'Time','dose-factor3-values':'24h;48h','dose-factor4-name':'Cell line','dose-factor4-values':'KP;KPL'});
assert.equal(factorial.groups.length,16);assert.equal(factorial.totalWells,32);
// Deterministic regression on varied replicate counts, selection masks, and dose sets.
for(let i=0;i<150;i++){
 const wells={0:1+(i%4),0.05:1+(i%7),0.1:1+(i%6),0.2:1+(i%3)};
 const f=layout({'dose-wells-map':JSON.stringify(wells)});
 const expected=Object.values(wells).reduce((a,b)=>a+b,0);
 assert.equal(f.totalWells,expected);assert.equal(Object.keys(f.assignments).length,expected);
 assert.equal(f.groups.reduce((a,g)=>a+g.wells.length,0),expected);
}
console.log('All dosing and plate-layout regression tests passed.');