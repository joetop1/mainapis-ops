// Self-contained: Chrome serializes this function into the user-selected tab.
export function collect1688(diagnostic=false) {
  if(location.protocol!=='https:'||location.hostname!=='detail.1688.com'||!/^\/offer\/\d+\.html$/.test(location.pathname))return {error:'请先打开 1688 商品详情页（detail.1688.com/offer/数字.html）'};
  const offer=location.pathname.match(/\d+/)[0],warnings=[];
  const clean=(v,max=200)=>typeof v==='string'?v.replace(/\s+/g,' ').trim().slice(0,max):'';
  const text=selector=>clean(document.querySelector(selector)?.textContent);
  const image=v=>{try{const u=new URL(typeof v==='string'?v:'',location.href);return u.protocol==='https:'&&!u.username&&!u.password&&/(^|\.)alicdn\.com$/.test(u.hostname)&&/\.(?:jpe?g|png|webp)(?:_|$)/i.test(u.pathname)?u.href:'';}catch{return '';}};
  const detailPictures=[];
  const addDetailImage=v=>{const u=image(v);if(u&&!detailPictures.includes(u)&&detailPictures.length<100)detailPictures.push(u);};
  const pictures=[],addImage=v=>{const u=image(v);if(u&&!pictures.includes(u)&&pictures.length<30)pictures.push(u);};
  const roots=[],rootNames=[],schemas=[];
  const rootKeys=['__INIT_DATA','__INIT_DATA__','__INITIAL_STATE__','__NEXT_DATA__','__GLOBAL_DATA','__GLOBAL_DATA__','__DATA__','__pageData','iDetailData','context'];
  for(const key of rootKeys){try{if(window[key]&&typeof window[key]==='object'){roots.push(window[key]);rootNames.push(key);}}catch{}}
  for(const script of [...document.querySelectorAll('script[type="application/json"], script[type="application/ld+json"]')].slice(0,20)){
    if(script.textContent.length>2000000)continue;
    try{roots.push(JSON.parse(script.textContent));}catch{}
  }
  let title='',description='',skuContainer=null,skuPriority=-1,skuPath='';const skuSchemas=[];
  const selectSku=(o,path,priority)=>{
    if(!o||typeof o!=='object')return;
    const map=o.skuInfoMap||o.skuMap;
    if(!map||typeof map!=='object'||map.$ref||!Object.keys(map).length)return;
    if(diagnostic&&skuSchemas.length<12){
      const rows=Object.values(map).filter(v=>v&&typeof v==='object').slice(0,2);
      const shape=v=>Object.keys(v).filter(k=>!/token|cookie|password|secret|auth|user|member/i.test(k)).slice(0,30);
      skuSchemas.push({path,isArray:Array.isArray(map),rowCount:Object.keys(map).length,rowKeys:rows.map(shape),propsKeys:Array.isArray(o.skuProps)?o.skuProps.slice(0,2).map(shape):[]});
    }
    if(priority>skuPriority){skuContainer={...o,skuMap:map};skuPriority=priority;skuPath=path;}
  };
  const seen=new Set(),queue=roots.map((v,i)=>[v,0,rootNames[i]||'json']);let count=0;
  // Hydration assignments are accepted only when the right hand side is strict JSON. Never eval page code.
  for(const script of [...document.querySelectorAll('script:not([src])')].slice(0,100)){
    const source=script.textContent||'';if(source.length>2000000)continue;
    for(const key of rootKeys){const match=new RegExp('(?:window\\.)?'+key+'\\s*=\\s*([\\{\\[])').exec(source);if(!match)continue;
      const start=match.index+match[0].length-1;let level=0,inString=false,slash=false;
      for(let i=start;i<source.length;i++){const c=source[i];if(inString){if(slash)slash=false;else if(c==='\\')slash=true;else if(c==='"')inString=false;}else if(c==='"')inString=true;else if(c==='{'||c==='[')level++;else if(c==='}'||c===']'){if(--level===0){try{queue.push([JSON.parse(source.slice(start,i+1)),0,'script.'+key]);rootNames.push('script.'+key);}catch{}break;}}}
    }
  }
  // Current PC detail layout: the complete variant model is separate from tradeModel.skuMap.
  for(const [root,,path]of [...queue]){
    const data=root?.result?.data?.Root?.fields?.dataJson;
    const offerDetail=root?.result?.global?.globalData?.model?.offerDetail;
    const rootOffer=String(data?.offerBaseInfo?.offerId||offerDetail?.offerId||'');
    if(rootOffer&&rootOffer!==offer)continue;
    if(data?.skuModel)selectSku({...data.skuModel,skuProps:Array.isArray(data.skuModel.skuProps)?data.skuModel.skuProps:offerDetail?.skuProps},path+'.result.data.Root.fields.dataJson.skuModel',100);
    if(!title)title=clean(root?.result?.data?.productTitle?.fields?.title)||clean(offerDetail?.subject);
  }
  while(queue.length&&count++<6000){
    const [o,depth,path]=queue.shift();if(!o||typeof o!=='object'||seen.has(o))continue;seen.add(o);
    const productNode=String(o.offerId||o.offerID||'')===offer||o.skuMap||o.skuInfoMap||o.skuModel||o.skuInfo||o['@type']==='Product';
    if(!title)title=clean(o.offerTitle)||(productNode?clean(o.subject):'')||((o['@type']==='Product')?clean(o.name):'');
    if(diagnostic&&schemas.length<80&&(depth===0||/sku|offer|product|image|title|desc|detail|frame/i.test(path)))schemas.push({path,keys:Object.keys(o).filter(k=>!/token|cookie|password|secret|auth|user|member/i.test(k)).slice(0,25)});
    if(!description&&o['@type']==='Product')description=clean(o.description,10000);
    if(o.skuMap||o.skuInfoMap)selectSku(o,path,o.skuInfoMap?20:1);
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
  const detail=document.querySelector('#desc-lazyload-container, #description, .offer-description, .module-od-product-description, v-detail-y.html-description');
  // Modern 1688 detail images live inside an open shadow root of v-detail-y.
  // Traverse only the product detail container, never unrelated page images.
  const detailSeen=new Set();let detailNodesVisited=0;
  const scanDetail=node=>{
    if(!node||detailSeen.has(node)||detailNodesVisited++>=50)return;detailSeen.add(node);
    for(const img of [...node.querySelectorAll('img')].slice(0,100))addDetailImage(img.getAttribute('data-lazy-src')||img.getAttribute('data-src')||img.getAttribute('data-ks-lazyload')||img.currentSrc||img.src);
    for(const host of [node,...[...node.querySelectorAll('*')].slice(0,2000)]){try{if(host.shadowRoot)scanDetail(host.shadowRoot);}catch{}}
    for(const frame of [...node.querySelectorAll('iframe')].slice(0,10)){try{if(frame.contentDocument)scanDetail(frame.contentDocument);}catch{}}
  };
  if(detail){
    const detailText=clean(detail.innerText||detail.textContent,10000);
    if(!/平台活动下价格|非分销场景|划线价格|价格说明/.test(detailText))description=detailText||description;
    scanDetail(detail);
  }
  const skus=[],specNames=new Set(),codes=new Set(),props=new Map(),propImages=new Map(),propDefinitions=[],dimensionRefs=new Map(),dimensionRows=[];
  const rememberDimension=(key,index,label)=>{if(key===undefined||key===null||key==='')return;const rows=dimensionRefs.get(String(key))||[];if(!rows.some(r=>r.index===index&&r.label===label))rows.push({index,label});dimensionRefs.set(String(key),rows);};
  const rememberImage=(key,url)=>{if(!key||!url)return;const urls=propImages.get(key)||new Set();urls.add(url);propImages.set(key,urls);};
  if(skuContainer){
    for(const prop of Array.isArray(skuContainer.skuProps)?skuContainer.skuProps:[]){
      const name=clean(prop.prop||prop.name||prop.propName);
      const index=propDefinitions.length;propDefinitions.push({name,labels:new Set()});
      for(const v of Array.isArray(prop.value)?prop.value:Array.isArray(prop.values)?prop.values:[]){
        const label=clean(v.name||v.value||v.valueName);if(!label)continue;
        propDefinitions[index].labels.add(label);rememberDimension(label,index,label);if(name)rememberDimension(name+'：'+label,index,label);
        for(const id of [v.vid,v.id,v.valueId])if(id!==undefined){rememberDimension(id,index,label);if((prop.pid??prop.propId)!==undefined)rememberDimension((prop.pid??prop.propId)+':'+id,index,label);}
        const pic=image(v.imageUrl||v.image||v.pic||v.bigImageUrl||v.imageURI||v.imageUrlOriginal);
        rememberImage(label,pic);rememberImage(name?name+'：'+label:label,pic);
        for(const id of [v.vid,v.id,v.valueId])if(id!==undefined){props.set(String(id),name?name+'：'+label:label);rememberImage(String(id),pic);if((prop.pid??prop.propId)!==undefined){const k=(prop.pid??prop.propId)+':'+id;props.set(k,name?name+'：'+label:label);rememberImage(k,pic);}}
      }
    }
    const entries=Object.entries(skuContainer.skuMap);
    let unresolved=0;
    if(entries.length>100)warnings.push('该商品超过 100 个 SKU，本次不导入规格，请拆分后处理。');
    else for(const [key,row]of entries){
      if(!row||typeof row!=='object')continue;
      const attr=row.specAttrs??row.specName??row.skuName;
      let spec='';
      if(typeof attr==='string')spec=clean(attr.replace(/&gt;/g,'>').split('>').join(' / '),100);
      else if(Array.isArray(attr)){
        const labels=attr.map(x=>typeof x==='string'?clean(x):x&&typeof x==='object'?clean(x.valueName||x.name||x.value):'');
        if(labels.length&&labels.every(Boolean))spec=labels.join(' / ').slice(0,100);
      }
      if(!spec&&!Array.isArray(skuContainer.skuMap)){
        const parts=key.replace(/&gt;/g,'>').split(/[;>]/).filter(Boolean);
        // Numeric keys can be array indexes or property IDs, never assume they are labels.
        if(parts.length&&parts.every(x=>props.has(x)||!/^\d+(?::\d+)?$/.test(x)))spec=parts.map(x=>props.get(x)||x).join(' / ').slice(0,100);
      }
      const rawId=String(row.skuId||row.skuID||row.specId||'');
      const sku=(/^[A-Za-z0-9_.-]{1,40}$/.test(rawId)?'ALI-'+rawId:'ALI-'+offer+'-'+(skus.length+1)).slice(0,64);
      if(!spec||/[,;=]/.test(spec)||specNames.has(spec)||codes.has(sku)){unresolved++;continue;}
      const rawPrice=row.discountPrice??row.price??row.salePrice??row.priceInfo?.price;
      const cost=(typeof rawPrice==='number'||typeof rawPrice==='string'&&/^\d+(\.\d{1,2})?$/.test(rawPrice))?Number(rawPrice):0;
      let skuImage=image(row.imageUrl||row.image||row.skuImage||row.pic||row.bigImageUrl);
      if(!skuImage){
        const matched=new Set();
        const tokens=[...spec.split(' / '),...(!Array.isArray(skuContainer.skuMap)?key.replace(/&gt;/g,'>').split(/[;>]/):[])];
        for(const token of tokens)for(const url of propImages.get(token)||[])matched.add(url);
        if(matched.size===1)skuImage=[...matched][0];
      }
      const keyParts=!Array.isArray(skuContainer.skuMap)?key.replace(/&gt;/g,'>').split(/[;>]/).filter(Boolean):[];
      const references=keyParts.map(token=>dimensionRefs.get(token));
      if(!attr&&keyParts.some(token=>/^\d+(?::\d+)?$/.test(token)&&dimensionRefs.get(token)?.length!==1)){unresolved++;continue;}
      let dimensions=null;
      if(propDefinitions.length&&references.length===propDefinitions.length&&references.every(ref=>ref?.length===1)&&new Set(references.map(ref=>ref[0].index)).size===propDefinitions.length){
        dimensions=references.map(ref=>ref[0]).sort((a,b)=>a.index-b.index).map(ref=>({name:propDefinitions[ref.index].name,value:ref.label}));
      }else{
        const tokens=typeof attr==='string'?attr.replace(/&gt;/g,'>').split('>'):Array.isArray(attr)?attr.map(x=>typeof x==='string'?x:x?.valueName||x?.name||x?.value||''):keyParts;
        if(tokens.length&&tokens.length<=5){
          dimensions=tokens.map((token,index)=>{
            let value=clean(String(token),100),name='';const def=propDefinitions[index];
            if(def&&def.labels.has(value))name=def.name;
            else if(def?.name&&value.startsWith(def.name+'：')&&def.labels.has(value.slice(def.name.length+1))){name=def.name;value=value.slice(def.name.length+1);}
            if(Array.isArray(attr)&&attr[index]&&typeof attr[index]==='object')name=clean(attr[index].propName||attr[index].propertyName||name,30);
            return {name,value};
          });
        }
      }
      dimensionRows.push(dimensions);
      skus.push({sku,spec,cost:Number.isFinite(cost)&&cost>=0&&cost<=99999999?cost:0,price:0,stock:0,...(skuImage?{image:skuImage}:{})});specNames.add(spec);codes.add(sku);
    }
    if(unresolved){skus.length=0;warnings.push('有 '+unresolved+' 条规格名称未解析或重复，本次不导入整组 SKU，避免漏规格或把数组下标当名称。请下载页面结构诊断。');}
  }
  let specNamesStructured;
  if(skus.length&&dimensionRows.length===skus.length){
    const firstNames=dimensionRows[0]?.map(d=>d.name);
    if(firstNames?.every(Boolean)&&new Set(firstNames).size===firstNames.length&&dimensionRows.every(row=>row?.length===firstNames.length&&new Set(row.map(d=>d.name)).size===firstNames.length&&row.every(d=>firstNames.includes(d.name)))){
      dimensionRows.forEach((row,i)=>dimensionRows[i]=firstNames.map(name=>row.find(d=>d.name===name)));
    }
    const width=dimensionRows[0]?.length;
    if(width&&width<=5&&dimensionRows.every(row=>row?.length===width&&row.every(d=>d.value&&!/[,;=:\u0000-\u001f]/.test(d.value)))){
      const names=Array.from({length:width},(_,i)=>{
        const candidates=new Set(dimensionRows.map(row=>row[i].name));
        return candidates.size===1&&[...candidates][0]?[...candidates][0]:(width===1?'规格':'规格'+(i+1));
      });
      if(new Set(names).size===names.length&&names.every(n=>n.length<=30&&!/[,;=:\u0000-\u001f]/.test(n)&&!['__proto__','constructor','prototype'].includes(n))){
        specNamesStructured=names;skus.forEach((sku,i)=>{sku.spec_values=dimensionRows[i].map(d=>d.value);sku.spec=sku.spec_values.join(' / ');});
        if(names.some(n=>/^规格[0-9]+$/.test(n)))warnings.push('已保留各规格维度的值，但原页面未提供完整维度名称；请在 OPS 核对并命名。');
      }
    }
    if(!specNamesStructured)warnings.push('未能完整还原规格维度，请在 OPS 核对；旧规格文本暂保留，不自动猜拆。');
  }
  if(!skus.length)warnings.push('未识别到完整 SKU 数据，需在 OPS 手工添加规格和采购成本。');
  if(skus.some(s=>!s.image))warnings.push('有 '+skus.filter(s=>!s.image).length+' 个规格未匹配到唯一图片，需在 OPS 检查或补充；未设置的规格发布时会使用商品首图。');
  if(!pictures.length)warnings.push('未识别到商品图片，请等待页面加载后重试，或在 OPS 补充。');
  if(!title)warnings.push('未识别到商品标题，请在 OPS 补充。');
  warnings.push('采购成本仅为页面识别值：阶梯价、起订量和规格须人工核对；售价与库存统一为 0，填写后才能审核。');
  if(!detailPictures.length)warnings.push('未采集到真实商品详情图。请滚动到1688商品详情并等待加载后重新读取；不会用主图或SKU配图代替详情。');
  warnings.push('目标分类、品牌和标签需在 OPS 设置；详情仅含当前已加载内容，嵌入页面中的详情可能缺失。');
  const nodeShape=n=>({tag:String(n?.tagName||''),id:String(n?.id||'').slice(0,120),className:String(n?.className||'').slice(0,180)});
  const detailStructure=diagnostic?{
    recognizedDetail:!!detail,
    shadowHosts:[...document.querySelectorAll('v-detail-y, .html-description')].slice(0,10).map(n=>({...nodeShape(n),openShadowRoot:!!n.shadowRoot,shadowImageCount:n.shadowRoot?.querySelectorAll('img').length||0})),
    matchedDetailImageCount:detailPictures.length,
    candidates:[...document.querySelectorAll('[id*="desc"], [class*="desc"], [id*="Desc"], [class*="Desc"]')].slice(0,45).map(n=>({...nodeShape(n),imageCount:n.querySelectorAll('img').length,frameCount:n.querySelectorAll('iframe').length})),
    frames:[...document.querySelectorAll('iframe')].slice(0,20).map(n=>{let accessible=false,imageCount=0;try{const d=n.contentDocument;accessible=!!d;if(d)imageCount=d.querySelectorAll('img').length;}catch{}return {...nodeShape(n),accessible,imageCount};}),
    imageAncestors:[...document.querySelectorAll('img')].filter(n=>Number(n.naturalHeight)>=500||Number(n.height)>=500).slice(0,30).map(n=>{const ancestors=[];let parent=n.parentElement;for(let i=0;parent&&i<6;i++,parent=parent.parentElement)ancestors.push(nodeShape(parent));return {...nodeShape(n),width:Number(n.naturalWidth||0),height:Number(n.naturalHeight||0),ancestors};})
  }:undefined;
  if(diagnostic)return {diagnostics:{version:'0.1.9',detailStructure,offer_id:offer,roots:rootNames,schemas,skuSchemas,selectedSkuPath:skuPath,headings:[...document.querySelectorAll('h1,h2')].slice(0,15).map(n=>({tag:n.tagName,className:String(n.className).slice(0,120)})),skuElements:[...document.querySelectorAll('[class*="sku"], [class*="Sku"]')].slice(0,25).map(n=>({tag:n.tagName,className:String(n.className).slice(0,120)})),scriptCount:document.querySelectorAll('script').length,matchedSkuMap:!!skuContainer}};
  return {product:{source_url:'https://detail.1688.com/offer/'+offer+'.html',title,category:'',description,images:pictures,detail_images:detailPictures,skus,...(specNamesStructured?{spec_names:specNamesStructured}:{})},warnings};
}
