"""Read-only XLSX card and row-table parser. No formulas, macros, URLs or external relationships are executed."""
import sys,json,zipfile,xml.etree.ElementTree as E,posixpath,re,hashlib,os
from supplier_grid import workbook_grid,coordinate
from supplier_capacity import capacity_products
from supplier_variant_blocks import variant_blocks
N={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main','r':'http://schemas.openxmlformats.org/officeDocument/2006/relationships','d':'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing','a':'http://schemas.openxmlformats.org/drawingml/2006/main'}
# Detect header-based catalogs; only explicit title rows become products.
def table_products(cells,pictures,merge_refs,sheet_name,date1904=False,mapping=None,image_ranges=None):
 from datetime import datetime,timedelta
 from decimal import Decimal,InvalidOperation
 aliases={
  'title':('品名','产品名称','商品名称','商品名'), 'model':('型号','产品型号','规格','规格型号','容量'),
  'cost':('批发价','供货价','采购价','成本价'), 'price':('实控售价','零售价','建议零售价','建议售价','日常售价','销售价','售价','市场价'),
  'barcode':('条形码','条码','商品条码','产品条码','颜色/编号','颜色'), 'images':('产品图片','商品图片','图片'),
  'category':('系列','分类','产品系列','产品分类'), 'packaging':('箱规','装箱数','装箱数量'),
  'description':('功能','产品功能','卖点','描述','产品描述'), 'date':('上市时间','上市日期'),
  'position':('定位','产品定位'), 'series_info':('系列特点','系列说明'),
  'dimensions':('产品尺寸','尺寸'), 'accessories':('产品配件',),
  'weight':('重量','重量千克','重量kg','产品重量','净重','净重千克','毛重'),
  'specifications':('产品规格','商品规格','产品参数','规格参数'),
  'ingredients':('产品成分','成分','材质','产品材质')}
 def normalize(text):return re.sub(r'[\s（）()¥￥]','',text).rstrip('元')
 lookup={normalize(label):key for key,labels in aliases.items() for label in labels}
 headers=[];by_row={}
 for (r,c),text in cells.items():by_row.setdefault(r,[]).append((c,text))
 for row in sorted(by_row):
  labels={};columns={}
  for c,text in by_row[row]:
   key=lookup.get(normalize(text))
   if key and key not in columns:columns[key]=c;labels[key]=text
  # Some suppliers split product fields and pricing fields across adjacent header rows.
  if 'title' in columns and 'images' in columns and 'barcode' in columns:
   lower={lookup.get(normalize(t)):(c,t) for c,t in by_row.get(row+1,[]) if normalize(t) in ('批发价','日常售价')}
   if 'cost' in lower and 'price' in lower:
    for key,(c,t) in lower.items():columns[key]=c;labels[key]=t
    headers.append((row+1,columns,labels))
    continue
  if 'title' in columns and ('cost' in columns or 'price' in columns) and len(columns)>=3:headers.append((row,columns,labels))
 if mapping is not None:
  columns=mapping.get('columns')
  start=mapping.get('start_row')
  end=mapping.get('end_row')
  if (type(start) is not int or not 1<=start<=1048576
      or (end is not None and (type(end) is not int or not start<=end<=1048576))
      or not isinstance(columns,dict) or 'title' not in columns
      or any(k not in aliases or type(v) is not int or not 1<=v<=16384 for k,v in columns.items())
      or len(set(columns.values()))!=len(columns)):
   raise ValueError('货盘列映射无效')
  columns={k:v-1 for k,v in columns.items()}
  labels={k:(cells[(start-2,c)] if lookup.get(normalize(cells.get((start-2,c),'')))==k else aliases[k][0]) for k,c in columns.items()}
  manual_blocks=mapping.get('grouping')=='repeated_header'
  if manual_blocks:
   first=start-2
   signature={c:normalize(cells.get((first,c),'')) for c in columns.values() if cells.get((first,c))}
   if columns['title'] not in signature or len(signature)<2:raise ValueError('请选择重复表头下一行作为首个商品行，至少映射两列表头')
   headers=[(r,columns,labels) for r in sorted(by_row) if first<=r and (end is None or r<end) and all(normalize(cells.get((r,c),''))==v for c,v in signature.items())]
  else:headers=[(start-2,columns,labels)]
 if not headers:return None
 merges=[]
 def point(a):
  m=re.fullmatch(r'([A-Z]+)([0-9]+)',a)
  if not m:return None
  col=0
  for c in m[1]:col=col*26+ord(c)-64
  return int(m[2])-1,col-1
 for ref in merge_refs:
  parts=ref.split(':');a=point(parts[0]);b=point(parts[-1])
  if a and b:merges.append((a[0],a[1],b[0],b[1]))
 def value(row,col):
  direct=cells.get((row,col),'')
  if direct:return direct
  for top,left,bottom,right in merges:
   if top<=row<=bottom and left<=col<=right:return cells.get((top,left),'')
  return ''
 def money(raw):
  raw=raw.strip();raw=re.sub(r'^[¥￥]\s*','',raw);raw=re.sub(r'\s*元$','',raw)
  if not re.fullmatch(r'(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,18})?',raw):return None
  amount=Decimal(raw.replace(',','')); rounded=amount.quantize(Decimal('0.01'))
  return float(rounded) if 0<=amount<=99999999 and abs(amount-rounded)<=Decimal('0.000000001') else None
 variant_results=variant_blocks(cells,pictures,headers,sheet_name,money,normalize,image_ranges) if mapping is None else {}
 if mapping is None and not variant_results:
  paired=capacity_products(cells,pictures,headers,sheet_name,money,normalize,value,image_ranges)
  if paired is not None:return paired
 result=[];last=max((r for r,c in cells),default=0)+1
 row_numbers=sorted({r for r,c in cells})
 for index,(header,columns,labels) in enumerate(headers):
  if header in variant_results:
   result.append(variant_results[header]);continue
  end=headers[index+1][0] if index+1<len(headers) else last
  if mapping is not None and mapping.get('end_row') is not None:end=min(end,mapping['end_row'])
  block_rows=[r for r in row_numbers if header<r<end]
  def block_values(key):
   return list(dict.fromkeys(v for r in block_rows if (v:=cells.get((r,columns[key]),'')))) if key in columns else []
  titles=block_values('title')
  costs={money(v) for v in block_values('cost')}-{None}
  prices={money(v) for v in block_values('price')}-{None}
  repeated=sum(other==columns for _,other,_ in headers)>1
  block=(mapping is not None and manual_blocks) or (mapping is None and repeated and {'title','barcode','cost','price','description'}<=columns.keys() and (len(titles)>1 or len(block_rows)>4) and len(costs)<=1 and len(prices)<=1 and bool(costs or prices))
  title_row=next((r for r in block_rows if cells.get((r,columns['title']))),None)
  for row in ([title_row] if block and title_row is not None else block_rows):
   if not header<row<end or (mapping is not None and mapping.get('end_row') is not None and row>=mapping['end_row']):continue
   title=cells.get((row,columns['title']),'').strip()
   if not title or title in ('合计','总计','小计','备注','说明'):continue
   get=lambda key:value(row,columns[key]) if key in columns else ''
   if block:
    def get(key):
     values=block_values(key)
     if key in ('cost','price'):
      amounts=costs if key=='cost' else prices
      return str(next(iter(amounts))) if len(amounts)==1 else ''
     return '\n'.join(values)
   raw_barcode=get('barcode')
   if re.fullmatch(r'\d+(?:\.\d+)?[eE][+-]?\d+',raw_barcode):
    try:raw_barcode=format(Decimal(raw_barcode),'f').split('.')[0]
    except InvalidOperation:pass
   barcodes=list(dict.fromkeys(re.findall(r'(?<!\d)\d{8,14}(?!\d)',raw_barcode)))
   pics=list(dict.fromkeys(aid for pr,pc,aid in pictures if (header<=pr<end if block else pr==row) and (pc==columns['images'] if 'images' in columns else not block or pc<columns['title'])))
   cost,price=money(get('cost')),money(get('price'));flags=[]
   if cost is None:flags.append('采购成本未识别，请人工填写；不使用其他行价格')
   if price is None:flags.append('售价未识别，请人工填写；赠品等文字不自动转成0元')
   original_title=title
   # The verified template uses the whole name column within each repeated-header block.
   orgie_block=bool(block and sheet_name=='Orgie奥姬' and normalize(labels['title'])=='产品名称' and normalize(labels.get('barcode',''))=='颜色/编号' and columns['title']==1)
   needs_ai=bool(block and len(titles)>1 and not orgie_block)
   if orgie_block:
    combined=' / '.join(dict.fromkeys(' '.join(text.split()) for text in titles))
    if len(combined)<=200:title=combined
    else:flags.append('原表完整名称超过200字，保留首行，请核对')
   if needs_ai:flags.append('商品块含多行名称或文案，暂取首行作为名称，请核对')
   if get('images'):flags.append('图片栏备注：'+get('images'))
   if not pics:flags.append('未找到对应嵌入图片，请补图后再发布')
   if not barcodes:flags.append('无条码：使用系统SKU编码，条码保持空缺')
   if len(barcodes)>1:flags.append('多个条码：请逐项确认规格与条码对应关系')
   attributes=[]
   for key in ('model','date','position','series_info','dimensions','accessories','weight','specifications','ingredients'):
    text=get(key)
    if key=='date' and re.fullmatch(r'\d+(?:\.0+)?',text) and 1<=float(text)<=100000:
     text=((datetime(1904,1,1) if date1904 else datetime(1899,12,30))+timedelta(days=float(text))).strftime('%Y-%m-%d')
    if text:attributes.append({'name':labels[key],'value':text})
   spec_hint=get('model')
   if not spec_hint and normalize(labels.get('barcode',''))=='颜色/编号':
    capacities=list(dict.fromkeys(re.findall(r'(?im)^\s*(\d+(?:\.\d+)?\s*(?:ml|毫升|g|克|l|升))\s*$',raw_barcode)))
    if len(capacities)==1 and len(barcodes)<=1:spec_hint=capacities[0]
    if orgie_block and len(barcodes)==1 and not spec_hint:
     colors=[]
     for line in raw_barcode.splitlines():
      text=line.strip()
      match=re.fullmatch(r'(?:颜色|色号|colou?r)\s*[:：]\s*(.{1,30})',text,re.I)
      if match:colors.append(match[1].strip())
      elif re.fullmatch(r'(?:(?:浅|深|亮|哑光)?(?:红|粉|蓝|绿|黄|紫|黑|白|灰|橙|棕|银|金)色|透明|red|pink|blue|green|yellow|purple|black|white|gray|grey|orange|brown|silver|gold|clear)',text,re.I):colors.append(text)
     colors=list(dict.fromkeys(colors))
     if len(colors)==1:spec_hint=colors[0]
   result.append({'key':sheet_name+':table:'+str(row+1),'title':title,'category_hint':get('category'),'barcodes':barcodes,'cost':cost,'price':price,'description':get('description'),'attributes':attributes,'packaging':get('packaging'),'images':pics,'warnings':flags,'sheet':sheet_name,'row':row+1,'spec_hint':spec_hint,'needs_ai':needs_ai,'field_headers':{str(columns[k]+1):label for k,label in labels.items()},'title_column':columns['title']+1,**({'original_title':original_title} if title!=original_title else {}),'bounds':[header+2 if block else row+1,end if block else row+1,1,16384]})
   sources={}
   for key,column in columns.items():
    refs=[]
    for source_row in (block_rows if block else [row]):
     origin_row,origin_column=source_row,column
     if not cells.get((source_row,column)):
      merged=next(((top,left) for top,left,bottom,right in merges if top<=source_row<=bottom and left<=column<=right),None)
      if merged:origin_row,origin_column=merged
     if cells.get((origin_row,origin_column)):
      ref=coordinate(origin_row+1,origin_column+1)
      if ref not in refs:refs.append(ref)
    if refs:sources[key]=refs
   result[-1]['source_refs']=sources
 return result

def parse(path,out,mapping=None,inspect=False,block=None,references=None,ai_blocks=None):
 def coordinate(r,c):
  letters=''
  c+=1
  while c:c,k=divmod(c-1,26);letters=chr(65+k)+letters
  return letters+str(r+1)
 if mapping is not None and (not isinstance(mapping,dict) or not isinstance(mapping.get('sheet'),str) or not isinstance(mapping.get('columns'),dict)):
  raise ValueError('请指定工作表和商品名称列')
 z=zipfile.ZipFile(path);infos=z.infolist()
 if len(infos)>3000 or len({x.filename for x in infos})!=len(infos) or sum(x.file_size for x in infos)>768*1024*1024:raise ValueError('表格解压内容过大或包含重复条目')
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
 products=[];assets={};warnings=[];layouts=[];resolved={};books=rels('xl/workbook.xml');workbook=xml('xl/workbook.xml');properties=workbook.find('s:workbookPr',N);date1904=properties is not None and properties.get('date1904') in ('1','true')
 for sheet in xml('xl/workbook.xml').findall('s:sheets/s:sheet',N):
  if mapping is not None and sheet.get('name')!=mapping['sheet']:continue
  if block is not None and sheet.get('name')!=block['sheet']:continue
  if references is not None and sheet.get('name') not in references:continue
  if ai_blocks is not None and sheet.get('name') not in ai_blocks:continue
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
  if ai_blocks is not None:
   from bisect import bisect_left,bisect_right
   by_row={}
   for (r,c),value in cells.items():
    if value:by_row.setdefault(r+1,[]).append((c,value))
   rows=sorted(by_row)
   for item in ai_blocks[sheet.get('name')]:
    first,last,left,right=item['bounds'];values={};size=0
    for r,c,value in ((row-1,c,value) for row in rows[bisect_left(rows,first):bisect_right(rows,last)] for c,value in by_row[row]):
     if not left<=c+1<=right:continue
     if len(value)>420:continue
     if len(values)>=100 or size+len(value)>6500:break
     values[coordinate(r,c)]=value;size+=len(value)
    resolved[item['key']]=values
   continue
  if references is not None:
   values={}
   for ref in references[sheet.get('name')]:
    m=re.fullmatch(r'([A-Z]{1,3})([1-9][0-9]{0,6})',ref)
    value=cells.get((int(m[2])-1,col(m[1])),'') if m else ''
    if value:values[ref]=value[:4000]
   resolved[sheet.get('name')]=values
   continue
  if block is not None:
   start,end=block['start_row'],block['end_row']
   if type(start) is not int or type(end) is not int or not 1<=start<=end<=1048576 or end-start>=30:raise ValueError('请选择不超过30行的商品块')
   values={coordinate(r,c):v[:800] for (r,c),v in cells.items() if start<=r+1<=end and v}
   if len(values)>180 or sum(map(len,values.values()))>18000:raise ValueError('商品块文字过多，请缩小行范围')
   merged=[]
   for item in root.findall('s:mergeCells/s:mergeCell',N):
    ref=item.get('ref','');m=re.fullmatch(r'[A-Z]+(\d+):[A-Z]+(\d+)',ref)
    if m and int(m[1])<=end and int(m[2])>=start:merged.append(ref)
   anchors=[]
   sheetrels=rels(name)
   for draw in root.findall('s:drawing',N):
    dname=sheetrels.get(draw.get('{'+N['r']+'}id'))
    if not dname:continue
    for anchor in xml(dname):
     origin=anchor.find('d:from',N)
     if origin is None or anchor.find('.//a:blip',N) is None:continue
     r,c=int(origin.find('d:row',N).text),int(origin.find('d:col',N).text)
     end_node=anchor.find('d:to',N)
     last=int(end_node.find('d:row',N).text) if end_node is not None else r
     if r+1<=end and last+1>=start:anchors.append(coordinate(r,c))
   return {'cells':values,'merges':merged[:180],'image_anchors':anchors[:30]}
  if inspect:
   grid=workbook_grid(root,cells,sheet,xml,rels,name)
   rows={}
   for (r,c),v in cells.items():
    if r<30 and c<100 and v:rows.setdefault(r+1,{})[c+1]=v[:100]
   layouts.append({'sheet':sheet.get('name'),'rows':rows,'grid':grid})
   continue
  starts=sorted((r,c) for (r,c),v in cells.items() if v in ('产品名称','商品名称'))
  sheetrels=rels(name);pictures=[];image_spans={}
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
    pr,pc=int(origin.find('d:row',N).text),int(origin.find('d:col',N).text)
    pictures.append((pr,pc,asset))
    end_node=anchor.find('d:to',N)
    if end_node is not None:
     er,ec=end_node.find('d:row',N),end_node.find('d:col',N)
     if er is not None and ec is not None:image_spans[coordinate(pr,pc)]=coordinate(pr,pc)+':'+coordinate(int(er.text),int(ec.text))
  merge_refs=[merge.get('ref','') for merge in root.findall('s:mergeCells/s:mergeCell',N)]
  image_ranges={(pr,pc):int(match[1]) for pr,pc,aid in pictures if (span:=image_spans.get(coordinate(pr,pc))) and (match:=re.fullmatch(r'[A-Z]+[0-9]+:[A-Z]+([0-9]+)',span))}
  tabular=table_products(cells,pictures,merge_refs,sheet.get('name'),date1904,mapping,image_ranges)
  def anchors(product):
   first,last,left,right=product['bounds']
   product['image_anchors']={coordinate(pr,pc):aid for pr,pc,aid in pictures if pr+1<=last and image_ranges.get((pr,pc),pr+1)>=first and left<=pc+1<=right and aid in product['images']}
   product['image_spans']={ref:image_spans[ref] for ref in product['image_anchors'] if ref in image_spans}
   product['merged_ranges']=[ref for ref in merge_refs if (m:=re.fullmatch(r'([A-Z]+)([0-9]+):([A-Z]+)([0-9]+)',ref)) and int(m[2])<=last and int(m[4])>=first and col(m[1])+1<=right and col(m[3])+1>=left][:40]
  if tabular is not None:
   for product in tabular:anchors(product)
   products.extend(tabular);continue
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
   products.append({'key':sheet.get('name')+':'+str(r+1)+':'+str(c+1),'title':title,'category_hint':section,'barcodes':barcodes,'cost':price('批发价') if price('批发价') is not None else price('供货价'),'price':price('零售价'),'description':'\n'.join(fields.get('描述',[])),'attributes':[{'name':label,'value':' / '.join(fields[label])} for label in ('产品成分','产品参数') if fields.get(label)],'packaging':' / '.join(fields.get('箱规',[])),'images':list(dict.fromkeys(pics)),'warnings':flags,'sheet':sheet.get('name'),'row':r+1,'bounds':[r+1,end,left+1,right]})
   anchors(products[-1])
 if block is not None:raise ValueError('工作表不存在')
 if references is not None or ai_blocks is not None:return resolved
 if inspect:return layouts
 if not products:raise ValueError('未识别到商品卡片；支持左右排列商品卡片，或含“品名/产品名称、批发价/售价”等表头的一行一商品清单')
 if len(products)>500:raise ValueError(f'已识别 {len(products)} 件商品，超过单份货盘 500 件上限，未生成预览。')
 return {'products':products,'assets':list(assets.values()),'warnings':warnings}
if __name__=='__main__':
 try:
  arg=sys.argv[3] if len(sys.argv)>3 else None
  if arg in ('references','ai-blocks'):
   with open(sys.argv[4],encoding='utf-8') as f: result=parse(sys.argv[1],sys.argv[2],**{('references' if arg=='references' else 'ai_blocks'):json.load(f)})
   print(json.dumps(result,ensure_ascii=False));sys.exit(0)
  result=parse(sys.argv[1],sys.argv[2],None if arg in (None,'inspect','block') else json.loads(arg),arg=='inspect',json.loads(sys.argv[4]) if arg=='block' else None);print(json.dumps(result,ensure_ascii=False))
 except Exception as e:
  print(json.dumps({'error':str(e)},ensure_ascii=False));sys.exit(1)
