"""Bounded, read-only coordinate metadata for supplier workbook previews."""
import re

NS = {
    "s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "d": "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
}


def coordinate(row, column):
    letters = ""
    while column:
        column, digit = divmod(column - 1, 26)
        letters = chr(65 + digit) + letters
    return letters + str(row)


def column_number(letters):
    value = 0
    for letter in letters:
        value = value * 26 + ord(letter) - 64
    return value


def workbook_grid(root, cells, sheet, xml, rels, name):
    """Sample beginning, middle and end; retain original merges without expansion."""
    all_rows = sorted({row + 1 for row, _ in cells})
    selected = set(range(1, 51))
    if all_rows:
        middle = len(all_rows) // 2
        selected.update(all_rows[max(0, middle - 5):middle + 5])
        selected.update(all_rows[-10:])

    values = {
        coordinate(row + 1, column + 1): value[:300]
        for (row, column), value in cells.items()
        if row + 1 in selected and column < 100 and value
    }
    formulas = {}
    for node in root.findall("s:sheetData/s:row/s:c", NS):
        formula = node.find("s:f", NS)
        ref = node.get("r", "")
        match = re.fullmatch(r"([A-Z]+)([0-9]+)", ref)
        if formula is None or not match or int(match[2]) not in selected:
            continue
        cached = node.find("s:v", NS)
        formulas[ref] = {
            "formula": (formula.text or "")[:300],
            "cached_value": cached.text if cached is not None else None,
            "requires_review": True,
        }

    images = []
    relationships = rels(name)
    for drawing in root.findall("s:drawing", NS):
        drawing_name = relationships.get(drawing.get("{" + NS["r"] + "}id"))
        if not drawing_name:
            continue
        for anchor in xml(drawing_name):
            start = anchor.find("d:from", NS)
            if start is None or anchor.find(".//a:blip", NS) is None:
                continue
            end = anchor.find("d:to", NS)
            first = coordinate(int(start.find("d:row", NS).text) + 1,
                               int(start.find("d:col", NS).text) + 1)
            last = coordinate(int(end.find("d:row", NS).text) + 1,
                              int(end.find("d:col", NS).text) + 1) if end is not None else None
            images.append({"from": first, "to": last, "anchor_type": anchor.tag.rsplit("}", 1)[-1]})

    merges = [node.get("ref", "") for node in root.findall("s:mergeCells/s:mergeCell", NS)]
    hidden_rows = [int(node.get("r")) for node in root.findall("s:sheetData/s:row", NS)
                   if node.get("hidden") in ("1", "true") and node.get("r", "").isdigit()]
    hidden_columns = [
        {"min": int(node.get("min")), "max": int(node.get("max"))}
        for node in root.findall("s:cols/s:col", NS)
        if node.get("hidden") in ("1", "true")
        and node.get("min", "").isdigit() and node.get("max", "").isdigit()
    ]
    truncated = len(merges) > 2000 or len(images) > 1000 or len(hidden_rows) > 5000
    return {
        "version": 1, "sheet_state": sheet.get("state", "visible"),
        "sample_rows": sorted(selected.intersection(all_rows)),
        "cells": values, "formulas": formulas,
        "merged_ranges": merges[:2000], "image_anchors": images[:1000],
        "hidden_rows": hidden_rows[:5000], "hidden_columns": hidden_columns[:1000],
        "row_count": max(all_rows, default=0),
        "column_count": max((column + 1 for _, column in cells), default=0),
        "truncated": truncated,
    }
