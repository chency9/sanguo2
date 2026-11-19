import { readFile, writeFile } from 'node:fs/promises';

const csvPath = new URL('../../web-port-research/data/magic.csv', import.meta.url);
const aiPath = new URL('../packages/core/src/native-ai-skills.json', import.meta.url);
const linksPath = new URL('../../web-port-research/evidence/binary/magic-script-links.json', import.meta.url);
const outputPath = new URL('../packages/core/src/native-magic-manifest.json', import.meta.url);

function parseCsvLine(line) {
  const result=[];let value='',quoted=false;
  for(let i=0;i<line.length;i++) {
    const c=line[i];
    if(c==='"'&&quoted&&line[i+1]==='"'){value+='"';i++;}
    else if(c==='"')quoted=!quoted;
    else if(c===','&&!quoted){result.push(value);value='';}
    else value+=c;
  }
  result.push(value);return result;
}

const csv=(await readFile(csvPath,'utf8')).replace(/^\uFEFF/,'').trim().split(/\r?\n/);
const headers=parseCsvLine(csv[0]);
const aiText=(await readFile(aiPath,'utf8')).replace(/^\uFEFF/,'').trim();
const aiRecords=aiText.startsWith('[')?JSON.parse(aiText):[];
const skills=new Map(aiRecords.map(s=>[Number(s.sequence),s]));
const links=JSON.parse(await readFile(linksPath,'utf8'));
const linkBySequence=new Map(links.map(x=>[Number(x.sequence),x]));
const field=(row,name)=>row[headers.indexOf(name)]??'';
const manifest=csv.slice(1).map(line=>{
  if(!line.trim())return null;
  const row=parseCsvLine(line),sequence=Number(field(row,'SEQUENCE'));
  const flags=skills.get(sequence)?.flags??0,attrib=field(row,'ATTRIB'),active=field(row,'ACTIVE');
  const effectType=flags&256?'heal':flags&512?'reinforce':flags&64?'status':flags&48&&/主將/.test(attrib)?'projectile':flags&15?'area':Number(field(row,'ATTACK'))>0?'area':'status';
  const link=linkBySequence.get(sequence);
  return {sequence,name:field(row,'NAME'),mp:Number(field(row,'MP')),power:Number(field(row,'POWER')),
    attack:Number(field(row,'ATTACK')),script:Number(field(row,'SCRIPT')),attrib,active,flags,effectType,
    evidenceLevel:sequence===1||sequence===2?'verified':'inferred',
    scriptSymbol:link?.symbols?.[0]?.name};
}).filter(Boolean);
if(manifest.length!==110||manifest.some((m,i)=>m.sequence!==i+1||!m.script))throw new Error('Expected 110 ordered native magic records');
await writeFile(outputPath,JSON.stringify(manifest,null,2)+'\n','utf8');
console.log(`Wrote ${manifest.length} records to ${outputPath.pathname}`);
