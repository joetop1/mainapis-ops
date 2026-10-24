// 1688 official assistant TSV/CSV export. No inferred variants, stock or selling prices.
export function parseOfficialExport(text){
 if(typeof text!=='string'||text.length>2*1024*1024)throw Error('表格内容请小于 2 MB');
 text=text.replace(/^\uFEFF/,'').replace(/^[\r\n]+|[\r\n]+$/g,'');
 const first=text.split(/\r?\n/,1)[0],delimiter=first.includes('\t')||text.includes('\t')?'\t':',';
 const rows=[];let row=[],cell='',quoted=false;
 for(let i=0;i<=text.length;i++){
  const c=text[i];
  if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else if(quoted||cell==='')quoted=!quoted;else cell+=c;}
  else if(!quoted&&(c===delimiter||c==='\n'||c===undefined)){row.push(cell.trim());cell='';if(c!==delimiter){if(row.some(Boolean))rows.push(row);row=[];if(rows.length>101)throw Error('每次最多导入 100 件商品');}}
  else if(c!==undefined&&!(c==='\r'&&!quoted))cell+=c;
 }
 if(quoted)throw Error('表格引号未闭合，请从 Excel 重新复制完整表格');
 let headers=rows.shift()||[];
 // Chat or clipboard can collapse only the header tabs to spaces.
 if(headers.length===1)headers=headers[0].split(/\s+/);
 if(!headers.includes('商品标题')||(!headers.includes('宝贝链接')&&!headers.includes('宝贝ID')))throw Error('请包含表头：商品标题、宝贝链接或宝贝ID；支持复制表格或 TSV/CSV 文件');
 if(!rows.length)throw Error('表格中没有商品行');
 return rows.map((values,index)=>{
  if(values.length!==headers.length)throw Error('第 '+(index+1)+' 件商品列数与表头不一致，请保留制表符或 CSV 格式');
  const get=name=>values[headers.indexOf(name)]||'';
  const id=get('宝贝ID'),link=get('宝贝链接');
  const source_url=link||(/^\d+$/.test(id)?'https://detail.1688.com/offer/'+id+'.html':'');
  if(link&&id){try{if(new URL(link).pathname!=='/offer/'+id+'.html')throw Error();}catch{throw Error('第 '+(index+1)+' 件商品链接与宝贝 ID 不一致');}}
  return {source_url,title:get('商品标题'),category:'',description:'',images:get('图片地址')?[get('图片地址')]:[],skus:[],
   sourcing:{purchase_price:get('价格'),dropship_price:get('代发价'),category:get('类目'),tags:get('标签'),supplier_sales:get('销量'),shipping_time:get('发货时间'),listed_at:get('上架时间')}};
 });
}
