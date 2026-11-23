"""Repeated-header catalogs with capacity/barcode pairs, extracted without AI."""
import re
from supplier_grid import coordinate


def capacity_products(cells, pictures, headers, sheet, money, normalize, value=None, image_ranges=None):
    paired_names = bool(headers and all(
        {'title', 'barcode', 'cost', 'price', 'description'} <= columns.keys()
        and 'model' not in columns and normalize(labels['barcode']) == '颜色/编号'
        for _, columns, labels in headers))
    if paired_names:
        headers = [(r, {**{k: v for k, v in columns.items() if k != 'barcode'}, 'model': columns['barcode']},
                    {**labels, 'model': '容量'}) for r, columns, labels in headers]
    # This is a structural layout, not a supplier-name exception. Ordinary row
    # tables (including ones with a dedicated barcode column) stay on their path.
    required = {'title', 'model', 'cost', 'price', 'description'}
    if len(headers) < 2 or not all(required <= columns.keys()
            and 'barcode' not in columns and normalize(labels['model']) == '容量'
            for _, columns, labels in headers):
        return None
    capacity = re.compile(r'\d+(?:\.\d+)?\s*(?:ml|毫升|g|克|l|升)', re.I)
    barcode = re.compile(r'\d{8,14}')
    last = max((r for r, _ in cells), default=0) + 1
    evidence = sum(bool(capacity.fullmatch(v.strip())) for (r, c), v in cells.items()
                   if any(c == columns['model'] and r > header for header, columns, _ in headers))
    has_barcode = any(barcode.fullmatch(v.strip()) for (r, c), v in cells.items()
                      if any(c == columns['model'] and r > header for header, columns, _ in headers))
    if not evidence or not has_barcode:
        return None
    if paired_names:
        # Only opt in when each block starts with capacity followed by barcode.
        # Other mixed layouts still use the existing review/AI path.
        for i, (header, columns, _) in enumerate(headers):
            end = headers[i+1][0] if i+1 < len(headers) else last
            field = [(r, v.strip()) for (r, c), v in cells.items()
                     if header < r < end and c == columns['model']]
            sizes = [r for r, v in field if capacity.fullmatch(v)]
            codes = [r for r, v in field if barcode.fullmatch(v)]
            if not sizes or not codes or min(codes) < min(sizes):
                return None
    output = []
    for index, (header, columns, labels) in enumerate(headers):
        end = headers[index + 1][0] if index + 1 < len(headers) else last
        rows = sorted({r for r, _ in cells if header < r < end})
        specs = [(r, cells[r, columns['model']].strip()) for r in rows
                 if capacity.fullmatch(cells.get((r, columns['model']), '').strip())]
        if not specs:
            raise ValueError('第%d行后的容量商品块无法配对，请核对容量、条码和价格' % (header + 1))
        names = [(r, cells[r, columns['title']].strip()) for r in rows
                 if cells.get((r, columns['title']), '').strip()]
        if not names:
            raise ValueError('第%d行后的商品块缺少名称，请人工确认' % (header + 1))
        base_title = names[0][1]
        groups = []
        for si, (start, spec) in enumerate(specs):
            stop = specs[si + 1][0] if si + 1 < len(specs) else end
            codes = [(r, cells[r, columns['model']].strip()) for r in rows
                     if start <= r < stop and barcode.fullmatch(cells.get((r, columns['model']), '').strip())]
            if len(codes) != 1:
                raise ValueError('第%d行容量对应的条码不是唯一值，请人工确认商品块' % (start + 1))
            code_row, code = codes[0]
            title, title_row = base_title, names[0][0]
            candidate = cells.get((code_row, columns['title']), '').strip()
            # A second explicit product name (e.g. men's/women's spray) must
            # remain separate; English names and advertising lines are notes.
            if candidate and candidate != base_title and '\n' not in candidate:
                prefix = 0
                for a, b in zip(base_title, candidate):
                    if a != b:
                        break
                    prefix += 1
                suffix = 0
                for a, b in zip(base_title[::-1], candidate[::-1]):
                    if a != b:
                        break
                    suffix += 1
                if prefix >= 3 and suffix >= 4:
                    title, title_row = candidate, code_row
            sku = {'barcode': code, 'spec': spec, 'stock': '', 'source_refs': {
                'spec': [coordinate(start + 1, columns['model'] + 1)],
                'barcode': [coordinate(code_row + 1, columns['model'] + 1)]}}
            flags = []
            for key in ('cost', 'price'):
                values = [(r, money(cells.get((r, columns[key]), ''))) for r in rows if start <= r < stop]
                values = [(r, amount) for r, amount in values if amount is not None]
                amounts = set(v for _, v in values)
                sku[key] = next(iter(amounts)) if len(amounts) == 1 else None
                sku['source_refs'][key] = [coordinate(r + 1, columns[key] + 1) for r, _ in values]
                if len(amounts) != 1:
                    flags.append(spec + '的' + ('成本' if key == 'cost' else '售价') + '缺失或有多个值，请核对')
            if paired_names and candidate and groups and re.search(r'[A-Za-z]', candidate) and re.search(r'[A-Za-z]', groups[-1]['primary']) and candidate != groups[-1]['primary']:
                title, title_row = candidate, code_row
            elif paired_names and groups:
                title, title_row = groups[-1]['title'], groups[-1]['title_row']
            if not groups or groups[-1]['title'] != title:
                groups.append({'title': title, 'title_row': title_row, 'start': start, 'primary': candidate or title, 'variants': [], 'warnings': []})
            groups[-1]['variants'].append(sku)
            groups[-1]['warnings'].extend(flags)
        pics = list(dict.fromkeys(aid for r, c, aid in pictures if header <= r < end and c < columns['title']))
        gender_columns = {normalize(v): c for (r, c), v in cells.items()
                          if header < r < end and normalize(v) in ('男用', '女用')}
        for gi, group in enumerate(groups):
            variants = group['variants']
            warnings = group['warnings']
            group_first = header if gi == 0 else group['start']
            group_end = groups[gi + 1]['start'] if gi + 1 < len(groups) else end
            group_pics = pics
            if paired_names:
                group_pics = []
                shared_picture = False
                for r, c, aid in pictures:
                    if c >= columns['title']:
                        continue
                    bottom = max(r + 1, (image_ranges or {}).get((r, c), r + 1))
                    overlap = lambda first, last: max(0, min(bottom, last) - max(r, first))
                    # An image can start just above the header. Assign it to
                    # the header block with the greatest vertical overlap.
                    owner = max(range(len(headers)), key=lambda i: overlap(headers[i][0], headers[i+1][0] if i+1 < len(headers) else last))
                    if owner != index or not overlap(group_first, group_end):
                        continue
                    group_pics.append(aid)
                    if r < group_first or bottom > group_end:
                        shared_picture = shared_picture or len(groups) > 1
                group_pics = list(dict.fromkeys(group_pics))
                if shared_picture:
                    warnings.append('图片跨越多个商品区域，保留候选图片，请核对归属')
            if len(groups) > 1 and set(gender_columns) == {'男用', '女用'}:
                gender = '男用' if '男' in group['title'] and '女' not in group['title'] else '女用' if '女' in group['title'] and '男' not in group['title'] else None
                if gender:
                    selected = list(dict.fromkeys(aid for r, c, aid in pictures
                                    if header <= r < end and c == gender_columns[gender]))
                    if selected:
                        group_pics = selected
            if not group_pics:
                warnings.append('未找到对应嵌入图片，请补图后再发布')
            if len(groups) > 1 and group_pics == pics:
                warnings.append('同一商品块包含不同名称，共用块内候选图片，请核对并移除不属于此商品的图片')
            if len({s['spec'] for s in variants}) != len(variants):
                warnings.append('容量重复，请补充区分规格后再导入')
            title_refs = [coordinate(group['title_row'] + 1, columns['title'] + 1)]
            if paired_names and re.search(r'[A-Za-z]', group['title']) and not (
                    '\n' in group['title'] and re.search(r'[\u3400-\u9fff]', group['title'])):
                english, chinese, selected_refs = [], '', []
                for r, text in names:
                    if not group_first <= r < group_end:
                        continue
                    # Mixed short brand names (e.g. Discover探索) can precede
                    # a Chinese product name. A later slogan is not a title.
                    lines = [line.strip() for line in text.splitlines() if line.strip()]
                    if not lines:
                        continue
                    selected_refs.append(coordinate(r + 1, columns['title'] + 1))
                    if r != group['title_row'] and re.search(r'[\u3400-\u9fff]', text):
                        chinese = lines[0]
                        break
                    english.append(' '.join(lines))
                combined = ' / '.join(filter(None, [' '.join(dict.fromkeys(english)), chinese]))
                if combined and len(combined) <= 200:
                    group['title'] = combined
                    title_refs = selected_refs
                else:
                    warnings.append('分行名称无法安全合并，请核对')
            def refs(key):
                return [coordinate(r + 1, columns[key] + 1) for r in rows if cells.get((r, columns[key])) and (not paired_names or group_first <= r < group_end or (r < group_first and value and value(group_first, columns[key]) == cells[r, columns[key]]))]
            def texts(key):
                return list(dict.fromkeys((value(r, columns[key]) if value else cells.get((r, columns[key]), '')) for r in rows if (not paired_names or group_first <= r < group_end) and (value(r, columns[key]) if value else cells.get((r, columns[key]), ''))))
            source_refs = {'title': title_refs,
                           'description': refs('description'),
                           'barcode': [ref for s in variants for ref in s['source_refs']['barcode']]}
            for key in ('model', 'cost', 'price'):
                source_refs[key] = list(dict.fromkeys(ref for s in variants for ref in s['source_refs']['spec' if key == 'model' else key]))
            group_end = groups[gi + 1]['start'] if gi + 1 < len(groups) else end
            notes = [v for r, v in names if group['start'] <= r < group_end and v not in {g['title'] for g in groups}]
            attributes = []
            for key in ('weight', 'packaging'):
                if key in columns:
                    attributes.append({'name': labels[key] + '（按原表顺序）', 'value': ' / '.join(texts(key))})
            # In this layout a trailing 规格 column contains long product
            # parameters, not the capacity column selected as model.
            extra_columns = [c for (r, c), v in cells.items() if r == header and normalize(v) in ('规格', '产品规格', '产品参数', '产品成分', '成分', '材质', '产品材质') and c != columns['model']]
            for c in extra_columns:
                values = list(dict.fromkeys((value(r, c) if value else cells.get((r, c), '')) for r in rows if (not paired_names or group_first <= r < group_end) and (value(r, c) if value else cells.get((r, c), ''))))
                if values:
                    attributes.append({'name': '产品参数', 'value': '\n'.join(values)})
                    source_refs['specifications'] = [coordinate(r + 1, c + 1) for r in rows if cells.get((r, c)) and (not paired_names or group_first <= r < group_end)]
            category = next((cells[r, 0].strip() for r in sorted({r for r, c in cells if c == 0 and r < header}, reverse=True)
                             if cells[r, 0].strip().endswith(('系列', '系类'))), '')
            output.append({'key': sheet + ':capacity:' + str(group['title_row'] + 1),
                'title': group['title'], 'sheet': sheet, 'row': group['title_row'] + 1,
                'barcodes': [s['barcode'] for s in variants], 'variants': variants,
                'cost': variants[0]['cost'] if len(variants) == 1 else None,
                'price': variants[0]['price'] if len(variants) == 1 else None,
                'spec_hint': variants[0]['spec'] if len(variants) == 1 else '',
                'description': '\n\n'.join(texts('description') + notes), 'attributes': attributes,
                'category_hint': category, 'packaging': ' / '.join(texts('packaging')) if 'packaging' in columns else '',
                'images': group_pics, 'warnings': warnings, 'needs_ai': False,
                'bounds': [group_first + 1, group_end, 1, 16384] if paired_names else [header + 1, end, 1, 16384], 'source_refs': source_refs})
    return output
