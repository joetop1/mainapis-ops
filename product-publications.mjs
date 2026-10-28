// Read all history for loaded products, independent of the task table's 300-row cap.
// A later failure cannot erase a previously verified creation in the same mall.
export function productPublications(db,owner){
 const rows=db.prepare(`SELECT product_id,target,mall_connection_id,status,revision,remote_id,updated FROM (
 SELECT j.product_id,j.target,j.mall_connection_id,j.status,j.revision,j.remote_id,j.updated,
 ROW_NUMBER() OVER(PARTITION BY j.product_id,j.target,j.mall_connection_id ORDER BY (j.status='succeeded') DESC,j.created DESC,j.id DESC) AS position
 FROM jobs j JOIN (SELECT id FROM products WHERE owner=? ORDER BY updated DESC LIMIT 1000) p ON p.id=j.product_id
 WHERE j.owner=?
 ) WHERE position=1`).all(owner,owner);
 const result=new Map();
 for(const row of rows){const entries=result.get(row.product_id)||[];entries.push(row);result.set(row.product_id,entries);}
 return result;
}
