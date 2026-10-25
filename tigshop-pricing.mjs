// OPS source amounts are CNY; Tigshop xiaolango.com base currency is EUR.
// The operator supplies EUR per 1 CNY. Never infer a rate from display currency.
export function tigshopPrices(skus,config={}) {
 const {sourceCurrency,targetCurrency,eurPerCny}=config;
 if(sourceCurrency!=='CNY'||targetCurrency!=='EUR')throw Error('Tigshop 必须明确配置人民币转欧元');
 if(typeof eurPerCny!=='number'||!Number.isFinite(eurPerCny)||eurPerCny<=0||eurPerCny>1)throw Error('请配置有效汇率：1 人民币对应的欧元金额');
 if(!Array.isArray(skus)||!skus.length)throw Error('缺少 SKU');
 return skus.map(s=>{
  if(typeof s.price!=='number'||!Number.isFinite(s.price)||s.price<=0||typeof s.cost!=='number'||!Number.isFinite(s.cost)||s.cost<0)throw Error('人民币售价或成本无效');
  const price=Math.round((s.price*eurPerCny+Number.EPSILON)*100)/100;
  const cost=Math.round((s.cost*eurPerCny+Number.EPSILON)*100)/100;
  if(price<=0||!Number.isSafeInteger(Math.round(price*100))||!Number.isSafeInteger(Math.round(cost*100)))throw Error('换算后的欧元金额无效');
  return {...s,price,cost};
 });
}

export const TIGSHOP_FX_URL='https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';
export function parseTigshopFX(xml,clock=new Date()) {
 const date=xml.match(/<Cube\b[^>]*\btime=['"](\d{4}-\d{2}-\d{2})['"]/i)?.[1];
 const cube=xml.match(/<Cube\b[^>]*\bcurrency=['"]CNY['"][^>]*>/i)?.[0];
 const rate=Number(cube?.match(/\brate=['"]([0-9.]+)['"]/i)?.[1]);
 const timestamp=Date.parse(date+'T00:00:00Z');
 const age=clock.getTime()-timestamp;
 if(!date||!Number.isFinite(timestamp)||new Date(timestamp).toISOString().slice(0,10)!==date||!Number.isFinite(rate)||rate<1||rate>100||age< -86400000||age>7*86400000)throw Error('欧洲央行汇率无效或超过七天，请稍后重试');
 return Object.freeze({sourceCurrency:'CNY',targetCurrency:'EUR',eurPerCny:1/rate,cnyPerEur:rate,rateDate:date,fetchedAt:clock.toISOString(),source:TIGSHOP_FX_URL});
}
export async function fetchTigshopFX(fetcher=fetch,clock=new Date()) {
 try {
  const response=await fetcher(TIGSHOP_FX_URL,{redirect:'error',signal:AbortSignal.timeout(15000),headers:{Accept:'application/xml'}});
  if(!response.ok)throw Error();
  const xml=await response.text();
  if(xml.length>100000)throw Error();
  return parseTigshopFX(xml,clock);
 }catch{throw Error('无法读取最新有效人民币兑欧元汇率，未执行价格换算');}
}
