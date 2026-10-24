// Self-contained: Chrome serializes this function into the user-selected tab.
export function collect1688(diagnostic=false) {
  if(location.protocol!=='https:'||location.hostname!=='detail.1688.com'||!/^\/offer\/\d+\.html$/.test(location.pathname))return {error:'请先打开 1688 商品详情页（detail.1688.com/offer/数字.html）'};
  const offer=location.pathname.match(/\d+/)[0],warnings=[];
  const clean=(v,max=200)=>typeof v==='string'?v.replace(/\s+/g,' ').trim().slice(0,max):'';
  const text=selector=>clean(document.querySelector(selector)?.textContent);
  const image=v=>{try{const u=new URL(typeof v==='string'?v:'',location.href);return u.protocol==='https:'&&!u.username&&!u.password&&/(^|\.)alicdn\.com$/.test(u.hostname)&&/\.(?:jpe?g|png|webp)(?:_|$)/i.test(u.pathname)?u.href:'';}catch{return '';}};
  const pictures=[],addImage=v=>{const u=image(v);if(u&&!pictures.includes(u)&&pictures.length<30)pictures.push(u);};
  const roots=[],rootNames=[],schemas=[];
  const rootKeys=['__INIT_DATA','__INIT_DATA__','__INITIAL_STATE__','__NEXT_DATA__','__GLOBAL_DATA','__GLOBAL_DATA__','__DATA__','__pageData','iDetailData','context'];
  for(const key of rootKeys){try{if(window[key]&&typeof window[key]==='object'){roots.push(window[key]);rootNames.push(key);}}catch{}}
  for(const script of [...document.querySelectorAll('script[type="application/json"], script[type="application/ld+json"]')].slice(0,20)){
    if(script.textContent.length>2000000)continue;
    try{roots.push(JSON.parse(script.textContent));}catch{}
  }
  let title='',description='',skuContainer=null;const seen=new Set(),queue=roots.map((v,i)=>[v,0,rootNames[i]||'json']);let count=0;
  // Hydration assignments are accepted only when the right hand side is strict JSON. Never eval page code.
  for(const script of [...document.querySelectorAll('script:not([src])')].slice(0,100)){
    const source=script.textContent||'';if(source.length>2000000)continue;
    for(const key of rootKeys){const match=new RegExp('(?:window\\.)?'+key+'\\s*=\\s*([\\{\\[])').exec(source);if(!match)continue;
      const start=match.index+match[0].length-1;let level=0,inString=false,slash=false;
      for(let i=start;i<source.length;i++){const c=source[i];if(inString){if(slash)slash=false;else if(c==='\\')slash=true;else if(c==='"')inString=false;}else if(c==='"')inString=true;else if(c==='{'||c==='[')level++;else if(c==='}'||c===']'){if(--level===0){try{queue.push([JSON.parse(source.slice(start,i+1)),0,'script.'+key]);rootNames.push('script.'+key);}catch{}break;}}}
    }
  }
  while(queue.length&&count++<6000){
    const [o,depth,path]=queue.shift();if(!o||typeof o!=='object'||seen.has(o))continue;seen.add(o);
    const productNode=String(o.offerId||o.offerID||'')===offer||o.skuMap||o.skuInfoMap||o.skuModel||o.skuInfo||o['@type']==='Product';
    if(!title)title=clean(o.offerTitle)||(productNode?clean(o.subject):'')||((o['@type']==='Product')?clean(o.name):'');
    if(diagnostic&&schemas.length<80&&(depth===0||/sku|offer|product|image|title/i.test(path)))schemas.push({path,keys:Object.keys(o).filter(k=>!/token|cookie|password|secret|auth|user|member/i.test(k)).slice(0,25)});
    if(!description&&o['@type']==='Product')description=clean(o.description,10000);
    if(!skuContainer&&(o.skuMap||o.skuInfoMap))skuContainer={...o,skuMap:o.skuMap||o.skuInfoMap};
    // Only known product image fields, never every image on the page.
    for(const key of ['offerImgList','offerImageList','imageList','images'])if((productNode||/imageModel|offerImage|gallery/i.test(path)||key.startsWith('offer'))&&Array.isArray(o[key]))for(const item of o[key].slice(0,30))addImage(typeof item==='string'?item:item?.originalImageURI||item?.imageUrl||item?.fullPath||item?.url);
    if(o['@type']==='Product'){for(const item of Array.isArray(o.image)?o.image:[o.image])addImage(item);}
    if(depth<10)for(const [key,value]of Object.entries(o).slice(0,250)){
      if(/token|cookie|password|secret|authorization|userInfo|memberInfo|recommend|related|suggest|offerList|productList|shop|seller|company/i.test(key))continue;
      if(value&&typeof value==='object'&&queue.length<10000)queue.push([value,depth+1,path+'.'+key]);
    }
  }
  title=text('.title-text')||text('.title-content')||text('.offer-title')||text('.d-title')||title||clean(document.querySelector('meta[property="og:title"]')?.content)||clean(document.title.replace(/[-_ ]*(阿里巴巴|1688).*$/,''));
  addImage(document.querySelector('meta[property="og:image"]')?.content);
  for(const img of [...document.querySelectorAll('.detail-gallery img, .detail-gallery-preview img, .detail-gallery-img img, .detail-gallery-turn img')].slice(0,100))addImage(img.getAttribute('data-lazy-src')||img.getAttribute('data-src')||img.currentSrc||img.src);
  const detail=document.querySelector('#desc-lazyload-container, #description, .offer-description');
  if(detail){const detailText=clean(detail.innerText||detail.textContent,10000);if(!/平台活动下价格|非分销场景|划线价格|价格说明/.test(detailText))description=detailText||description;for(const img of [...detail.querySelectorAll('img')].slice(0,30))addImage(img.getAttribute('data-lazy-src')||img.getAttribute('data-src')||img.src);}
  const skus=[],specNames=new Set(),codes=new Set(),props=new Map();
  if(skuContainer){
    for(const prop of Array.isArray(skuContainer.skuProps)?skuContainer.skuProps:[]){
      const name=clean(prop.prop||prop.name||prop.propName);
      for(const v of Array.isArray(prop.value)?prop.value:Array.isArray(prop.values)?prop.values:[]){
        const label=clean(v.name||v.value||v.valueName);if(!label)continue;
        for(const id of [v.vid,v.id,v.valueId])if(id!==undefined){props.set(String(id),name?name+'：'+label:label);if((prop.pid??prop.propId)!==undefined)props.set((prop.pid??prop.propId)+':'+id,name?name+'：'+label:label);}
      }
    }
    const entries=Object.entries(skuContainer.skuMap);
    if(entries.length>100)warnings.push('该商品超过 100 个 SKU，本次不导入规格，请拆分后处理。');
    else for(const [key,row]of entries){
      if(!row||typeof row!=='object')continue;
      const parts=key.split(/[;>]/).filter(Boolean),spec=parts.map(x=>props.get(x)||x).join(' / ').slice(0,100);
      const rawId=String(row.skuId||row.skuID||row.specId||'');
      const sku=(/^[A-Za-z0-9_.-]{1,40}$/.test(rawId)?'ALI-'+rawId:'ALI-'+offer+'-'+(skus.length+1)).slice(0,64);
      if(!spec||/[,;=]/.test(spec)||specNames.has(spec)||codes.has(sku)){warnings.push('存在无法安全识别或重复的规格，请在 OPS 补齐。');continue;}
      const rawPrice=row.discountPrice??row.price??row.salePrice??row.priceInfo?.price;
      const cost=(typeof rawPrice==='number'||typeof rawPrice==='string'&&/^\d+(\.\d{1,2})?$/.test(rawPrice))?Number(rawPrice):0;
      skus.push({sku,spec,cost:Number.isFinite(cost)&&cost>=0&&cost<=99999999?cost:0,price:0,stock:0});specNames.add(spec);codes.add(sku);
    }
  }
  if(!skus.length)warnings.push('未识别到完整 SKU 数据，需在 OPS 手工添加规格和采购成本。');
  if(!pictures.length)warnings.push('未识别到商品图片，请等待页面加载后重试，或在 OPS 补充。');
  if(!title)warnings.push('未识别到商品标题，请在 OPS 补充。');
  warnings.push('采购成本仅为页面识别值：阶梯价、起订量和规格须人工核对；售价与库存统一为 0，填写后才能审核。');
  warnings.push('目标分类、品牌和标签需在 OPS 设置；详情仅含当前已加载内容，嵌入页面中的详情可能缺失。');
  if(diagnostic)return {diagnostics:{version:'0.1.1',offer_id:offer,roots:rootNames,schemas,headings:[...document.querySelectorAll('h1,h2')].slice(0,15).map(n=>({tag:n.tagName,className:String(n.className).slice(0,120)})),skuElements:[...document.querySelectorAll('[class*="sku"], [class*="Sku"]')].slice(0,25).map(n=>({tag:n.tagName,className:String(n.className).slice(0,120)})),scriptCount:document.querySelectorAll('script').length,matchedSkuMap:!!skuContainer}};
  return {product:{source_url:'https://detail.1688.com/offer/'+offer+'.html',title,category:'',description,images:pictures,skus},warnings};
}
