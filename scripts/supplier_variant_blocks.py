"""Repeated product blocks with a mixed colour/capacity, barcode and model column."""
import re
from supplier_grid import coordinate


def variant_blocks(cells, pictures, headers, sheet, money, normalize, image_ranges=None):
    if len(headers) < 2:
        return {}
    last = max((r for r, _ in cells), default=0) + 1
    result = {}
    code = re.compile(r'\d{8,14}')
    model = re.compile(r'(?=.*\d)[A-Za-z][A-Za-z0-9]*(?:[-._][A-Za-z0-9]+)+')
    # Opt in by the source header, never by supplier or brand name.
    for i, (header, columns, labels) in enumerate(headers):
        field = columns.get('barcode', columns.get('model'))
        if field is None or not {'title', 'cost', 'price', 'description'} <= columns.keys():
            continue
        label = normalize(labels.get('barcode', labels.get('model', '')))
        if label not in ('颜色/编号', '颜色', '容量'):
            continue
        end = headers[i + 1][0] if i + 1 < len(headers) else last
        footer = [r for (r, _), v in cells.items() if header < r < end and normalize(v).startswith(('订单总额', '订购数量'))]
        if footer:
            end = min(footer)
        values = sorted((r, v.strip()) for (r, c), v in cells.items() if header < r < end and c == field and v.strip())
        # Model-code evidence distinguishes this layout from the existing
        # bilingual capacity parser and ordinary row tables.
        if not any(model.fullmatch(v) for _, v in values):
            continue
        specs = [(r, v) for r, v in values if not code.fullmatch(v) and not model.fullmatch(v) and not re.fullmatch(r'[\d.]+', v)]
        if not specs or any(len(v) > 60 or '\n' in v for _, v in specs):
            continue
        names = sorted((r, c, v.strip()) for (r, c), v in cells.items()
                       if header < r < end and columns['title'] <= c < field and v.strip())
        if not names:
            continue
        flags, variants = [], []
        all_codes = [(r, v) for r, v in values if code.fullmatch(v)]
        for si, (start, spec) in enumerate(specs):
            stop = specs[si + 1][0] if si + 1 < len(specs) else end
            codes = [(r, v) for r, v in all_codes if start <= r < stop]
            models = [(r, v) for r, v in values if start <= r < stop and model.fullmatch(v)]
            if len(codes) != 1 or len(models) != 1:
                raise ValueError('第%d行规格的条码或型号不能唯一配对，请人工核对' % (start + 1))
            refs = {'spec': [coordinate(start + 1, field + 1)],
                    'barcode': [coordinate(codes[0][0] + 1, field + 1)],
                    'model': [coordinate(models[0][0] + 1, field + 1)]}
            sku = {'spec': spec, 'barcode': codes[0][1], 'model': models[0][1], 'stock': '', 'source_refs': refs}
            for key in ('cost', 'price'):
                amounts = [(r, money(v)) for (r, c), v in cells.items() if start <= r < stop and c == columns[key] and money(v) is not None]
                distinct = {v for _, v in amounts}
                sku[key] = next(iter(distinct)) if len(distinct) == 1 else None
                refs[key] = [coordinate(r + 1, columns[key] + 1) for r, _ in sorted(amounts)]
                if len(distinct) != 1:
                    flags.append(spec + '的' + ('采购成本' if key == 'cost' else '售价') + '缺失或冲突，请核对')
            variants.append(sku)
        if len(all_codes) != len(variants) or len({s['barcode'] for s in variants}) != len(variants):
            raise ValueError('第%d行商品块存在未配对或重复条码，请人工核对' % (header + 1))
        if len(variants) > 1 and len({s['model'].rsplit('-', 1)[0] for s in variants}) > 1:
            raise ValueError('第%d行商品块包含不同型号系列，不能自动合并，请人工核对' % (header + 1))
        if len({s['spec'] for s in variants}) != len(variants):
            flags.append('颜色或容量重复，请补充规格后核对')
        # Name cells may be indented within the merged name area. Take the
        # first Chinese and first English name; preserve subsequent slogans
        # in the description rather than making extra products.
        primary = []
        for chinese in (True, False):
            found = next(((r, c, v) for r, c, v in names if ('\n' not in v and len(v) <= 100 and bool(re.search(r'[\u3400-\u9fff]', v)) == chinese)), None)
            if found:
                primary.append(found)
        primary.sort()
        if not primary:
            primary = [names[0]]
            flags.append('商品名称需人工核对')
        title = ' / '.join(v for _, _, v in primary)
        if len(title) > 200:
            title = primary[0][2]
            flags.append('组合名称超过200字，请核对')
        refs = {'title': [coordinate(r + 1, c + 1) for r, c, _ in primary]}
        notes = [v for r, c, v in names if (r, c, v) not in primary]
        def texts(key):
            if key not in columns:
                return []
            pairs = sorted((r, v) for (r, c), v in cells.items() if header < r < end and c == columns[key] and v)
            refs[key] = [coordinate(r + 1, columns[key] + 1) for r, _ in pairs]
            return list(dict.fromkeys(v for _, v in pairs))
        description = texts('description')
        attributes = []
        for key in ('weight', 'specifications', 'ingredients'):
            text = texts(key)
            if text:
                attributes.append({'name': labels[key], 'value': '\n'.join(text)})
        # Preserve supplier model identifiers visibly even though the SKU key
        # remains the barcode. Each model stays paired with its variant.
        attributes.append({'name': '供应商型号', 'value': ' / '.join(s['spec'] + '：' + s['model'] for s in variants)})
        pics = []
        for r, c, aid in pictures:
            if c >= columns['title']:
                continue
            bottom = max(r + 1, (image_ranges or {}).get((r, c), r + 1))
            overlap = lambda a, b: max(0, min(bottom, b) - max(r, a))
            owner = max(range(len(headers)), key=lambda n: overlap(headers[n][0], headers[n + 1][0] if n + 1 < len(headers) else last))
            if owner == i and overlap(header, end):
                pics.append(aid)
        pics = list(dict.fromkeys(pics))
        if not pics:
            flags.append('未找到对应嵌入图片，请补图后再发布')
        elif len(variants) > 1:
            flags.append('商品图片按商品块归属；各颜色SKU图片请人工核对')
        section = next((v for (r, c), v in sorted(cells.items(), reverse=True) if c == 0 and r < header and v and len(v) < 30), '')
        result[header] = {'key': sheet + ':variants:' + str(header + 1), 'title': title,
            'sheet': sheet, 'row': primary[0][0] + 1, 'bounds': [header + 2, end, 1, 16384],
            'barcodes': [s['barcode'] for s in variants], 'variants': variants,
            'cost': variants[0]['cost'] if len(variants) == 1 else None,
            'price': variants[0]['price'] if len(variants) == 1 else None,
            'spec_hint': variants[0]['spec'] if len(variants) == 1 else '',
            'description': '\n\n'.join(description + notes), 'attributes': attributes,
            'packaging': ' / '.join(texts('packaging')), 'category_hint': section,
            'images': pics, 'warnings': flags, 'needs_ai': False,
            'source_refs': {**refs, 'barcode': [ref for s in variants for ref in s['source_refs']['barcode']],
                           'model': [ref for s in variants for ref in s['source_refs']['model']]}}
    return result
