// Self-contained: Chrome serializes this function into the user-selected tab.
export function collect1688() {
  if(location.protocol!=='https:'||location.hostname!=='detail.1688.com'||!/^\/offer\/\d+\.html$/.test(location.pathname))return {error:'请先打开 1688 商品详情页（detail.1688.com/offer/数字.html）'};
  const offer=location.pathname.match(/\d+/)[0],warnings=[];
  const clean=(v,max=200)=>typeof v==='string'?v.replace(/\s+/g,' ').trim().slice(0,max):'';
  const text=selector=>clean(document.querySelector(selector)?.textContent);
  const image=v=>{try{const u=new URL(typeof v==='string'?v:'',location.href);return u.protocol==='https:'&&!u.username&&!u.password&&/(^|\.)alicdn\.com$/.test(u.hostname)&&/\.(?:jpe?g|png|webp)(?:_|$)/i.test(u.pathname)?u.href:'';}catch{return '';}};
  const pictures=[],addImage=v=>{const u=image(v);if(u&&!pictures.includes(u)&&pictures.length<30)pictures.push(u);};
  const roots=[];
  for(const key of ['__INIT_DATA','__INIT_DATA__','__INITIAL_STATE__','__NEXT_DATA__']){try{if(window[key]&&typeof window[key]==='object')roots.push(window[key]);}catch{}}
  for(const script of [...document.querySelectorAll('script[type="application/json"], script[type="application/ld+json"]')].slice(0,20)){
    if(script.textContent.length>2000000)continue;
    try{roots.push(JSON.parse(script.textContent));}catch{}
  }
  let title='',description='',skuContainer=null;const seen=new Set(),queue=roots.map(v=>[v,0]);let count=0;
  while(queue.length&&count++<6000){
    const [o,depth]=queue.shift();if(!o||typeof o!=='object'||seen.has(o))continue;seen.add(o);
    if(!title)title=clean(o.subject)||clean(o.offerTitle)||((o['@type']==='Product')?clean(o.name):'');
    if(!description&&o['@type']==='Product')description=clean(o.description,10000);
    if(!skuContainer&&o.skuMap&&typeof o.skuMap==='object')skuContainer=o;
    // Only known product image fields, never every image on the page.
    for(const key of ['offerImgList','offerImageList','imageList','images'])if(Array.isArray(o[key]))for(const item of o[key].slice(0,30))addImage(typeof item==='string'?item:item?.originalImageURI||item?.imageUrl||item?.fullPath||item?.url);
    if(o['@type']==='Product'){for(const item of Array.isArray(o.image)?o.image:[o.image])addImage(item);}
    if(depth<10)for(const [key,value]of Object.entries(o).slice(0,250)){
      if(/token|cookie|password|secret|authorization|userInfo|memberInfo|recommend|related|suggest/i.test(key))continue;
      if(value&&typeof value==='object'&&queue.length<10000)queue.push([value,depth+1]);
    }
  }
  title=title||text('h1')||clean(document.querySelector('meta[property="og:title"]')?.content)||clean(document.title.replace(/[-_ ]*(阿里巴巴|1688).*$/,''));
  addImage(document.querySelector('meta[property="og:image"]')?.content);
  for(const img of [...document.querySelectorAll('.detail-gallery img, .detail-gallery-preview img, .vertical-img img, #dt-tab img, [class*="gallery"] img')].slice(0,100))addImage(img.getAttribute('data-lazy-src')||img.getAttribute('data-src')||img.currentSrc||img.src);
  const detail=document.querySelector('#desc-lazyload-container, #description, .offer-description');
  if(detail){description=clean(detail.innerText||detail.textContent,10000)||description;for(const img of [...detail.querySelectorAll('img')].slice(0,30))addImage(img.getAttribute('data-lazy-src')||img.getAttribute('data-src')||img.src);}
  const skus=[],specNames=new Set(),codes=new Set(),props=new Map();
  if(skuContainer){
    for(const prop of Array.isArray(skuContainer.skuProps)?skuContainer.skuProps:[]){
      const name=clean(prop.prop||prop.name||prop.propName);
      for(const v of Array.isArray(prop.value)?prop.value:Array.isArray(prop.values)?prop.values:[]){
        const label=clean(v.name||v.value||v.valueName);if(!label)continue;
        for(const id of [v.vid,v.id,v.valueId])if(id!==undefined){props.set(String(id),name?name+'：'+label:label);if(prop.pid!==undefined)props.set(prop.pid+':'+id,name?name+'：'+label:label);}
      }
    }
    const entries=Object.entries(skuContainer.skuMap);
    if(entries.length>100)warnings.push('该商品超过 100 个 SKU，本次不导入规格，请拆分后处理。');
    else for(const [key,row]of entries){
      if(!row||typeof row!=='object')continue;
      const parts=key.split(/[;>]/).filter(Boolean),spec=parts.map(x=>props.get(x)||x).join(' / ').slice(0,100);
      const rawId=String(row.skuId||row.skuID||'');
      const sku=(/^[A-Za-z0-9_.-]{1,40}$/.test(rawId)?'ALI-'+rawId:'ALI-'+offer+'-'+(skus.length+1)).slice(0,64);
      if(!spec||/[,;=]/.test(spec)||specNames.has(spec)||codes.has(sku)){warnings.push('存在无法安全识别或重复的规格，请在 OPS 补齐。');continue;}
      const rawPrice=row.discountPrice??row.price??row.salePrice;
      const cost=(typeof rawPrice==='number'||typeof rawPrice==='string'&&/^\d+(\.\d{1,2})?$/.test(rawPrice))?Number(rawPrice):0;
      skus.push({sku,spec,cost:Number.isFinite(cost)&&cost>=0&&cost<=99999999?cost:0,price:0,stock:0});specNames.add(spec);codes.add(sku);
    }
  }
  if(!skus.length)warnings.push('未识别到完整 SKU 数据，需在 OPS 手工添加规格和采购成本。');
  if(!pictures.length)warnings.push('未识别到商品图片，请等待页面加载后重试，或在 OPS 补充。');
  if(!title)warnings.push('未识别到商品标题，请在 OPS 补充。');
  warnings.push('采购成本仅为页面识别值：阶梯价、起订量和规格须人工核对；售价与库存统一为 0，填写后才能审核。');
  warnings.push('目标分类、品牌和标签需在 OPS 设置；详情仅含当前已加载内容，嵌入页面中的详情可能缺失。');
  return {product:{source_url:'https://detail.1688.com/offer/'+offer+'.html',title,category:'',description,images:pictures,skus},warnings};
}
