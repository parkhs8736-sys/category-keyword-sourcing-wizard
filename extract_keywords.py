import io
import json
import sys
import zipfile
import xml.etree.ElementTree as ET

NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
sys.stdout.reconfigure(encoding='utf-8')

def text_of(element):
    return ''.join(node.text or '' for node in element.iter(NS + 't'))

def shared_strings(archive):
    try:
        source = archive.open('xl/sharedStrings.xml')
    except KeyError:
        return []
    values = []
    for _, element in ET.iterparse(source, events=('end',)):
        if element.tag == NS + 'si':
            values.append(text_of(element))
            element.clear()
    return values

def main():
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 100
    filters = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}
    raw = sys.stdin.buffer.read()
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        workbook = ET.fromstring(archive.read('xl/workbook.xml'))
        sheet_name = workbook.find('.//' + NS + 'sheet').attrib.get('name', '첫 번째 시트')
        strings = shared_strings(archive)
        records = []
        matched_count = 0
        fields = {'B': 'keyword', 'C': 'category', 'D': 'brand', 'E': 'shopping', 'F': 'ratio', 'G': 'volume', 'M': 'lastYearVolume', 'N': 'peakMonth', 'Q': 'season', 'U': 'competition', 'T': 'naverPrice', 'Y': 'coupangPrice', 'AC': 'rocketRate', 'AD': 'sellerRocketRate', 'AG': 'overseasReviews'}
        current = {}
        header_found = False
        with archive.open('xl/worksheets/sheet1.xml') as source:
            for event, element in ET.iterparse(source, events=('start', 'end')):
                if event == 'start' and element.tag == NS + 'row':
                    current = {}
                    continue
                if event == 'end' and element.tag == NS + 'c':
                    ref = element.attrib.get('r', '')
                    column = ''.join(char for char in ref if char.isalpha())
                    if column in fields:
                        raw_value = element.findtext(NS + 'v', default='')
                        value = strings[int(raw_value)] if element.attrib.get('t') == 's' and raw_value else raw_value
                        current[fields[column]] = value.strip()
                    element.clear()
                elif event == 'end' and element.tag == NS + 'row':
                    if current.get('keyword') in ('키워드', '검색어'):
                        header_found = True
                    elif header_found and current.get('keyword') and matches(current, filters):
                        matched_count += 1
                        current['deliveryRate'] = str(number(current.get('rocketRate')) + number(current.get('sellerRocketRate')))
                        if limit == 0 or len(records) < limit:
                            records.append(current)
                    element.clear()
    json.dump({'sheetName': sheet_name, 'records': records, 'matchedCount': matched_count, 'appliedFilters': filters}, sys.stdout, ensure_ascii=False)

def number(value):
    try:
        return float(str(value or '').replace(',', '').replace('%', ''))
    except ValueError:
        return 0

def matches(record, filters):
    for key in ('brand', 'shopping'):
        choices = filters.get(key, [])
        if choices and record.get(key, '').strip().upper() not in choices:
            return False
    months = filters.get('peakMonth', [])
    if months and str(int(number(record.get('peakMonth')))) not in months:
        return False
    numeric = {'volume': number(record.get('volume')), 'lastYearVolume': number(record.get('lastYearVolume')), 'naverPrice': number(record.get('naverPrice')), 'coupangPrice': number(record.get('coupangPrice')), 'deliveryRate': (number(record.get('rocketRate')) + number(record.get('sellerRocketRate'))) * 100, 'overseasReviews': number(record.get('overseasReviews'))}
    for key, actual in numeric.items():
        rule = filters.get(key, {})
        value = rule.get('value')
        if value in (None, ''):
            continue
        target = number(value)
        operator = rule.get('operator', 'gte')
        if (operator == 'gte' and actual < target) or (operator == 'lte' and actual > target) or (operator == 'lt' and actual >= target):
            return False
    return True

if __name__ == '__main__':
    main()
