  if(p.detail_images!==undefined&&(!Array.isArray(p.detail_images)||p.detail_images.length>100))throw Error('详情图数量不正确');
  const opsDetailImages=(p.detail_images||[]).map(u=>{const x=new URL(u);if(x.protocol!=='https:'||x.username||x.password)throw Error('详情图必须使用 HTTPS 地址');return x.href;});
  const description=escape(p.description||'').replaceAll('\n','<br>')+opsDetailImages.map(u=>'<p><img src="'+escape(u)+'" alt=""></p>').join('');
