"""Read-only XLSX card parser. No formulas, macros, URLs or external relationships are executed."""
import sys,json,zipfile,xml.etree.ElementTree as E,posixpath,re,hashlib,os
N={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main','r':'http://schemas.openxmlformats.org/officeDocument/2006/relationships','d':'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing','a':'http://schemas.openxmlformats.org/drawingml/2006/main'}
def parse(path,out):
 z=zipfile.ZipFile(path);infos=z.infolist()
 if len(infos)>3000 or len({x.filename for x in infos})!=len(infos) or sum(x.file_size for x in infos)>160*1024*1024:raise ValueError('表格解压内容过大或包含重复条目')
 for x in infos:
  if x.file_size>20*1024*1024 or x.flag_bits&1:raise ValueError('表格包含过大或加密内容')
 def xml(name):
  data=z.read(name)
  if b'<!DOCTYPE' in data.upper() or b'<!ENTITY' in data.upper():raise ValueError('不支持含实体声明的表格')
  return E.fromstring(data)
 def rels(name):
  p=posixpath.join(posixpath.dirname(name),'_rels',posixpath.basename(name)+'.rels')
  if p not in z.namelist():return {}
  return {x.get('Id'):posixpath.normpath(posixpath.join(posixpath.dirname(name),x.get('Target',''))) if not x.get('Target','').startswith('/') else x.get('Target').lstrip('/') for x in xml(p) if x.get('TargetMode')!='External'}
 strings=[''.join(x.itertext()) for x in xml('xl/sharedStrings.xml')] if 'xl/sharedStrings.xml' in z.namelist() else []
 def col(s):
  v=0
  for c in s:v=v*26+ord(c)-64
  return v-1
 products=[];assets={};warnings=[];books=rels('xl/workbook.xml')
 for sheet in xml('xl/workbook.xml').findall('s:sheets/s:sheet',N):
  name=books.get(sheet.get('{'+N['r']+'}id'))
  if not name:continue
  root=xml(name);cells={}
  for c in root.findall('s:sheetData/s:row/s:c',N):
   m=re.fullmatch(r'([A-Z]+)([0-9]+)',c.get('r',''))
   if not m:continue
   v=c.find('s:v',N);value=v.text or '' if v is not None else ''.join(c.find('s:is',N).itertext()) if c.find('s:is',N) is not None else ''
   if c.get('t')=='s':value=strings[int(value)] if value else ''
   # Formula results must be explicitly reviewed, never execute cached formulas.
   if c.find('s:f',N) is not None:value=''
   cells[(int(m[2])-1,col(m[1]))]=value.strip()
  starts=sorted((r,c) for (r,c),v in cells.items() if v in ('产品名称','商品名称'))
  sheetrels=rels(name);pictures=[]
  for draw in root.findall('s:drawing',N):
   dname=sheetrels.get(draw.get('{'+N['r']+'}id'))
   if not dname:continue
   dr=rels(dname)
   for anchor in xml(dname):
    origin=anchor.find('d:from',N);blip=anchor.find('.//a:blip',N)
    if origin is None or blip is None:continue
    media=dr.get(blip.get('{'+N['r']+'}embed'))
    if not media or not media.startswith('xl/media/'):continue
    data=z.read(media)
    if len(data)>10*1024*1024:raise ValueError('单张图片超过10MB')
    asset=hashlib.sha256(data).hexdigest()
    if asset not in assets:
     filename=asset+'.bin';open(os.path.join(out,filename),'wb').write(data);assets[asset]={'id':asset,'file':filename,'bytes':len(data)}
    pictures.append((int(origin.find('d:row',N).text),int(origin.find('d:col',N).text),asset))
  for r,c in starts:
   end=min([nr for nr,nc in starts if nc==c and nr>r]+[max((rr for rr,cc in cells),default=r)+1]);right=min([cc for rr,cc in starts if cc>c]+[c+4]);width=right-c
   # Card image sits to the left of its label column; require it within this card's row interval.
   left=max(0,c-2);pics=[aid for pr,pc,aid in pictures if r<=pr<end and left<=pc<c]
   title=cells.get((r,c+1),'');fields={}
   for rr in range(r,end):
    for cc in range(c,min(right,c+4)):
     label=cells.get((rr,cc),'')
     if label in ('条码','产品成分','产品参数','箱规','描述','零售价','批发价','供货价'):
      stop=min([x for x in range(cc+1,min(right,c+4)) if cells.get((rr,x),'') in ('零售价','批发价','供货价')]+[min(right,c+4)])
      vals=list(dict.fromkeys(cells.get((rr,x),'') for x in range(cc+1,stop) if cells.get((rr,x),'')))
      fields[label]=vals
   barcodes=list(dict.fromkeys(re.findall(r'(?<!\d)\d{8,14}(?!\d)',' '.join(fields.get('条码',[])))))
   def price(label):
    vals=fields.get(label,[])
    if not vals:return None
    m=re.fullmatch(r'\s*[¥￥]?\s*(\d+(?:\.\d{1,2})?)\s*元?\s*',' '.join(vals))
    return float(m[1]) if m else None
   section=''
   for rr in range(r,-1,-1):
    v=cells.get((rr,0),'')
    if v.endswith('类商品'):section=v;break
   flags=[]
   if len(barcodes)>1:flags.append('多个条码：请逐项确认规格与条码对应关系')
   if not barcodes:flags.append('无条码：使用系统SKU编码，条码保持空缺')
   if not pics:flags.append('未找到对应嵌入图片，请补图后再发布')
   if not title:continue
   products.append({'key':sheet.get('name')+':'+str(r+1)+':'+str(c+1),'title':title,'category_hint':section,'barcodes':barcodes,'cost':price('批发价') if price('批发价') is not None else price('供货价'),'price':price('零售价'),'description':'\n'.join(fields.get('描述',[])),'attributes':[{'name':label,'value':' / '.join(fields[label])} for label in ('产品成分','产品参数') if fields.get(label)],'packaging':' / '.join(fields.get('箱规',[])),'images':list(dict.fromkeys(pics)),'warnings':flags,'sheet':sheet.get('name'),'row':r+1})
 if not products:raise ValueError('未识别到商品卡片；当前支持包含“产品名称、条码、批发价”等标签的左右排列报价单')
 if len(products)>100:raise ValueError('每批最多100个商品卡片，请拆分文件')
 return {'products':products,'assets':list(assets.values()),'warnings':warnings}
if __name__=='__main__':
 try:
  result=parse(sys.argv[1],sys.argv[2]);print(json.dumps(result,ensure_ascii=False))
 except Exception as e:
  print(json.dumps({'error':str(e)},ensure_ascii=False));sys.exit(1)
