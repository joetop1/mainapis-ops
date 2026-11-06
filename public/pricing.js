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
