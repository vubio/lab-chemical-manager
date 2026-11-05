'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('plate.js','utf8');
const sandbox={window:{},document:{readyState:'loading',addEventListener:()=>{}},console,Set,Array,Date,Number,String,Math,JSON};
vm.runInNewContext(source,sandbox);
const {place,combinations,SHAPES,selectionRect,applySelection}=sandbox.window.PlateLayoutCore;
const coords=(r,c)=>{const out=[];for(let i=0;i<r;i++)for(let j=1;j<=c;j++)out.push(String.fromCharCode(65+i)+j);return out};
const cases=[0,.05,.1,.2].map((dose,i)=>({key:String(i),replicates:10,parts:[{id:'dose',name:'Dose',value:dose+' µM'}]}));
const a=place(coords(8,12),cases,8,12);
for(let i=0;i<4;i++)for(let j=1;j<=10;j++)assert.equal(a[String.fromCharCode(65+i)+j].labels[0],cases[i].parts[0].value);
assert.equal(Object.keys(a).length,40);
assert.equal(a['A11'],undefined);
const b=place(coords(8,10).filter(w=>!/^E|^F|^G/.test(w)),cases,8,12);
assert.equal(Object.keys(b).length,40);
assert(!Object.keys(b).some(x=>/^E|^F|^G/.test(x)));
assert.deepEqual(Array.from(selectionRect('A1','C3')),['A1','A2','A3','B1','B2','B3','C1','C2','C3']);
const sel=applySelection(['A1','A2'],'add',['B5']);
assert.equal(sel.length,3);
assert.equal(applySelection(['A1'],'subtract',sel).length,2);
assert.throws(()=>place(coords(2,3),cases,2,3),/Need/);
const combos=combinations([{id:'a',name:'Cell',options:['A','B']},{id:'b',name:'Dose',options:['0','1']}]);
assert.equal(combos.length,4);
assert.equal(Object.keys(place(coords(4,6),combos.map(x=>({...x,replicates:3})),4,6)).length,12);
for(const n of [6,12,24,48,96,384])assert.equal(SHAPES[n][0]*SHAPES[n][1],n);

const cleared= sandbox.window.PlateLayoutCore.clearSelectedAssignments(
 {A1:{labels:['Media only'],kind:'special'},A2:{labels:['0.05']},B1:{labels:['Keep']}},
 ['A1','A2','A2','C1']
);
assert.equal(cleared.count,2);
assert.equal(cleared.assignments.A1,undefined);
assert.equal(cleared.assignments.A2,undefined);
assert.equal(cleared.assignments.B1.labels[0],'Keep');
assert.equal(cleared.assignments.C1,undefined);
const none=sandbox.window.PlateLayoutCore.clearSelectedAssignments(cleared.assignments,['A1','C1']);
assert.equal(none.count,0);
assert.equal(none.assignments.B1.labels[0],'Keep');


// Compact headers must not reserve space for empty note inputs.
const headerHTML= sandbox.window.PlateLayoutCore.axisHeaderHTML;
assert.equal(typeof headerHTML,'function');
const blankRow=headerHTML('row','A','');
assert.match(blankRow,/data-axis="row"/);
assert.match(blankRow,/data-axis-key="A"/);
assert(!blankRow.includes('<input'));
assert(!blankRow.includes('pl-axis-note"'));
const blankColumn=headerHTML('column',2,'');
assert.match(blankColumn,/data-axis-key="2"/);
assert(!blankColumn.includes('<input'));
const noted=headerHTML('row','B','No cells');
assert.match(noted,/pl-axis-noted/);
assert.match(noted,/No cells/);
assert.match(noted,/pl-axis-note/);
assert(!noted.includes('<input'));
const sanitized=headerHTML('column',4,'Media <only>');
assert.match(sanitized,/Media &lt;only&gt;/);
assert(!sanitized.includes('Media <only>'));


