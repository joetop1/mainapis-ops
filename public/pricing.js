export function batchPrices(costs,mode,rawValue,ending='none'){
  if(!Array.isArray(costs)||!costs.length)throw Error('请先添加规格');
  if(!['fixed','add','percent','multiply'].includes(mode))throw Error('请选择定价方式');
  if(!['none','nine'].includes(ending))throw Error('请选择有效的售价尾数方式');
  if(String(rawValue).trim()==='')throw Error('请填写定价数值');
  const value=Number(rawValue);
  if(!Number.isFinite(value)||value<0)throw Error('定价数值必须是非负数');
  return costs.map(raw=>{
    const cost=Number(raw);
    if(mode!=='fixed'&&(String(raw).trim()===''||!Number.isFinite(cost)||cost<0))throw Error('请先补全所有规格的有效成本');
    const amount=mode==='fixed'?value:mode==='add'?cost+value:mode==='multiply'?cost*value:cost*(1+value/100);
    let price=Math.round((amount+Number.EPSILON*Math.max(1,amount))*100)/100;
    if(!Number.isFinite(price)||price<=0||price>99999999)throw Error('计算后的售价必须在 0.01–99999999 元之间');
    if(ending==='nine'){price=Math.ceil(amount-0.9-Number.EPSILON*Math.max(1,amount)*4)+0.9;if(price>99999999)throw Error('尾数调整后的售价超出上限');}
    return price.toFixed(2);
  });
}

export function batchCosts(costs,rawBase,rawFreight='0',scope='missing'){
 if(!Array.isArray(costs)||!costs.length)throw Error('请先添加 SKU 规格');
 if(!['missing','all'].includes(scope))throw Error('请选择有效的成本应用范围');
 const cents=(raw,name)=>{const value=String(raw).trim();if(!/^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(value))throw Error(name+'请填写非负金额，最多两位小数');const number=Number(value);if(!Number.isFinite(number)||number>99999999)throw Error(name+'超出金额上限');return Math.round(number*100);};
 const sum=cents(rawBase,'采购单价')+cents(String(rawFreight).trim()||'0','每件分摊运费');if(sum>9999999900)throw Error('合计成本超出金额上限');
 const unitCost=(sum/100).toFixed(2);let changed=0;
 const values=costs.map(raw=>{const value=String(raw).trim();if(value&&(!Number.isFinite(Number(value))||Number(value)<0))throw Error('规格成本无效，请先核对');if(scope==='all'||!value||Number(value)===0){changed++;return unitCost;}return String(raw);});
 return {values,unitCost,changed};
}
