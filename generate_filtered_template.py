import copy
import io
import json
import sys
import zipfile
import xml.etree.ElementTree as ET

NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
QN = lambda tag: f'{{{NS}}}{tag}'
COLUMNS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P']
FIELDS = ['keyword', 'category', 'brand', 'shopping', 'ratio', 'volume', 'lastYearVolume', 'peakMonth', 'season', 'competition', 'naverPrice', 'coupangPrice', 'rocketRate', 'sellerRocketRate', 'deliveryRate', 'overseasReviews']
NUMERIC = {'ratio', 'volume', 'lastYearVolume', 'naverPrice', 'coupangPrice', 'rocketRate', 'sellerRocketRate', 'deliveryRate', 'overseasReviews'}


def number(value):
    try:
        return float(str(value or '').replace(',', '').replace('%', ''))
    except ValueError:
        return None


def set_value(cell, value, numeric):
    for child in list(cell):
        cell.remove(child)
    if numeric:
        parsed = number(value)
        if parsed is not None:
            cell.attrib.pop('t', None)
            ET.SubElement(cell, QN('v')).text = str(parsed)
            return
    cell.attrib['t'] = 'inlineStr'
    inline = ET.SubElement(cell, QN('is'))
    ET.SubElement(inline, QN('t')).text = str(value or '')


def build_row(style_cells, record, row_number):
    row = ET.Element(QN('row'), {'r': str(row_number)})
    for index, (column, field) in enumerate(zip(COLUMNS, FIELDS)):
        cell = copy.deepcopy(style_cells[index])
        cell.attrib['r'] = f'{column}{row_number}'
        set_value(cell, record.get(field, ''), field in NUMERIC)
        row.append(cell)
    return row


def main():
    payload = json.load(sys.stdin)
    records = payload.get('records', [])
    template_path = '필터링_전체_양식.xlsx'
    with zipfile.ZipFile(template_path, 'r') as source:
        entries = {item.filename: source.read(item.filename) for item in source.infolist()}

    sheet = ET.fromstring(entries['xl/worksheets/sheet1.xml'])
    sheet_data = sheet.find(QN('sheetData'))
    rows = list(sheet_data)
    header = copy.deepcopy(rows[0])
    style_cells = list(rows[1])
    sheet_data.clear()
    sheet_data.append(header)
    for index, record in enumerate(records, start=2):
        sheet_data.append(build_row(style_cells, record, index))

    dimension = sheet.find(QN('dimension'))
    if dimension is not None:
        dimension.attrib['ref'] = f'A1:P{max(1, len(records) + 1)}'
    entries['xl/worksheets/sheet1.xml'] = ET.tostring(sheet, encoding='utf-8', xml_declaration=True)

    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as target:
        for name, data in entries.items():
            target.writestr(name, data)
    sys.stdout.buffer.write(output.getvalue())


if __name__ == '__main__':
    main()