const axisGridStart=sandbox.window.PlateLayoutCore.plateAxisGridStart;
const editableAxis=sandbox.window.PlateLayoutCore.axisInlineHeaderHTML;
assert.equal(typeof axisGridStart,'function');
assert.equal(typeof editableAxis,'function');
assert.equal(axisGridStart(false,12,{2:'Control'}),'','Hidden notes must remove all row/column headers from the grid');
const visibleGrid=axisGridStart(true,3,{2:'No cells'});
assert(visibleGrid.includes('pl-corner'));
assert.equal((visibleGrid.match(/data-column-note=/g)||[]).length,3);
assert(visibleGrid.includes('No cells'));
assert(!axisGridStart(false,3,{}).includes('pl-axis-header'));
assert(editableAxis('row','B','Media only').includes('data-row-note="B"'));
assert(editableAxis('row','B','Media only').includes('value="Media only"'));
assert(editableAxis('column',5,'').includes('placeholder="Note"'));
const escapedNote=editableAxis('column',3,'A < B & C');
assert(escapedNote.includes('A &lt; B &amp; C'));


const levelCore=sandbox.window.PlateLayoutCore;
const baseLabels={A1:{labels:['0 µM','AA 0'],group:'generated',kind:'normal'},A2:{labels:['0 µM','AA 25'],group:'generated',kind:'normal'},B1:{labels:['Media only'],kind:'special',group:'manual'}};
const afterLevelOne=levelCore.assignManualLevels(baseLabels,['A1','A2','A2'],0,'1k');
assert.deepEqual(Array.from(levelCore.effectiveLabels(afterLevelOne.A1)),['1k','AA 0']);
assert.deepEqual(Array.from(levelCore.effectiveLabels(afterLevelOne.A2)),['1k','AA 25']);
assert.equal(baseLabels.A1.labels[0],'0 µM','manual override does not mutate original assignments');
const afterLevelTwo=levelCore.assignManualLevels(afterLevelOne,['A1'],1,'50 µM');
assert.deepEqual(Array.from(levelCore.effectiveLabels(afterLevelTwo.A1)),['1k','50 µM']);
assert.deepEqual(Array.from(levelCore.effectiveLabels(afterLevelTwo.A2)),['1k','AA 25']);
const clearedLevel=levelCore.assignManualLevels(afterLevelTwo,['A1'],0,'');
assert.deepEqual(Array.from(levelCore.effectiveLabels(clearedLevel.A1)),['0 µM','50 µM']);
const firstManual=levelCore.assignManualLevels({},['D1','D2'],0,'5k');
assert.deepEqual(Array.from(levelCore.effectiveLabels(firstManual.D1)),['5k']);
const manualAndSecondary=levelCore.assignManualLevels(firstManual,['D1'],1,'100');
assert.deepEqual(Array.from(levelCore.effectiveLabels(manualAndSecondary.D1)),['5k','100']);
assert.equal(manualAndSecondary.D1.kind,'normal');
assert.equal(levelCore.effectiveLabels(baseLabels.B1)[0],'Media only');
assert.deepEqual(Array.from(levelCore.manualLevelUsage(manualAndSecondary)),[true,true,false]);
assert.equal(levelCore.assignManualLevels(manualAndSecondary,['D2'],0,'').D2,undefined,'empty manual-only wells removed when level cleared');


const manualClipboardLabel=levelCore.labelsHTML({labels:['Old Dose','Old Drug'],kind:'normal',manualLevels:['1k','25 µM']});
assert(manualClipboardLabel.includes('1k'));
assert(manualClipboardLabel.includes('25 µM'));
assert(manualClipboardLabel.includes('#A41E22'));
assert(manualClipboardLabel.includes('#1E5196'));
assert(!manualClipboardLabel.includes('Old Dose'));
assert(!manualClipboardLabel.includes('Old Drug'));


