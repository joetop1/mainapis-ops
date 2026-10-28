import {pageInfo} from './public/list-view.js';
export function jobPage(db,owner,page,pageSize){
 const total=db.prepare('SELECT COUNT(*) AS n FROM jobs WHERE owner=?').get(owner).n,info=pageInfo(total,page,pageSize);
 const rows=db.prepare(`SELECT j.id,j.product_id,j.revision,j.target,j.mall_connection_id,j.status,j.message,j.remote_id,j.created,j.updated,
 p.data AS product_data,s.claimed,s.product AS snapshot_data
 FROM jobs j LEFT JOIN products p ON p.id=j.product_id AND p.owner=j.owner LEFT JOIN job_snapshots s ON s.job_id=j.id
 WHERE j.owner=? ORDER BY j.created DESC,j.id DESC LIMIT ? OFFSET ?`).all(owner,info.pageSize,info.offset);
 return {...info,rows:rows.map(({product_data,snapshot_data,...row})=>({...row,claimed:!!row.claimed,marker:'OPS-'+row.id.replaceAll('-',''),product_title:product_data?JSON.parse(product_data).title||'商品记录':'商品记录',fx:row.target==='tigshop'&&snapshot_data?JSON.parse(snapshot_data).tigshop?.fx:null}))};
}
