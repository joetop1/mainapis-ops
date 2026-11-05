// Read all history for loaded products, independent of the task table's 300-row cap.
// A later failure cannot erase a previously verified creation in the same mall.
export function productPublications(db,owner){
 const rows=db.prepare(`SELECT product_id,target,mall_connection_id,status,revision,remote_id,updated,publication_blocked FROM (
 SELECT j.product_id,j.target,j.mall_connection_id,j.status,j.revision,j.remote_id,j.updated,
 MAX(CASE WHEN j.status<>'failed' OR COALESCE(s.claimed,1)<>0 OR j.remote_id<>'' OR COALESCE(s.candidate_id,'')<>'' OR COALESCE(s.verification_nonce,'')<>'' THEN 1 ELSE 0 END) OVER(PARTITION BY j.product_id,j.target,j.mall_connection_id) AS publication_blocked,
 ROW_NUMBER() OVER(PARTITION BY j.product_id,j.target,j.mall_connection_id ORDER BY (j.status='succeeded') DESC,j.created DESC,j.id DESC) AS position
 FROM jobs j JOIN (SELECT id FROM products WHERE owner=? ORDER BY updated DESC LIMIT 1000) p ON p.id=j.product_id
 LEFT JOIN job_snapshots s ON s.job_id=j.id
 WHERE j.owner=?
 ) WHERE position=1`).all(owner,owner);
 const result=new Map();
 for(const row of rows){const entries=result.get(row.product_id)||[];const {publication_blocked,...publication}=row;entries.push({...publication,can_republish:publication_blocked===0});result.set(row.product_id,entries);}
 return result;
}