// Move a rectangle as a geometric shape, rather than as a linear row-major run.
const shapeWells=[];
const shapeMap={A1:{labels:['Unrelated guard']},C4:{labels:['Unrelated at C4']},C6:{labels:['Unrelated at C6']}};
for(let r=4;r<8;r++)for(let c=1;c<=5;c++){
 const well=String.fromCharCode(65+r)+c;
 shapeWells.push(well);
 shapeMap[well]={labels:[well],manualLevels:[well,'25']};
}
assert.equal(levelCore.selectionGeometry(shapeWells,12),'4×5 rectangle');
const firstShape=levelCore.moveWellShape(shapeMap,shapeWells,'E1','C3',8,12);
assert.equal(firstShape.sourceCount,20);
assert.equal(firstShape.selection.length,20);
assert.equal(levelCore.selectionGeometry(firstShape.selection,12),'4×5 rectangle');
assert.equal(firstShape.assignments.C3.labels[0],'E1');
assert.equal(firstShape.assignments.F7.labels[0],'H5');
assert.equal(firstShape.assignments.C3.manualLevels[0],'E1');
assert.equal(firstShape.assignments.A1.labels[0],'Unrelated guard');
assert.equal(Object.keys(firstShape.assignments).length,Object.keys(shapeMap).length);
assert.equal(firstShape.method,'insert','other labels shift instead of swapping');
assert.equal(firstShape.displaced.length,2);
assert(Object.values(firstShape.assignments).some(v=>v.labels[0]==='Unrelated at C4'));
assert(Object.values(firstShape.assignments).some(v=>v.labels[0]==='Unrelated at C6'));
for(const w of shapeWells)assert.equal(shapeMap[w].labels[0],w,'original assignments unchanged before release');
const shapeAgain=levelCore.moveWellShape(shapeMap,shapeWells,'E1','E1',8,12);
assert.equal(shapeAgain.method,'unchanged');
assert.throws(()=>levelCore.moveWellShape(shapeMap,shapeWells,'E1','H9',8,12),/outside.*plate/i);
assert.equal(Object.keys(shapeMap).length,23,'invalid preview does not mutate the plate');
// Sparse selections keep gaps and their relative row/column offsets.
const sparseSelection=['D1','D2','D3','E1','E2','E3'];
const sparseMap={D1:{labels:['D1']},D3:{labels:['D3']},E2:{labels:['E2']},H12:{labels:['Guard']}};
const sparseResult=levelCore.moveWellShape(sparseMap,sparseSelection,'D1','C2',8,12);
assert.deepEqual(Array.from(sparseResult.selection),['C2','C3','C4','D2','D3','D4']);
assert.equal(sparseResult.sourceCount,3);
assert.equal(sparseResult.assignments.C2.labels[0],'D1');
assert.equal(sparseResult.assignments.C4.labels[0],'D3');
assert.equal(sparseResult.assignments.D3.labels[0],'E2');
assert.equal(sparseResult.assignments.H12.labels[0],'Guard');
assert.equal(Object.keys(sparseResult.assignments).length,4);
assert.throws(()=>levelCore.moveWellShape({},sparseSelection,'D1','C2',8,12),/labeled/);
// The occupied destination is never overwritten when no forward free cell exists.
const fullMap={};for(const w of coords(8,12))fullMap[w]={labels:[w]};
assert.throws(()=>levelCore.moveWellShape(fullMap,shapeWells,'E1','E2',8,12),/Not enough free wells/i);
assert.equal(fullMap.H12.labels[0],'H12');
assert.equal(levelCore.selectionGeometry(['A1','A3','C1'],12),'grouped selection');


const indexHTML=fs.readFileSync('index.html','utf8');
const plateScript=fs.readFileSync('plate.js','utf8');
assert(indexHTML.includes('id="pl-quick-save"'));
assert(indexHTML.includes('id="pl-quick-saved"'));
assert(indexHTML.includes('id="pl-quick-load"'));
assert(indexHTML.includes('id="pl-saved"'), 'existing lower saved-layout selector remains');
assert(indexHTML.includes('id="pl-save"'), 'existing save action remains');
assert(indexHTML.includes('id="pl-load"'), 'existing load action remains');
assert(plateScript.includes("$('pl-quick-save').addEventListener('click',()=>$('pl-save').click())"));
assert(plateScript.includes("$('pl-load').click()"));
assert(plateScript.includes("if(quick)quick.innerHTML=options"));
assert(plateScript.includes("if(quick)quick.value=selected"));
assert(plateScript.includes("if($('pl-quick-saved'))$('pl-quick-saved').value=item.id"));
assert(plateScript.includes("saved.unshift(item)"), 'new versions are retained');


