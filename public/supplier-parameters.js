// Only unpack known supplier compound fields with explicit labels.
const compound=/^[（(]?(?:产品规格|产品参数|产品属性|商品规格|商品参数|商品属性)[）)]?$/;
const instruction=/^(?:使用方法|使用说明|使用方式|用法|注意事项|警告)$/;
const named=/^([^：:\s][^：:]{0,29})[：:]\s*(.+)$/s;
export function splitSupplierParameters(attributes=[],description=''){
 const rows=[],notes=[];
 let changed=false;
 for(const row of attributes){
  if(!compound.test(row.name.trim())){rows.push(row);continue;}
  const parts=row.value.split(/(?:\s*[•●▪·]\s*|\n+|\s+\/\s+(?=[^：:\n]{1,30}[：:]))/).map(s=>s.trim()).filter(Boolean);
  if(parts.length<2||parts.filter(part=>named.test(part)).length<2){rows.push(row);continue;}
  const next=[],detail=[];
  let inInstructions=false;
  for(const part of parts){
   const match=part.match(named);
   if(!inInstructions&&match&&instruction.test(match[1].trim()))inInstructions=true;
   if(inInstructions||!match){detail.push(part);continue;}
   const name=match[1].trim(),value=match[2].trim();
   if([...value].length>120||/[\u{10000}-\u{10FFFF}]/u.test(name+value))detail.push(part);
   else next.push({name,value});
  }
  if(!next.length||rows.length+next.length>100){rows.push(row);continue;}
  changed=true;rows.push(...next);notes.push(...detail);
 }
 const output=[...new Set([description,...notes].filter(Boolean))].join('\n\n');
 if(rows.length>100||output.length>50000)return {attributes,description,changed:false};
 return {attributes:rows,description:output,changed};
}
