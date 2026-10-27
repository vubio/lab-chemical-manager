'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync('github_sync.js','utf8');
const registry=new Map();
const storage=()=>({map:new Map(),getItem(k){return this.map.get(k)||null},setItem(k,v){this.map.set(k,String(v))},removeItem(k){this.map.delete(k)}});
const env={
 window:{addEventListener(){}},
 document:{readyState:'loading',addEventListener(k,fn){registry.set(k,fn)}},
 localStorage:storage(),sessionStorage:storage(),
 TextEncoder,TextDecoder,Uint8Array,Math,Date,JSON,String,Number,console,
 btoa:s=>Buffer.from(s,'binary').toString('base64'),
 atob:s=>Buffer.from(s,'base64').toString('binary'),
 setTimeout,clearTimeout
};
vm.createContext(env);
vm.runInContext(source,env,{filename:'github_sync.js'});
const api=env.window.LabChemGithubSyncCore;
for(const name of ['digest','decision','validateCloud','hasContent','encodeUtf8','decodeUtf8'])assert.equal(typeof api[name],'function',name);
const empty={chemicals:{version:1,chemicals:[],history:[],templates:[]},plates:{draft:null,saved:[]}};
const withHistory={chemicals:{version:1,chemicals:[],history:[{id:'h1',name:'Erastin2',kind:'dosing'}],templates:[]},plates:{draft:null,saved:[]}};
const withPlate={chemicals:empty.chemicals,plates:{draft:{name:'New experiment',assignments:{A1:{labels:['Media only'],kind:'special'}},savedAt:null},saved:[]}};
assert.equal(api.hasContent(empty),false);
assert.equal(api.hasContent(withHistory),true);
assert.equal(api.hasContent(withPlate),true);
assert.equal(api.decision(empty,withHistory,{},'sha-remote'),'load','fresh device retrieves populated cloud');
assert.equal(api.decision(withHistory,empty,{},'sha-seed'),'upload','first populated device uploads data');
assert.equal(api.decision(withHistory,withHistory,{},'sha-cloud'),'conflict','independently populated devices cannot silently overwrite');
const base=api.digest(withHistory);
assert.equal(api.decision(withHistory,withHistory,{baseSha:'s1',baseDigest:base,dirty:false},'s1'),'synced');
assert.equal(api.decision(withPlate,withHistory,{baseSha:'s1',baseDigest:base,dirty:true},'s1'),'upload');
assert.equal(api.decision(withHistory,withPlate,{baseSha:'s1',baseDigest:base,dirty:false},'s2'),'load','remote changed but local clean');
assert.equal(api.decision(withPlate,withHistory,{baseSha:'s1',baseDigest:base,dirty:true},'s2'),'conflict','two device edits trigger conflict');
assert.throws(()=>api.validateCloud({schema:2,...empty}),/Unsupported/);
assert.throws(()=>api.validateCloud({schema:1,chemicals:empty.chemicals,plates:{draft:{},saved:'bad'}}),/Invalid/);
assert.equal(api.validateCloud({schema:1,...empty}).schema,1);
const original='µM — tế bào 癌症 03_Calculator';
assert.equal(api.decodeUtf8(api.encodeUtf8(original)),original,'UTF-8 GitHub file content must roundtrip');
const baseFactorDraft={...empty,plates:{draft:{name:'New experiment',assignments:{},selection:[],rowNotes:{},colNotes:{},notes:'',factors:[{name:'Density',values:'1k;5k;10k'}]},saved:[]}};
assert.equal(api.hasContent(baseFactorDraft),true,'draft-only experimental factor edits are protected');
console.log('GitHub sync branch, UTF-8, merge safety, first use, and draft preservation passed');
