import {pageInfo} from './public/list-view.js';
function summaryFor(db,join,where,params){return db.prepare(`SELECT COUNT(*) total,
 COALESCE(SUM(j.status IN ('dispatching','accepted','verifying')),0) running,
 COALESCE(SUM(j.status IN ('unknown','awaiting_review')),0) review,
 COALESCE(SUM(j.status='succeeded'),0) succeeded,
 COALESCE(SUM(j.status='failed'),0) failed FROM jobs j ${join} WHERE ${where}`).get(...params);}
export function jobSummary(db,owner){return summaryFor(db,'','j.owner=?',[owner]);}
export function jobPage(db,owner,page,pageSize,filters={}){
 const {scope='all',actor='',mall='',status=''}=filters;
 if(!['mine','all'].includes(scope))throw Error('任务范围无效');
 if(status&&!['dispatching','accepted','unknown','succeeded','failed','awaiting_review','verifying'].includes(status))throw Error('任务状态无效');
 const clauses=['j.owner=?'],params=[owner];if(scope==='mine'){clauses.push('i.sub=?');params.push(actor);}if(mall){clauses.push('j.mall_connection_id=?');params.push(mall);}if(status){clauses.push('j.status=?');params.push(status);}
 const where=clauses.join(' AND '),join='LEFT JOIN job_initiators i ON i.job_id=j.id';
 const summary=summaryFor(db,join,where,params),info=pageInfo(summary.total,page,pageSize);
 const rows=db.prepare(`SELECT j.id,j.product_id,j.revision,j.target,j.mall_connection_id,j.status,j.message,j.remote_id,j.created,j.updated,
 p.data AS product_data,s.claimed,s.product AS snapshot_data,i.sub AS initiated_by,i.name AS initiator_name
 FROM jobs j ${join} LEFT JOIN products p ON p.id=j.product_id AND p.owner=j.owner LEFT JOIN job_snapshots s ON s.job_id=j.id
 WHERE ${where} ORDER BY j.created DESC,j.id DESC LIMIT ? OFFSET ?`).all(...params,info.pageSize,info.offset);
 return {...info,summary,rows:rows.map(({product_data,snapshot_data,...row})=>{
  const current=product_data?JSON.parse(product_data):null,snapshot=snapshot_data?JSON.parse(snapshot_data):null;
  const image=snapshot?.images?.[0]||current?.images?.[0];
  return {...row,claimed:!!row.claimed,marker:'OPS-'+row.id.replaceAll('-',''),product_title:snapshot?.title||current?.title||'商品记录',
   product_image:typeof image==='string'&&image.startsWith('https://')?image:'',fx:row.target==='tigshop'?snapshot?.tigshop?.fx??null:null};
 })};
}
