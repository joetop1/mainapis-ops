import {now} from './core.mjs';

const conflict=message=>Object.assign(Error(message),{httpStatus:409});

export function assertMallCanCreate(db,owner,productId,mallId){
 if(db.prepare('SELECT 1 FROM product_mall_links WHERE product_id=? AND mall_connection_id=?').get(productId,mallId))
  throw conflict('该商品已关联此商城的已有商品，不能重复发布');
 if(db.prepare(`SELECT 1 FROM jobs j LEFT JOIN job_snapshots s ON s.job_id=j.id
 WHERE j.owner=? AND j.product_id=? AND j.mall_connection_id=?
 AND (j.status<>'failed' OR COALESCE(s.claimed,1)<>0 OR j.remote_id<>'' OR COALESCE(s.candidate_id,'')<>'' OR COALESCE(s.verification_nonce,'')<>'') LIMIT 1`).get(owner,productId,mallId))
  throw conflict('此商品已有发布任务，请在发布任务中核对商品 ID');
}

export function changeMallLink(db,{owner,productId,mallId,remoteId,listingStatus,remove=false,audit}){
 if(typeof remoteId!=='string'||! /^[1-9][0-9]{0,19}$/.test(remoteId))throw Error('请填写有效的商城商品 ID（1–20位数字）');
 if(!remove&&!['listed','unlisted','unknown'].includes(listingStatus))throw Error('请选择商城商品状态');
 db.exec('BEGIN IMMEDIATE');
 try{
  if(!db.prepare('SELECT 1 FROM products WHERE id=? AND owner=?').get(productId,owner)||
     !db.prepare('SELECT 1 FROM mall_connections WHERE id=? AND owner=?').get(mallId,owner))throw Error('商品或商城不属于当前工作空间');
  if(remove){
   if(!db.prepare('DELETE FROM product_mall_links WHERE product_id=? AND mall_connection_id=? AND remote_id=?').run(productId,mallId,remoteId).changes)throw conflict('关联已变化，请刷新后再操作');
  }else{
   assertMallCanCreate(db,owner,productId,mallId);
   if(db.prepare('SELECT 1 FROM product_mall_links WHERE mall_connection_id=? AND remote_id=?').get(mallId,remoteId)||
      db.prepare("SELECT 1 FROM jobs WHERE owner=? AND mall_connection_id=? AND remote_id=? LIMIT 1").get(owner,mallId,remoteId))
    throw conflict('此商城商品 ID 已被采集箱其他记录使用');
   db.prepare('INSERT INTO product_mall_links VALUES(?,?,?,?,?)').run(productId,mallId,remoteId,listingStatus,now());
  }
  audit(owner,remove?'product.mall_unlink':'product.mall_link',productId);
  db.exec('COMMIT');
 }catch(error){db.exec('ROLLBACK');throw error;}
}
