const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const script = fs.readFileSync('app.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
for (const id of ['dose-max-prep','dose-strategy']) {
  assert(html.includes('id="'+id+'"'), 'Missing dosing UI field: '+id);
}
const scope = vm.createContext({
  console, Date, Number, Math, Error, Set, String, Intl,
  localStorage: {getItem:()=>null,setItem:()=>{}},
  document: {readyState:'loading',addEventListener:()=>{}},
  window: {}, setTimeout, clearTimeout,
});
vm.runInContext(script,scope);

function dosing(overrides={}) {
 const settings = {
  'dose-name':'Test chemical', 'dose-stock':'10','dose-stock-unit':'mM',
  'dose-mw':'','dose-solvent':'DMSO','dose-targets':'0, 0.05, 0.1, 0.2',
  'dose-target-unit':'µM','dose-wells':'2','dose-well-volume':'500',
  'dose-volume-mode':'final','dose-add':'1','dose-minpip':'0.5',
  'dose-prep-volume':'100','dose-max-prep':'500','dose-strategy':'fewest',
  'dose-overage':'20'
 };
 return scope.calculateDosing({...settings,...overrides});
}
function near(a,b) {assert(Math.abs(a-b)<1e-6, a+' ≠ '+b);}
const getDose=(result,target)=>result.conditions.find(c=>c.target===target);
const plan=dosing();
near(plan.vehiclePercent,0.2);
near(plan.mediumBefore,499);
assert.equal(getDose(plan,0).vehicle,true);
for (const [dose,concentration,volume,stockAdded] of [[0.05,25,200,0.5],[0.1,50,100,0.5],[0.2,100,100,1]]) {
 const c=plan.conditions.find(c=>c.target===dose);
 assert(c,'Missing dose '+dose);
 assert.equal(c.steps.length,1,'Dose '+dose+' should require one dilution');
 near(c.intermediate,concentration);
 near(c.prepVolume,volume);
 near(c.steps[0].transfer,stockAdded);
 near(c.steps[0].from*c.steps[0].transfer/c.steps[0].volume,c.intermediate);
}
assert.equal(getDose(dosing({'dose-strategy':'smallest'}),0.05).steps.length,2);
const pip1=getDose(dosing({'dose-minpip':'1'}),0.05);
assert.equal(pip1.steps.length,1);
near(pip1.steps[0].transfer,1);
near(pip1.prepVolume,400);
assert.equal(getDose(dosing({'dose-max-prep':'150'}),0.05).steps.length,2);
assert.equal(getDose(dosing({'dose-targets':'0, 0.01'}),0.01).steps.length,2);
assert.equal(getDose(dosing({'dose-stock':'25','dose-stock-unit':'µM','dose-targets':'0,0.05'}),0.05).steps.length,0);
near(dosing({'dose-volume-mode':'existing'}).totalVol,501);
assert.throws(()=>dosing({'dose-max-prep':'50'}),/Maximum intermediate prep/);
for(const c of dosing({'dose-targets':'0,0.00001,0.05'}).conditions) {
 for(const step of c.steps) {
  assert(step.transfer>=0.5-1e-7,'Unpipettable stock transfer');
  assert(step.solvent>=0.5-1e-7,'Unpipettable diluent transfer');
  near(step.from*step.transfer/step.volume,step.to);
 }
}
console.log('All dosing planner regression tests passed');
