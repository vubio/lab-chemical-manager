'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const ctx={window:{},document:{readyState:'loading',addEventListener(){}},TextEncoder,Uint8Array,Uint32Array,Blob,console,Date,Number,Math,Set,Map,JSON};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('plate_reader.js','utf8'),ctx,{filename:'plate_reader.js'});
const c=ctx.window.PlateReadoutCore;
for(const fn of ['parseDelimited','normalizeGrid','matchReadings','outputTable','makeCSV'])assert.equal(typeof c[fn],'function',fn);
const makeXlsx=c.makeXlsx||c.workbookXLSX;
assert.equal(typeof makeXlsx,'function');
const parsed=text=>{const x=c.parseDelimited(text);return Array.isArray(x)?x:x.rows};
const reading=(r,col)=>101001+r*12+col,well=(r,col)=>String.fromCharCode(65+r)+(col+1);
const input=Array.from({length:8},(_,r)=>Array.from({length:12},(_,col)=>reading(r,col)).join('\t')).join('\n');
const matrix=c.normalizeGrid(parsed(input),8,12,'rows');
assert.equal(matrix.plate.A1,101001);
assert.equal(matrix.plate.H12,101096);
assert.equal(matrix.filled,96);
const headers='Row\t'+Array.from({length:12},(_,i)=>i+1).join('\t')+'\n'+Array.from({length:8},(_,r)=>String.fromCharCode(65+r)+'\t'+Array.from({length:12},(_,col)=>reading(r,col)).join('\t')).join('\n');
assert.equal(c.normalizeGrid(parsed(headers),8,12,'rows').plate.H12,101096);
const cols=Array.from({length:12},(_,col)=>Array.from({length:8},(_,r)=>reading(r,col)).join('\t')).join('\n');
assert.equal(c.normalizeGrid(parsed(cols),8,12,'columns').plate.H12,101096);
assert.throws(()=>c.normalizeGrid(parsed('1\t2\n3\t4'),8,12),/expected|cells/i);
assert.throws(()=>c.normalizeGrid(parsed(input.replace('101001','N/A')),8,12),/numeric/i);
const assignments={};
for(let d=0;d<3;d++)for(let t=0;t<4;t++)for(let rep=0;rep<3;rep++){
 const position=well(d,t*3+rep);
 assignments[position]={labels:[['1k','5k','10k'][d],['0','0.05','0.1','0.2'][t]],factorNames:['Density','Erastin2']};
}
const plate={format:'96',name:'Density × Erastin2',factors:[{name:'Density',values:'1k;5k;10k'},{name:'Erastin2',values:'0;0.05;0.1;0.2'}],assignments};
const matched=c.matchReadings(plate,matrix);
assert.equal(matched.data.length,36);
assert.equal(matched.unassigned.length,60);
assert.equal(matched.missing.length,0);
const long=c.outputTable(matched,'long');
assert.deepEqual(Array.from(long.headers),['Density','Erastin2','Replicate','Read value']);
assert.deepEqual(Array.from(long.rows[0]),['1k','0','R1',101001]);
assert.deepEqual(Array.from(long.rows[4]),['1k','0.05','R2',101005]);
assert.deepEqual(Array.from(long.rows[35]),['10k','0.2','R3',101036]);
assert.equal(c.outputTable(matched,'long_well').rows[0].at(-1),'A1');
assert.equal(c.outputTable(matched,'wide').rows.length,3);
assert.equal(c.outputTable(matched,'wide').headers.length,13);
assert.equal(c.outputTable(matched,'prism').rows.length,4);
assert.equal(c.outputTable(matched,'prism').headers.length,10);
assert.equal(c.outputTable(matched,'matrix').rows.length,8);
assert(c.makeCSV(long).includes('1k,0,R1,101001'));
const absent={...matrix,plate:{...matrix.plate,B2:null}};
assert(c.matchReadings(plate,absent).missing.includes('B2'));
assert.throws(()=>c.matchReadings({...plate,factorDraftStale:true},matrix),/factor|apply|sync/i);
const xlsx=Buffer.from(makeXlsx([{name:'Long',table:long},{name:'Raw plate',table:c.outputTable(matched,'matrix')}]));
assert.equal(xlsx.subarray(0,4).toString('hex'),'504b0304','Excel must be ZIP-based XLSX');
assert(xlsx.includes(Buffer.from('xl/workbook.xml')));
assert(xlsx.includes(Buffer.from('xl/worksheets/sheet1.xml')));

