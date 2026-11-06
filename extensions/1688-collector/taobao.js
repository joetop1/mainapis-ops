// Injected into MAIN world: self-contained, reads only already-loaded product data.
export function collectTaobao(diagnostic=false){
 let u;try{u=new URL(location.href);}catch{return {error:'商品地址无效'};}
 const id=u.searchParams.get('id');if(u.protocol!=='https:'||u.hostname!=='item.taobao.com'||u.pathname!=='/item.htm'||!/^\d+$/.test(id||''))return {error:'请打开淘宝商品详情页 item.taobao.com/item.htm?id=数字'};
 const warnings=[],schemas=[],seen=new WeakSet(),candidates=[];let visited=0;
 const clean=(v,n=200)=>typeof v==='string'?v.replace(/\s+/g,' ').trim().slice(0,n):'';
 const image=v=>{if(typeof v!=='string')return '';try{const a=new URL(v.startsWith('//')?'https:'+v:v);return a.protocol==='https:'&&!a.username&&!a.password&&/(^|\.)(alicdn\.com|taobaocdn\.com|tbcdn\.cn)$/.test(a.hostname)?a.href:'';}catch{return '';}};
 const scan=(o,path,depth=0)=>{
  if(!o||typeof o!=='object'||seen.has(o)||depth>12||++visited>12000)return;seen.add(o);
  const itemId=String(o.item?.itemId||o.item?.itemNumId||o.itemId||o.itemNumId||'');if(itemId&&itemId!==id)return;
  if(diagnostic&&schemas.length<60&&(/item|sku|data|props/i.test(path)||depth<2))schemas.push({path,keys:Object.keys(o).filter(k=>!/token|cookie|auth|user|seller|secret|password/i.test(k)).slice(0,20)});
  if(o.item?.title||o.skuBase?.skus||o.skuCore?.sku2info||o.skuMap)candidates.push({o,path,score:(o.item?.title?4:0)+(o.skuBase?.skus?32:0)+(o.skuCore?.sku2info?8:0)+(o.skuMap?5:0)});
  for(const [k,v]of Object.entries(o).slice(0,500)){if(/token|cookie|auth|password|secret|user|buyer|seller|shop|recommend|related|suggest|itemList|search/i.test(k))continue;if(v&&typeof v==='object')scan(v,path+'.'+k,depth+1);else if(typeof v==='string'&&['value','data','mockData'].includes(k)&&v.length<3000000&&v.trim().startsWith('{')){try{scan(JSON.parse(v),path+'.'+k,depth+1);}catch{}}}
 };
 for(const name of ['__INIT_DATA__','__INIT_DATA','__INITIAL_STATE__','__ICE_APP_CONTEXT__','__PRELOADED_STATE__','g_config','Hub']){try{scan(window[name],name);}catch{}}
 for(const script of [...document.querySelectorAll('script[type="application/json"],script[type="application/ld+json"],script#__NEXT_DATA__')].slice(0,30)){try{if(script.textContent.length<3000000)scan(JSON.parse(script.textContent),'json');}catch{}}
 const selected=candidates.sort((a,b)=>b.score-a.score)[0],data=selected?.o||{},item=data.item||{},images=[],details=[];
 const add=(list,v)=>{const url=image(v);if(url&&!list.includes(url))list.push(url);};
 for(const entry of (Array.isArray(item.images)?item.images:[]).slice(0,30))add(images,typeof entry==='string'?entry:entry?.url);
 if(!images.length)for(const node of [...document.querySelectorAll('[class*="PicGallery"] img,#J_UlThumb img,.tb-gallery img')].slice(0,30))add(images,node.getAttribute('data-src')||node.getAttribute('src'));
 for(const container of document.querySelectorAll('#description,#J_DivItemDesc,[class*="ItemDetail--detail"],[class*="descV8-container"]'))for(const node of [...container.querySelectorAll('img')].slice(0,100))add(details,node.getAttribute('data-src')||node.getAttribute('data-original')||node.getAttribute('src'));
 const attributes=[],attributeKeys=new Set();
 const addAttribute=(name,value)=>{name=clean(name,60);value=clean(value,1000);if(!name||!value||/销售地区|下游平台|跨境|专供/.test(name)||attributes.length>=100)return;const key=name+'\0'+value;if(!attributeKeys.has(key)){attributeKeys.add(key);attributes.push({name,value});}};
 for(const group of (Array.isArray(data.props?.groupProps)?data.props.groupProps:[]).slice(0,30))for(const list of Object.values(group))if(Array.isArray(list))for(const row of list.slice(0,100))if(row&&typeof row==='object')for(const [name,value]of Object.entries(row).slice(0,10))addAttribute(name,typeof value==='string'?value:Array.isArray(value)?value.filter(v=>typeof v==='string').join('、'):'');
 for(const node of [...document.querySelectorAll('#attributes li,.attributes-list li')].slice(0,100)){const text=clean(node.textContent,1100),match=text.match(/^([^:：]{1,60})[:：]\s*(.+)$/);if(match)addAttribute(match[1],match[2]);}
 const title=clean(item.title)||clean(document.querySelector('meta[property="og:title"]')?.content)||clean(document.querySelector('h1')?.textContent);
 const props=data.skuBase?.props||[],rows=data.skuBase?.skus,info=data.skuCore?.sku2info||{},skus=[],names=[],values=new Map();
 let valid=Array.isArray(rows)&&rows.length>0&&rows.length<=500&&Array.isArray(props)&&props.length<=5;
 if(valid)for(const prop of props){const name=clean(prop.name,30),pid=String(prop.pid||'');if(!name||!pid||!Array.isArray(prop.values)||prop.values.length>500||names.includes(name)){valid=false;break;}names.push(name);for(const v of prop.values)values.set(pid+':'+v.vid,{pid,name:clean(v.name,100),image:image(v.image)});}
 const codes=new Set(),combinations=new Set();
 if(valid)for(const row of rows){const code=String(row.skuId||''),parts=String(row.propPath||'').split(';').filter(Boolean).map(k=>values.get(k)),rowValues=props.map(p=>parts.find(v=>v?.pid===String(p.pid))?.name||'');if(!/^\d{1,40}$/.test(code)||codes.has(code)||rowValues.some(v=>!v)||parts.length!==names.length||combinations.has(JSON.stringify(rowValues))){valid=false;break;}codes.add(code);combinations.add(JSON.stringify(rowValues));const price=info[code]?.price?.priceText,number=typeof price==='string'&&/^\d+(\.\d+)?$/.test(price)?Number(price):0;const picture=parts.find(v=>v?.image)?.image;skus.push({sku:'TB-'+code,spec:rowValues.join(' / ')||'默认',...(names.length?{spec_values:rowValues}:{}),cost:Number.isFinite(number)?number:0,price:0,stock:0,...(picture?{image:picture}:{})});}
 if(!valid){skus.length=0;warnings.push('未识别到完整淘宝SKU结构，请展开规格、等待加载后重读；不会将多规格商品伪造为单规格。');}
 if(!title)warnings.push('未读取到商品标题，请确认已进入商品页而非登录或验证页。');
 if(!images.length)warnings.push('未读取到主图，请等待商品图片加载。');if(!details.length)warnings.push('未读取到真实详情图，请展开并滚动商品详情后重读；跨域详情框内的图片不会冒充已采集。');
 warnings.push('淘宝价格仅作参考成本，售价和库存均为0；请自行核对条码、规格、成本、售价和库存后审核。');
 if(diagnostic)return {diagnostics:{version:'0.1.12',platform:'taobao',item_id:id,selectedPath:selected?.path||'',schemas}};
 return {product:{source_url:'https://item.taobao.com/item.htm?id='+id,title,category:'',description:'',attributes,images:images.slice(0,30),detail_images:details.slice(0,100),skus,...(valid&&names.length?{spec_names:names}:{})},warnings};
}
