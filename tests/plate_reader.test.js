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


// Manual-only workflow must read exclusively manual levels, never hidden generated labels.
const manualCombo={...plate,manualLevelNames:['Cell density','AA (µM)','Time'],assignments:{
 A1:{labels:['Old generated A','Old generated B'],group:'manual',kind:'normal',manualLevels:['1k','0',null]},
 A2:{labels:['Old generated A','Old generated B'],group:'manual',kind:'normal',manualLevels:['1k','0',null]},
 A3:{labels:['Old generated A','Old generated B'],group:'manual',kind:'normal',manualLevels:['1k','25',null]},
 B1:{labels:['Old generated A','Old generated B'],group:'manual',kind:'normal',manualLevels:['5k','0',null]},
 B2:{labels:['Old generated A','Old generated B'],group:'manual',kind:'normal',manualLevels:['5k','25',null]},
 C1:{labels:['old auto','reading'],group:'generated'},
 G1:{labels:['Media only'],group:'manual',kind:'special',controlName:'Media only'}
}};
const manualCore=c.matchManualReadings;
assert.equal(typeof manualCore,'function');
const manualResults=manualCore(manualCombo,matrix);
assert.deepEqual(Array.from(manualResults.factors),['Cell density','AA (µM)']);
assert.deepEqual(Array.from(manualResults.data.map(x=>x.well)),['A1','A2','A3','B1','B2']);
assert.deepEqual(Array.from(manualResults.data[0].labels),['1k','0']);
assert.deepEqual(Array.from(manualResults.data.map(x=>x.replicate)),['R1','R2','R1','R1','R1']);
assert.equal(manualResults.data.length,5);
assert.equal(manualResults.controls.length,1);
assert.equal(manualResults.controls[0].label,'Media only');
assert.equal(manualResults.unassigned.length,90);
assert.equal(manualResults.incomplete.length,0);
const manuallyLong=c.outputTable(manualResults,'long');
assert.deepEqual(Array.from(manuallyLong.headers),['Cell density','AA (µM)','Replicate','Read value']);
assert.deepEqual(Array.from(manuallyLong.rows[0]),['1k','0','R1',101001]);
assert.equal(c.outputTable(manualResults,'prism').rows.length,2);
assert.equal(c.outputTable(manualResults,'wide').rows.length,2);
assert.equal(c.outputTable(manualResults,'matrix').rows.length,8);
const manuallyExcel=Buffer.from(makeXlsx([{name:'Manual levels',table:manuallyLong},{name:'Special controls',table:c.controlTable(manualResults)}]));
assert.equal(manuallyExcel.subarray(0,4).toString('hex'),'504b0304');
assert(manuallyExcel.includes(Buffer.from('xl/workbook.xml')));
assert(c.makeCSV(manuallyLong).includes('Cell density,AA (µM),Replicate,Read value'));
assert.deepEqual(Array.from(c.matchReadings(manualCombo,matrix).data.map(x=>x.well)),['A1','A2','A3','B1','B2','C1'],
  'original match button still accepts the complete labeled plate');
const incompleteManual={...manualCombo,assignments:{
 A1:{labels:[],kind:'normal',group:'manual',manualLevels:['1k',null,'24h']},
 A2:{labels:[],kind:'normal',group:'manual',manualLevels:['1k','25',null]},
 G1:manualCombo.assignments.G1
}};
const partialResults=manualCore(incompleteManual,matrix);
assert.deepEqual(Array.from(partialResults.factors),['Cell density','AA (µM)','Time']);
assert.deepEqual(Array.from(partialResults.incomplete),['A1','A2']);
assert.deepEqual(Array.from(partialResults.data[0].labels),['1k','','24h']);
assert.deepEqual(Array.from(partialResults.data[1].labels),['1k','25','']);
assert.equal(partialResults.controls.length,1);
assert.throws(()=>manualCore({...plate,assignments:{A1:{labels:['0'],kind:'normal',group:'generated'}}},matrix),/no manual/i);
assert.equal(manualCore({...manualCombo,factorDraftStale:true},matrix).data.length,5,
 'manual-only matching does not depend on stale automatic-factor drafts');
