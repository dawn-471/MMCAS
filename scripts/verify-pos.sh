#!/usr/bin/env bash
B="http://localhost:9377"
TABID="6f0a1204-05b1-4f45-b55d-49b6879d326b"
T=$(cygpath -m "$(mktemp -d)")
curl -s -m 15 "$B/tabs/$TABID/snapshot?userId=dev9" -o "$T/snap.json"
node -e '
const fs=require("fs");
const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
const nodes=Array.isArray(j)?j:(j.nodes||j.snapshot||[]);
const seq=nodes.map((n,i)=>[i,n.name||n.role||""]);
const keys=["New Session","MMCAS 总控","MMCAS 任务看板","MMCAS 共享记忆","Settings","New Workspace"];
for(const k of keys){
  const hit=seq.filter(s=>s[1]===k);
  if(hit.length) console.log(k.padEnd(16), "index="+hit[0][0], hit.length>1?"(x"+hit.length+")":"");
}
console.log("总节点数:", nodes.length);
' "$T/snap.json"
rm -rf "$T"
