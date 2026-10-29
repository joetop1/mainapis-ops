// Original collector is immutable; editing and approving never changes attribution.
export function productCollectors(db){
 db.exec(`CREATE TABLE IF NOT EXISTS product_collectors(product_id TEXT PRIMARY KEY REFERENCES products(id),sub TEXT NOT NULL,name TEXT NOT NULL DEFAULT '');
 CREATE INDEX IF NOT EXISTS product_collectors_sub ON product_collectors(sub,product_id);`);
 db.exec(`INSERT OR IGNORE INTO product_collectors(product_id,sub,name)
 SELECT id,owner,'' FROM products WHERE owner NOT LIKE 'team:%';
 INSERT OR IGNORE INTO product_collectors(product_id,sub,name)
 SELECT p.id,e.actor,'' FROM products p JOIN team_events e ON e.object_id=p.id AND e.team_id=p.owner AND e.action='product.create'
 WHERE e.actor NOT IN ('','system') ORDER BY e.created,e.id;
 INSERT OR IGNORE INTO product_collectors(product_id,sub,name)
 SELECT p.id,a.owner,'' FROM products p JOIN audit a ON a.object_id=p.id AND a.action='product.create' WHERE a.owner NOT LIKE 'team:%' ORDER BY a.created,a.id;`);
 return {
  record(id,sub,name=''){if(!sub)throw Error('缺少采集人身份');db.prepare('INSERT OR IGNORE INTO product_collectors VALUES(?,?,?)').run(id,sub,String(name||'').slice(0,100));},
  rows(owner,actor,scope='all'){
   if(!['mine','all'].includes(scope))throw Error('采集范围无效');
   return db.prepare(`SELECT p.*,c.sub AS collected_by,c.name AS collector_name FROM products p LEFT JOIN product_collectors c ON c.product_id=p.id WHERE p.owner=? ${scope==='mine'?'AND c.sub=?':''} ORDER BY p.updated DESC,p.id LIMIT 1000`).all(...(scope==='mine'?[owner,actor]:[owner]));
  }
 };
}