const missingManualGrid={...matrix,plate:{...matrix.plate,A1:null}};
assert(manualCore(manualCombo,missingManualGrid).missing.includes('A1'));


// Regression: a 96-well HSC-to-Huh7 ratio × Retinol × AA plate uses
// manual overrides for levels 1 and 3 but retains the *visible* generated
// Retinol concentration at level 2. Manual matching must export ALL THREE.
const threeLevelAssignments={};
const ratios=['0/100','1/9','1/3','1/1'];
for(let r=0;r<8;r++)for(let col=0;col<(r===0||r===4?4:12);col++){
 const ratio=ratios[r%4];
 const retinol=(r===0||r===4||col<4)?'0':col<8?'2.5':'5';
 const aa=r<4?'Ctrl':'AA 100 µM';
 threeLevelAssignments[well(r,col)]={
  kind:'normal',group:'manual',
  labels:[ratio,retinol,aa],
  manualLevels:[ratio,null,aa]
 };
}
const threeFactorPlate={
 format:'96',
 name:'HSC-T6 / Huh7 ratio x Retinol x AA',
 manualLevelNames:['HSC-to-Huh7 ratio','Retinol (µM)','AA'],
 factors:[{name:'HSC-to-Huh7 ratio',values:'0/100;1/9;1/3;1/1'},
          {name:'Retinol (µM)',values:'0;2.5;5'},
          {name:'AA',values:'Ctrl;AA 100 µM'}],
 assignments:threeLevelAssignments
};
const three=c.matchManualReadings(threeFactorPlate,matrix);
assert.equal(three.data.length,80);
assert.equal(three.unassigned.length,16);
assert.equal(three.missing.length,0);
assert.equal(three.incomplete.length,0,'generated Retinol values are visible and must not be marked missing');
assert.deepEqual(Array.from(three.usedLevels),[0,1,2]);
assert.deepEqual(Array.from(three.factors),['HSC-to-Huh7 ratio','Retinol (µM)','AA']);
assert.deepEqual(Array.from(three.data[0].labels),['0/100','0','Ctrl']);
const b1=three.data.find(x=>x.well==='B1'),b5=three.data.find(x=>x.well==='B5');
assert.deepEqual(Array.from(b1.labels),['1/9','0','Ctrl']);
assert.deepEqual(Array.from(b5.labels),['1/9','2.5','Ctrl']);
assert.equal(b1.replicate,'R1');
assert.equal(b5.replicate,'R1','each Retinol concentration starts its own replicate count');
assert.equal(three.data.find(x=>x.well==='B8').replicate,'R4');
assert.equal(three.data.find(x=>x.well==='F5').labels[2],'AA 100 µM');
const threeLong=c.outputTable(three,'long');
assert.deepEqual(Array.from(threeLong.headers),['HSC-to-Huh7 ratio','Retinol (µM)','AA','Replicate','Read value']);
assert.equal(threeLong.rows.length,80);
assert.deepEqual(Array.from(threeLong.rows[0]),['0/100','0','Ctrl','R1',101001]);
assert.equal(threeLong.rows.find(x=>x[0]==='1/9'&&x[1]==='2.5'&&x[2]==='Ctrl')[3],'R1');
assert(c.makeCSV(threeLong).startsWith('HSC-to-Huh7 ratio,Retinol (µM),AA,Replicate,Read value'));
assert.equal(c.outputTable(three,'wide').rows.length,4);
assert.throws(()=>c.outputTable(three,'prism'),/requires exactly two factors/i);
const threeExcel=Buffer.from(makeXlsx([{name:'Long data',table:threeLong},{name:'Full plate',table:c.outputTable(three,'matrix')}]));
assert.equal(threeExcel.subarray(0,4).toString('hex'),'504b0304');
assert(threeExcel.includes(Buffer.from('xl/workbook.xml')));
assert(threeExcel.includes(Buffer.from('Retinol')));

console.log('Plate reader parsing, matching, CSV and XLSX tests passed');