// Resource release versions, distinct from the containing iOS app version.
export const safariCollectorVersion='0.1.20';
export function compareVersions(a,b){
 if(!/^\d+(\.\d+){1,3}$/.test(a)||!/^\d+(\.\d+){1,3}$/.test(b))return null;
 const left=a.split('.').map(Number),right=b.split('.').map(Number);
 for(let i=0;i<4;i++){const d=(left[i]||0)-(right[i]||0);if(d)return Math.sign(d);}
 return 0;
}