const quickNameHTML=fs.readFileSync('index.html','utf8');
const quickNameJS=fs.readFileSync('plate.js','utf8');
assert(quickNameHTML.includes('id="pl-quick-name"'), 'quick save has a layout-name field');
assert(quickNameHTML.indexOf('id="pl-quick-name"')<quickNameHTML.indexOf('id="pl-quick-save"'), 'name field precedes save');
assert(quickNameJS.includes("$('pl-quick-name').addEventListener('input'"), 'sidebar name is editable');
assert(quickNameJS.includes("$('pl-title').value=e.target.value"), 'quick name updates original name field');
assert(quickNameJS.includes("if($('pl-quick-name'))$('pl-quick-name').value=state.name"), 'loaded layouts repopulate quick name');
assert(quickNameJS.includes("Enter a layout name beside Save layout before saving."), 'empty names rejected');
assert(quickNameJS.includes("if(e.key==='Enter'){e.preventDefault();$('pl-quick-save').click()}"), 'enter can save');
assert(quickNameJS.includes("const name=String($('pl-quick-name')?.value"), 'save reads quick name');


// Merged note ranges on both axes, including legacy notes and copy semantics.
const axisCore=sandbox.window.PlateLayoutCore;
const rowMerge=axisCore.mergeAxisRange([],{},'row',0,3,8);
assert.deepEqual(Array.from(rowMerge.map(m=>[m.start,m.end,m.note])),[[0,3,'']]);
assert.equal(axisCore.axisRangeText('row',0,3),'A–D');
assert.equal(axisCore.axisRangeText('column',0,3),'1–4');
assert.equal(axisCore.mergeAxisRange([], {A:'24h',B:'24h'},'row',0,3,8)[0].note,'24h');
assert.equal(axisCore.mergeAxisRange([], {A:'24h',B:'48h'},'row',0,3,8)[0].note,'','individual notes stay preserved if notes differ');
assert.throws(()=>axisCore.mergeAxisRange(rowMerge,{},'row',2,4,8),/Unmerge/);
assert.throws(()=>axisCore.mergeAxisRange([],{},'row',0,8,8),/consecutive/);
const twoGroups=axisCore.mergeAxisRange(rowMerge,{},'row',4,7,8);
assert.equal(twoGroups.length,2);
const savedRowMerge=[{start:0,end:3,note:'24h'},{start:4,end:7,note:'48h'}];
const restored=axisCore.unmergeAxisRanges(savedRowMerge,{A:'Original A'},'row',[0,1,2,3],8);
assert.deepEqual(Array.from(restored.merges.map(m=>m.note)),['48h']);
assert.deepEqual(['A','B','C','D'].map(x=>restored.notes[x]),['Original A','24h','24h','24h']);
assert.throws(()=>axisCore.unmergeAxisRanges(rowMerge,{},'row',[0,1],8),/merged header/);
assert.equal(axisCore.normalizeAxisMerges([{start:4,end:7,note:'48h'},{start:0,end:3,note:'24h'}],8).length,2);
assert.equal(axisCore.normalizeAxisMerges([{start:0,end:3},{start:3,end:6}],8).length,1);
const wideMerged=axisCore.plateAxisGridStart(true,12,{},[{start:0,end:3,note:'Vehicle control'}]);
assert(wideMerged.includes('data-merged-axis="column"'));
assert(wideMerged.includes('data-merged-start="0"'));
assert(wideMerged.includes('grid-column:2/span 4'));
assert(wideMerged.includes('1–4'));
assert.equal((wideMerged.match(/data-column-note=/g)||[]).length,8);
const mergedRowHeader=axisCore.axisInlineHeaderHTML('row','A','24h',{index:0,span:4,label:'A–D',placement:'grid-column:1;grid-row:2/span 4'});
assert(mergedRowHeader.includes('data-merged-axis="row"'));
assert(mergedRowHeader.includes('A–D'));
assert(mergedRowHeader.includes('grid-row:2/span 4'));
const plateSource=fs.readFileSync('plate.js','utf8');
const htmlSource=fs.readFileSync('index.html','utf8');
assert(htmlSource.includes('id="pl-merge-axis"')&&htmlSource.includes('id="pl-unmerge-axis"'));
assert(plateSource.includes('rowspan="')&&plateSource.includes('colspan="'),'OneNote copy preserves merged headers as table spans');
assert(plateSource.includes('state.rowNoteMerges')&&plateSource.includes('state.colNoteMerges'),'merge ranges saved in plate layout data');

console.log('Plate layout allocation and selection tests passed');
