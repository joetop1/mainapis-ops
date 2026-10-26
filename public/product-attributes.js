// Product facts only. Supply-chain, platform and merchant metadata is never published.
export function normalizeProductAttributes(input){
 if(input===undefined||input===null)return [];
 if(!Array.isArray(input)||input.length>100)throw Error('产品参数必须为数组，最多 100 项');
 const blocked=/下游|销售地区|销售区域|销售平台|适销|出口|跨境|专供|货源|代发|分销|起批|起订|混批|批发|供应商|供应链|店铺|商家|厂家|厂商|公司|经营|成交|交易|销量|发货|供货|加工定制|上架时间|运费|报价|价格|库存|优惠|平台|授权.*品牌|自主品牌|外贸|foreign|export|supplier|seller|wholesale|dropship|marketplace/i;
 const output=[],seen=new Set();
 for(const row of input){
  if(!row||typeof row.name!=='string'||typeof row.value!=='string')throw Error('产品参数需包含名称和文本内容');
  const name=row.name.replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim();
  const value=row.value.replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim();
  if(!name||!value||blocked.test(name))continue;
  if(name.length>60||value.length>1000)throw Error('产品参数名称最多 60 字，内容最多 1000 字');
  const key=name+'\0'+value;if(seen.has(key))continue;seen.add(key);output.push({name,value});
 }
 return output;
}
export function descriptionWithAttributes(description,attributes){
 const rows=normalizeProductAttributes(attributes);
 return rows.length?'产品基本信息\n'+rows.map(row=>row.name+'：'+row.value).join('\n')+(description?'\n\n'+description:''):String(description||'');
}
export function productAttributesFromJSON(source,data){
 const canonical=value=>{const u=new URL(value);if(u.protocol!=='https:'||u.hostname!=='detail.1688.com'||!/^\/offer\/\d+\.html$/.test(u.pathname))throw Error('来源链接无效');return u.origin+u.pathname;};
 if(data?.products?.length!==1||canonical(data.products[0].source_url)!==canonical(source))throw Error('请选择当前商品来源对应的单件采集文件');
 const rows=normalizeProductAttributes(data.products[0].attributes);
 if(!rows.length)throw Error('采集文件未包含可用的产品参数，请使用新版插件重新采集');
 return rows;
}