// Manually labeled wells must never be included in the ordinary factor statistics.
const specialPlate={...plate,assignments:{...assignments,
 G1:{labels:['Media only'],group:'manual',kind:'special',controlName:'Media only'},
 G2:{labels:['Media only'],group:'manual',kind:'special',controlName:'Media only'},
 G3:{labels:['No cells + reagent'],group:'manual',kind:'special',controlName:'No cells + reagent'}
}};
const special=c.matchReadings(specialPlate,matrix);
assert.equal(special.data.length,36);
assert.equal(special.controls.length,3);
assert.equal(special.unassigned.length,57);
assert.deepEqual(Array.from(special.controls.map(x=>x.replicate)),['R1','R2','R1']);
const separate=c.outputTable(special,'long');
assert.equal(separate.rows.length,36);
assert.deepEqual(Array.from(separate.headers),['Density','Erastin2','Replicate','Read value']);
const ct=c.controlTable(special);
assert.deepEqual(Array.from(ct.headers),['Well','Control label','Replicate','Read value']);
assert.deepEqual(Array.from(ct.rows[0]),['G1','Media only','R1',101073]);
assert.equal(ct.rows.length,3);
const append=c.outputTable(special,'long',{controlPlacement:'bottom'});
assert.equal(append.rows.length,39);
assert.equal(append.headers.at(-1),'Special control');
assert.equal(append.rows.at(-1).at(-1),'No cells + reagent');
const prepend=c.outputTable(special,'long_well',{controlPlacement:'top'});
assert.equal(prepend.rows.length,39);
assert.equal(prepend.rows[0].at(-2),'G1');
assert.equal(c.outputTable(special,'prism').rows.length,4);
const specialXlsx=Buffer.from(makeXlsx([{name:'Experiment',table:separate},{name:'Special controls',table:ct}]));
assert.equal(specialXlsx.subarray(0,4).toString('hex'),'504b0304');
const missingSpecial=c.matchReadings(specialPlate,{...matrix,plate:{...matrix.plate,G1:null}});
assert(missingSpecial.missing.includes('G1'));
assert.equal(missingSpecial.controls.length,2);


const manualOnly={
 ...plate,
 factors:[{id:'factor1',name:'Dose',values:'0 µM;0.1 µM'},{id:'factor2',name:'',values:''}],
 manualLevelNames:['Cell density','Erastin2','Time'],
 assignments:{
  A1:{labels:[],group:'manual',kind:'normal',manualLevels:['1k','0',null]},
  A2:{labels:[],group:'manual',kind:'normal',manualLevels:['1k','0',null]},
  B1:{labels:[],group:'manual',kind:'normal',manualLevels:['5k','0.05',null]}
 }
};
const manualRead=c.matchReadings(manualOnly,matrix);
assert.deepEqual(Array.from(manualRead.factors),['Cell density','Erastin2']);
assert.equal(manualRead.data.length,3);
assert.deepEqual(Array.from(manualRead.data.map(x=>x.replicate)),['R1','R2','R1']);
assert.deepEqual(Array.from(manualRead.data[0].labels),['1k','0']);
assert.deepEqual(Array.from(c.outputTable(manualRead,'long').headers),['Cell density','Erastin2','Replicate','Read value']);
assert.equal(c.outputTable(manualRead,'prism').rows.length,2);
const mixed={...plate,manualLevelNames:['Density','Drug','Time'],assignments:{...assignments,A1:{...assignments.A1,manualLevels:['10k','0.1',null],group:'manual',kind:'normal'}}};
const mixedOut=c.matchReadings(mixed,matrix);
assert.deepEqual(Array.from(mixedOut.factors),['Density','Drug']);
assert.deepEqual(Array.from(mixedOut.data[0].labels),['10k','0.1']);
assert.equal(mixedOut.data.length,36);
assert.equal(mixedOut.controls.length,0);

console.log('Plate reader parsing, matching, CSV and XLSX tests passed');