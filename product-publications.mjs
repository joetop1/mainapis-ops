// Read all history for loaded products, independent of the task table's 300-row cap.
// A later failure cannot erase a previously verified creation in the same mall.
export function productPublications(db,owner){
 const rows=db.prepare(`SELECT product_id,target,mall_connection_id,status,revision,remote_id,updated,publication_blocked,verify_job_id,message,job_id,retired FROM (
 SELECT j.product_id,j.target,j.mall_connection_id,j.status,j.revision,j.remote_id,j.updated,j.message,j.id AS job_id,x.job_id IS NOT NULL AS retired,
 CASE WHEN s.claimed=1 AND j.status IN ('awaiting_review','unknown','accepted') THEN j.id END AS verify_job_id,
 MAX(CASE WHEN x.job_id IS NULL AND (j.status<>'failed' OR COALESCE(s.claimed,1)<>0 OR j.remote_id<>'' OR COALESCE(s.candidate_id,'')<>'' OR COALESCE(s.verification_nonce,'')<>'') THEN 1 ELSE 0 END) OVER(PARTITION BY j.product_id,j.target,j.mall_connection_id) AS publication_blocked,
 ROW_NUMBER() OVER(PARTITION BY j.product_id,j.target,j.mall_connection_id ORDER BY (x.job_id IS NULL) DESC,(j.status='succeeded') DESC,j.created DESC,j.id DESC) AS position
 FROM jobs j JOIN (SELECT id FROM products WHERE owner=? ORDER BY updated DESC LIMIT 1000) p ON p.id=j.product_id
 LEFT JOIN job_snapshots s ON s.job_id=j.id
 LEFT JOIN retired_mall_jobs x ON x.job_id=j.id
 WHERE j.owner=?
 ) WHERE position=1`).all(owner,owner);
 const result=new Map();
 for(const row of rows){const entries=result.get(row.product_id)||[];const {publication_blocked,verify_job_id,message,job_id,retired,...publication}=row;entries.push({...publication,...(!retired&&row.status==='succeeded'&&row.remote_id&&row.mall_connection_id?{job_id}:{}),...(retired?{retired:true}:{}),...(verify_job_id?{verify_job_id}:{}),...(message?{message}:{}),can_republish:publication_blocked===0});result.set(row.product_id,entries);}
 const links=db.prepare(`SELECT l.* FROM product_mall_links l
 JOIN (SELECT id FROM products WHERE owner=? ORDER BY updated DESC LIMIT 1000) p ON p.id=l.product_id
`).all(owner);
 for(const link of links){
  const entries=(result.get(link.product_id)||[]).filter(row=>row.mall_connection_id!==link.mall_connection_id);
  entries.push({...link,status:'succeeded',source:'manual_link',can_republish:false});
  result.set(link.product_id,entries);
 }
 return result;
}
