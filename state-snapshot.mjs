import {performance} from 'node:perf_hooks';
export function measureState(build,report=()=>{}){
 const timings={},start=performance.now();
 const measure=(name,read)=>{const before=performance.now();try{return read();}finally{timings[name]=Math.round((performance.now()-before)*100)/100;}};
 const value=build(measure);report({...timings,total_ms:Math.round((performance.now()-start)*100)/100});return value;
}
export function recentStateJobs(db,owner){
 return db.prepare(`SELECT j.id,j.product_id,j.revision,j.target,j.mall_connection_id,j.status,j.message,j.remote_id,j.created,j.updated,
 s.claimed,CASE WHEN j.target='tigshop' THEN json_extract(s.product,'$.tigshop.fx') END AS fx_json
 FROM jobs j LEFT JOIN job_snapshots s ON s.job_id=j.id WHERE j.owner=? ORDER BY j.created DESC LIMIT 300`).all(owner).map(({claimed,fx_json,...row})=>({...row,claimed:!!claimed,marker:'OPS-'+row.id.replaceAll('-',''),fx:row.target==='tigshop'?fx_json==null?null:JSON.parse(fx_json):null}));
}
