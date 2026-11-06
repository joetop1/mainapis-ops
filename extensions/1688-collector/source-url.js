export function canonicalSourceURL(value){
 const u=new URL(String(value));
 if(u.protocol!=='https:'||u.username||u.password||u.port)throw Error('请使用1688、淘宝或天猫的HTTPS商品详情链接');
 if(u.hostname==='detail.1688.com'&&/^\/offer\/\d+\.html$/.test(u.pathname))return u.origin+u.pathname;
 if(['item.taobao.com','detail.tmall.com'].includes(u.hostname)&&u.pathname==='/item.htm'&&/^\d+$/.test(u.searchParams.get('id')||'')&&u.searchParams.getAll('id').length===1)return 'https://'+u.hostname+'/item.htm?id='+u.searchParams.get('id');
 throw Error('请使用1688商品页或 https://item.taobao.com/item.htm?id=数字 淘宝商品页，或 https://detail.tmall.com/item.htm?id=数字 天猫商品页');
}
