'use strict';

const form = document.querySelector('#search-form');
const keyword = document.querySelector('#keyword');
const rangeButton = document.querySelector('#range-button');
const rangeModal = document.querySelector('#range-modal');
const rangeStartOptions = document.querySelector('#range-start-options');
const rangeEndOptions = document.querySelector('#range-end-options');
const rangeApplyButton = document.querySelector('#range-apply');
const rangeCloseButton = document.querySelector('#range-close');
const runButton = document.querySelector('#run');
const cancelButton = document.querySelector('#cancel');
const exportButton = document.querySelector('#export');
const loginWingButton = document.querySelector('#login-wing');
const loginModal = document.querySelector('#login-modal');
const loginModalTitle = document.querySelector('#login-modal-title');
const loginModalDescription = document.querySelector('#login-modal-description');
const modalLoginButton = document.querySelector('#modal-login');
const modalCloseButton = document.querySelector('#modal-close');
const coupangAccessModal = document.querySelector('#coupang-access-modal');
const coupangAccessDescription = document.querySelector('#coupang-access-description');
const openCoupangLoginButton = document.querySelector('#open-coupang-login');
const closeCoupangAccessButton = document.querySelector('#close-coupang-access');
const reviewModal = document.querySelector('#review-modal');
const reviewModalCard = reviewModal.querySelector('.review-modal-card');
const reviewCloseButton = document.querySelector('#review-close');
const reviewProductName = document.querySelector('#review-product-name');
const reviewTotal = document.querySelector('#review-total');
const reviewExportButton = document.querySelector('#review-export');
const reviewFile = document.querySelector('#review-file');
const reviewCollectorWait = document.querySelector('#review-collector-wait');
const reviewList = document.querySelector('#review-list');
const reviewChart = document.querySelector('#review-chart');
const reviewChartBars = document.querySelector('#review-chart-bars');
const reviewChartRange = document.querySelector('#review-chart-range');
const reviewDate = document.querySelector('#review-date');
const reviewSelectAll = document.querySelector('#review-select-all');
const reviewClearAll = document.querySelector('#review-clear-all');
const reviewResetButton = document.querySelector('#review-reset');
const title = document.querySelector('#title');
const state = document.querySelector('#state');
const empty = document.querySelector('#empty');
const tableBox = document.querySelector('#table-box');
const rows = document.querySelector('#rows');
const METRIC_INTERVAL_MS = 10000;
const MIN_RUN_INTERVAL_MS = 90000;
let runToken = 0;
let lastRunStartedAt = 0;
let startPage = 1;
let endPage = 1;
const sortState = { key: null, direction: 'asc' };
let importedReviews = [];
let activeReviewProduct = null;
let reviewPeriod = 'all';
let reviewRating = 'all';
let reviewGranularity = 'day';
let reviewSummarySelected = true;
let reviewDetailRow = null;

function fitNoWrapText() {
  rows.querySelectorAll('td, .product a').forEach(element => {
    const baseSize = Number(element.dataset.baseFontSize || 12);
    element.dataset.baseFontSize = String(baseSize);
    element.style.fontSize = `${baseSize}px`;
    if (element.scrollWidth > element.clientWidth && element.clientWidth > 0) {
      const fittedSize = Math.max(9, Math.floor(baseSize * element.clientWidth / element.scrollWidth));
      element.style.fontSize = `${fittedSize}px`;
    }
  });
}

function xmlEscape(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function columnName(index) {
  let name = '';
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) name = String.fromCharCode(65 + (value - 1) % 26) + name;
  return name;
}

function parseExportNumber(text) {
  const value = String(text || '').trim();
  if (!value || /확인|조회|실패|^-$/.test(value)) return null;
  const number = Number(value.replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(number)) return null;
  if (value.includes('억원')) return number * 100000000;
  if (value.includes('만원')) return number * 10000;
  return number;
}

function exportRecords() {
  return Array.from(rows.children).filter(row => !row.classList.contains('review-detail-row')).map((row, index) => {
    const cell = row.children;
    return {
      rank: index + 1,
      image: row.querySelector('.product img')?.src || '-',
      productName: cell[1].textContent.trim(),
      productUrl: row.querySelector('.product a')?.href || '-',
      shipping: cell[4].textContent.trim(),
      price: parseExportNumber(cell[2].textContent),
      reviews: parseExportNumber(cell[3].textContent),
      pv: parseExportNumber(cell[5].textContent),
      sales: parseExportNumber(cell[6].textContent),
      revenue: parseExportNumber(cell[7].textContent),
      conversion: parseExportNumber(cell[8].textContent)
    };
  });
}

function buildReviewXlsx(reviews) {
  const headers = ['리뷰 ID', '별점', '리뷰 제목', '리뷰 내용', '작성일', '리뷰 유형', '사진 수', '도움돼요', '상품번호'];
  const values = reviews.map(review => [
    review['리뷰ID'] || '-', Number(review['별점']) || '-', review['리뷰제목'] || '-', review['리뷰내용'] || '-',
    review['작성일'] || '-', review['리뷰유형'] || '-', Number(review['사진수']) || 0, Number(review['도움돼요']) || 0, review['상품번호'] || '-'
  ]);
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="10"/><name val="Malgun Gothic"/></font><font><b/><sz val="10"/><name val="Malgun Gothic"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE5E0CB"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FF555555"/></left><right style="thin"><color rgb="FF555555"/></right><top style="thin"><color rgb="FF555555"/></top><bottom style="thin"><color rgb="FF555555"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="3" fontId="0" fillId="0" borderId="0" applyAlignment="1"><alignment horizontal="right"/></xf><xf numFmtId="10" fontId="0" fillId="0" borderId="0" applyAlignment="1"><alignment horizontal="right"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf></cellXfs></styleSheet>`;
  const sheet = worksheetXml(headers, values, [18, 9, 34, 68, 14, 13, 10, 12, 16], { numericColumns: [1, 6, 7], filter: true });
  return xlsxZip([
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="리뷰분석" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ['xl/styles.xml', styles], ['xl/worksheets/sheet1.xml', sheet]
  ]);
}

function exportReviewResults() {
  const reviews = matchingReviews();
  if (!reviews.length) return;
  const blobUrl = URL.createObjectURL(buildReviewXlsx(reviews));
  const anchor = document.createElement('a');
  const safeName = String(activeReviewProduct?.name || '리뷰분석').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
  anchor.href = blobUrl;
  anchor.download = `${safeName}_리뷰분석.xlsx`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(blobUrl);
}

function cellXml(column, row, value, style = 0, type = 'auto') {
  const ref = `${columnName(column)}${row}`;
  if (value === null || value === undefined) return `<c r="${ref}" s="${style}"/>`;
  const isNumber = type === 'number' || (type === 'auto' && typeof value === 'number' && Number.isFinite(value));
  if (isNumber) return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t>${xmlEscape(value ?? '')}</t></is></c>`;
}

function worksheetXml(headers, values, widths, options = {}) {
  const headerRow = headers.map((value, column) => cellXml(column, 1, value, 1)).join('');
  const dataRows = values.map((record, rowIndex) => `<row r="${rowIndex + 2}">${record.map((value, column) => {
    const numericColumns = options.numericColumns || [];
    const percentColumns = options.percentColumns || [];
    const style = percentColumns.includes(column) ? 3 : numericColumns.includes(column) ? 2 : 0;
    const shouldBeNumber = (numericColumns.includes(column) || percentColumns.includes(column)) && typeof value === 'number' && Number.isFinite(value);
    return cellXml(column, rowIndex + 2, value ?? '-', style, shouldBeNumber ? 'number' : 'auto');
  }).join('')}</row>`).join('');
  const note = options.note ? `<row r="${values.length + 2}"><c r="A${values.length + 2}" s="4" t="inlineStr"><is><t>${xmlEscape(options.note)}</t></is></c></row>` : '';
  const merge = options.note ? `<mergeCells count="1"><mergeCell ref="A${values.length + 2}:${columnName(headers.length - 1)}${values.length + 2}"/></mergeCells>` : '';
  const columns = widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join('');
  const filter = options.filter ? `<autoFilter ref="A1:${columnName(headers.length - 1)}${Math.max(2, values.length + 1)}"/>` : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${columns}</cols><sheetData><row r="1" ht="42" customHeight="1">${headerRow}</row>${dataRows}${note}</sheetData>${filter}${merge}</worksheet>`;
}

function crc32(bytes) {
  let crc = -1;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
  }
  return (crc ^ -1) >>> 0;
}

function xlsxZip(entries) {
  const encoder = new TextEncoder();
  const chunks = []; const central = []; let offset = 0;
  const push32 = (array, value) => array.push(value & 255, value >>> 8 & 255, value >>> 16 & 255, value >>> 24 & 255);
  const push16 = (array, value) => array.push(value & 255, value >>> 8 & 255);
  entries.forEach(([name, content]) => {
    const nameBytes = encoder.encode(name); const data = encoder.encode(content); const crc = crc32(data);
    const local = []; push32(local, 0x04034b50); push16(local, 20); push16(local, 0); push16(local, 0); push16(local, 0); push16(local, 0); push32(local, crc); push32(local, data.length); push32(local, data.length); push16(local, nameBytes.length); push16(local, 0);
    chunks.push(new Uint8Array(local), nameBytes, data);
    const directory = []; push32(directory, 0x02014b50); push16(directory, 20); push16(directory, 20); push16(directory, 0); push16(directory, 0); push16(directory, 0); push16(directory, 0); push32(directory, crc); push32(directory, data.length); push32(directory, data.length); push16(directory, nameBytes.length); push16(directory, 0); push16(directory, 0); push16(directory, 0); push16(directory, 0); push32(directory, 0); push32(directory, offset);
    central.push(new Uint8Array(directory), nameBytes);
    offset += local.length + nameBytes.length + data.length;
  });
  const centralSize = central.reduce((size, item) => size + item.length, 0); const end = [];
  push32(end, 0x06054b50); push16(end, 0); push16(end, 0); push16(end, entries.length); push16(end, entries.length); push32(end, centralSize); push32(end, offset); push16(end, 0);
  return new Blob([...chunks, ...central, new Uint8Array(end)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

function buildXlsx(records) {
  const detailHeaders = ['순위', '이미지', '상품명', '상품 URL', '배송방법', '가격', '리뷰 수', '클릭 수', '월 판매량', '월 매출(원)', '전환율(%)', '소싱상품', '소싱상품 URL', '소싱상품 이미지 URL', '소싱가', '수량', '그로스 입고가', '예상 월매출', '예상 원가율'];
  const detailRows = records.map(record => [record.rank, record.image, record.productName, record.productUrl, record.shipping, record.price, record.reviews, record.pv, record.sales, record.revenue, record.conversion === null ? null : record.conversion / 100, '-', '-', '-', '-', 1, '-', '-', '-']);
  const total = key => records.reduce((sum, record) => sum + (Number(record[key]) || 0), 0);
  const deliveryCount = keyword => records.filter(record => record.shipping.includes(keyword)).length;
  const deliveryReviews = keyword => records.filter(record => record.shipping.includes(keyword)).reduce((sum, record) => sum + (Number(record.reviews) || 0), 0);
  const totalReviews = total('reviews'); const totalSales = total('sales'); const totalRevenue = total('revenue');
  const top = [...records].sort((left, right) => (right.revenue || 0) - (left.revenue || 0));
  const share = (items, key, divisor) => divisor ? items.reduce((sum, item) => sum + (Number(item[key]) || 0), 0) / divisor : 0;
  const summaryHeaders = ['분석조건', '카테고리', '월간 총 판매량', '월간 총 매출', '로켓배송비율', '판매자로켓배송비율', '일반배송비율', '해외배송비율', '총 리뷰 수', '최대 리뷰 수', '평균 리뷰 수', '로켓 리뷰 수', '판매자로켓 리뷰 수', '일반배송 리뷰 수', '해외배송 리뷰 수', '1위 매출 포화도', '1-3위 매출 포화도', '1위 판매 포화도', '1-3위 판매 포화도', '1위 리뷰 포화도', '1-3위 리뷰 포화도'];
  const count = records.length || 1;
  const summaryRows = [[`${startPage}~${endPage}페이지`, keyword.value.trim(), totalSales, totalRevenue, deliveryCount('로켓') / count, 0, (deliveryCount('국내') + deliveryCount('설치')) / count, deliveryCount('해외') / count, totalReviews, Math.max(0, ...records.map(record => record.reviews || 0)), totalReviews / count, deliveryReviews('로켓'), 0, deliveryReviews('국내') + deliveryReviews('설치'), deliveryReviews('해외'), share(top.slice(0, 1), 'revenue', totalRevenue), share(top.slice(0, 3), 'revenue', totalRevenue), share(top.slice(0, 1), 'sales', totalSales), share(top.slice(0, 3), 'sales', totalSales), share([...records].sort((left, right) => (right.reviews || 0) - (left.reviews || 0)).slice(0, 1), 'reviews', totalReviews), share([...records].sort((left, right) => (right.reviews || 0) - (left.reviews || 0)).slice(0, 3), 'reviews', totalReviews)]];
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="10"/><name val="Malgun Gothic"/></font><font><b/><sz val="10"/><name val="Malgun Gothic"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE5E0CB"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FF555555"/></left><right style="thin"><color rgb="FF555555"/></right><top style="thin"><color rgb="FF555555"/></top><bottom style="thin"><color rgb="FF555555"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="3" fontId="0" fillId="0" borderId="0" applyAlignment="1"><alignment horizontal="right"/></xf><xf numFmtId="10" fontId="0" fillId="0" borderId="0" applyAlignment="1"><alignment horizontal="right"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf></cellXfs></styleSheet>`;
  const sheet1 = worksheetXml(summaryHeaders, summaryRows, [13, 34, 13, 16, 13, 16, 13, 13, 12, 12, 12, 12, 16, 14, 14, 15, 16, 15, 16, 15, 16], { numericColumns: [2, 3, 8, 9, 10, 11, 12, 13, 14], percentColumns: [4, 5, 6, 7, 15, 16, 17, 18, 19, 20], note: '※ 위 내용은 키워드 분석 요약 입니다. 2번 시트(shoppingList 시트)에 상품 상세 리스트가 포함되어 있습니다.' });
  const sheet2 = worksheetXml(detailHeaders, detailRows, [8, 38, 56, 55, 13, 12, 11, 11, 12, 15, 12, 13, 30, 34, 12, 8, 14, 14, 14], { numericColumns: [0, 5, 6, 7, 8, 9, 15], percentColumns: [10], filter: true });
  return xlsxZip([
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="dashBoard" sheetId="1" r:id="rId1"/><sheet name="shoppingList" sheetId="2" r:id="rId2"/></sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ['xl/styles.xml', styles], ['xl/worksheets/sheet1.xml', sheet1], ['xl/worksheets/sheet2.xml', sheet2]
  ]);
}

function exportResults() {
  const records = exportRecords();
  if (!records.length) return;
  const blobUrl = URL.createObjectURL(buildXlsx(records));
  const anchor = document.createElement('a');
  const safeKeyword = (keyword.value.trim() || '쿠팡_분석').replace(/[\\/:*?"<>|]/g, '_');
  anchor.href = blobUrl;
  anchor.download = `${safeKeyword}_${startPage}~${endPage}페이지_분석결과.xlsx`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(blobUrl);
}

const CATEGORY_TERMS = [
  '김치냉장고', '전기자전거', '공기청정기', '전자레인지', '의류건조기',
  '냉장고', '냉동고', '선풍기', '청소기', '에어컨', '세탁기', '건조기',
  '가습기', '제습기', '자전거', '노트북', '모니터', '키보드', '마우스',
  '침대', '의자', '책상', '텔레비전', 'TV'
].sort((left, right) => right.length - left.length);

function normalizeSearchText(value) {
  return String(value || '').replace(/\s+/g, '').toLowerCase();
}

function productsMatchingQuery(products, query) {
  const normalizedQuery = normalizeSearchText(query);
  const category = CATEGORY_TERMS.find(term => normalizedQuery.includes(normalizeSearchText(term)));
  if (category) {
    const normalizedCategory = normalizeSearchText(category);
    return products.filter(product => normalizeSearchText(product.name).includes(normalizedCategory));
  }

  const words = String(query || '').trim().split(/\s+/).filter(word => word.length >= 2);
  if (!words.length) return [];
  return products.filter(product => {
    const name = normalizeSearchText(product.name);
    return words.every(word => name.includes(normalizeSearchText(word)));
  });
}

function runtimeMessage(payload) {
  return new Promise(resolve => chrome.runtime.sendMessage(payload, response => {
    const error = chrome.runtime.lastError;
    resolve(error ? { ok: false, error: error.message } : response);
  }));
}

function showLoginModal(titleText = '쿠팡윙을 먼저 로그인 하셔야 합니다', descriptionText = '쿠팡윙 로그인 후 분석 시작 버튼을 다시 눌러주세요.') {
  loginModalTitle.textContent = titleText;
  loginModalDescription.textContent = descriptionText;
  loginModal.hidden = false;
}

function showCoupangReloginModal(message) {
  coupangAccessDescription.textContent = message || '쿠팡 접근 제한 또는 로그인 세션 문제로 조회를 중단했습니다. 일반 쿠팡 홈에서 로그인 후 잠시 뒤 다시 시도해 주세요.';
  coupangAccessModal.hidden = false;
}

function isWingLoginError(errorMessage) {
  return /로그인|HTTP\s*401|쿠팡윙.*탭|인증|세션/i.test(String(errorMessage || ''));
}

function isCoupangAccessLimitError(errorMessage) {
  return /접근.*차단|captcha|자동화|too many|HTTP\s*(403|429)|요청.*제한/i.test(String(errorMessage || ''));
}

function showWingLoginStatus(status) {
  const nextAccount = selectNextSellerAccount();
  const accountGuide = nextAccount
    ? ` 다음 로그인 대상은 “${nextAccount.alias}”입니다. 로그인 창에서 해당 계정으로 직접 로그인해 주세요.`
    : '';
  modalLoginButton.textContent = nextAccount ? `“${nextAccount.alias}” 로그인 창 열기` : '쿠팡윙 로그인 하기';
  if (status?.code === 'incognito_not_allowed') {
    showLoginModal('시크릿 모드 사용을 허용해 주세요', `chrome://extensions에서 카테고리 소싱판별 · 윙렌즈의 세부정보를 열고 “시크릿 모드에서 허용”을 켜 주세요.${accountGuide}`);
  } else if (status?.code === 'wing_tab_not_found') {
    showLoginModal('시크릿 쿠팡윙 로그인 탭이 없습니다', `윙렌즈의 “쿠팡윙 로그인 하기”로 열린 시크릿 창에서 wing.coupang.com 로그인을 완료한 뒤, 그 탭을 열어 두세요.${accountGuide}`);
  } else {
    showLoginModal('쿠팡윙을 재접속 해주세요', `시크릿 쿠팡윙 탭의 로그인 세션을 확인하지 못했습니다. 해당 탭에서 다시 로그인한 뒤 재조회하세요.${accountGuide}`);
  }
}

async function openWingLogin() {
  const result = await runtimeMessage({ kind: 'WL_OPEN_WING_LOGIN' });
  if (result?.code === 'incognito_not_allowed') {
    showLoginModal('시크릿 모드 사용을 허용해 주세요', 'chrome://extensions에서 카테고리 소싱판별 · 윙렌즈의 세부정보를 열고 “시크릿 모드에서 허용”을 켠 뒤 다시 로그인해 주세요.');
  }
}

function renderRangeOptions() {
  const createOption = (pageNumber, type) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = `${pageNumber}페이지`;
    button.classList.toggle('selected', type === 'start' ? pageNumber === startPage : pageNumber === endPage);
    button.addEventListener('click', () => {
      if (type === 'start') {
        startPage = pageNumber;
        if (endPage < startPage) endPage = startPage;
      } else {
        endPage = pageNumber;
        if (startPage > endPage) startPage = endPage;
      }
      renderRangeOptions();
    });
    return button;
  };
  rangeStartOptions.replaceChildren(...Array.from({ length: 8 }, (_, index) => createOption(index + 1, 'start')));
  rangeEndOptions.replaceChildren(...Array.from({ length: 8 }, (_, index) => createOption(index + 1, 'end')));
}

function updateRangeButton() {
  rangeButton.textContent = `${startPage}페이지 ~ ${endPage}페이지`;
}

function numberText(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString('ko-KR') : '-';
}

function percentText(sales, pv) {
  const sold = Number(sales);
  const views = Number(pv);
  return Number.isFinite(sold) && Number.isFinite(views) && views > 0 ? `${(sold / views * 100).toFixed(2)}%` : '-';
}

function revenueText(sales, price) {
  const value = Number(sales) * Number(price);
  if (!Number.isFinite(value)) return '-';
  if (value >= 100000000) return `${(value / 100000000).toFixed(2).replace(/\.00$/, '')}억원`;
  if (value >= 10000) return `${(value / 10000).toFixed(1).replace(/\.0$/, '')}만원`;
  return `${numberText(value)}원`;
}

const sortColumnIndex = { rank: 0, product: 1, price: 2, reviews: 3, shipping: 4, pv: 5, sales: 6, revenue: 7, conversion: 8 };

function sortableValue(row, key) {
  if (key === 'rank') return Number(row.dataset.originalIndex || 0);
  const text = row.children[sortColumnIndex[key]].textContent.trim();
  if (key === 'product' || key === 'shipping') return text;
  if (/확인|조회|실패|^-$/.test(text)) return null;
  const number = Number(text.replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(number)) return null;
  if (key === 'revenue') {
    if (text.includes('억원')) return number * 100000000;
    if (text.includes('만원')) return number * 10000;
  }
  return number;
}

function updateVisualRanks() {
  Array.from(rows.children).forEach((row, index) => { row.children[0].textContent = String(index + 1); });
}

function sortRows(key) {
  closeReviewDetail();
  sortState.direction = sortState.key === key && sortState.direction === 'asc' ? 'desc' : 'asc';
  sortState.key = key;
  const direction = sortState.direction === 'asc' ? 1 : -1;
  const sortedRows = Array.from(rows.children).sort((left, right) => {
    const leftValue = sortableValue(left, key);
    const rightValue = sortableValue(right, key);
    if (leftValue === null) return 1;
    if (rightValue === null) return -1;
    if (typeof leftValue === 'string') return leftValue.localeCompare(rightValue, 'ko') * direction;
    return (leftValue - rightValue) * direction;
  });
  rows.replaceChildren(...sortedRows);
  updateVisualRanks();
  document.querySelectorAll('th[data-sort] button').forEach(button => {
    button.dataset.direction = button.parentElement.dataset.sort === key ? sortState.direction : '';
    button.title = button.parentElement.dataset.sort === key && sortState.direction === 'asc' ? '현재 오름차순 · 누르면 내림차순' : '현재 내림차순 · 누르면 오름차순';
  });
}

function setSortingEnabled(enabled) {
  document.querySelectorAll('th[data-sort] button').forEach(button => { button.disabled = !enabled; });
}

function applyShippingStyle(cell, shippingMethod) {
  cell.classList.remove('shipping-rocket', 'shipping-install', 'shipping-overseas', 'shipping-normal');
  const method = String(shippingMethod || '');
  if (method.includes('로켓')) cell.classList.add('shipping-rocket');
  else if (method.includes('해외')) cell.classList.add('shipping-overseas');
  else if (method.includes('설치')) cell.classList.add('shipping-install');
  else cell.classList.add('shipping-normal');
}

function closeReviewDetail() {
  if (!reviewDetailRow) return;
  reviewModal.appendChild(reviewModalCard);
  reviewDetailRow.remove();
  reviewDetailRow = null;
}

function openReviewModal(product, reviewCount, sourceRow) {
  if (!sourceRow) return;
  if (reviewDetailRow && activeReviewProduct?.productId === product.productId) {
    closeReviewDetail();
    return;
  }
  closeReviewDetail();
  activeReviewProduct = product;
  reviewProductName.textContent = product.name || '';
  reviewSummarySelected = true;
  reviewDate.value = '';
  reviewExportButton.disabled = true;
  renderReviewAnalysis(reviewCount);
  reviewDetailRow = document.createElement('tr');
  reviewDetailRow.className = 'review-detail-row';
  const detailCell = document.createElement('td');
  detailCell.colSpan = 9;
  detailCell.appendChild(reviewModalCard);
  reviewDetailRow.appendChild(detailCell);
  sourceRow.after(reviewDetailRow);
  collectProductReviews(product, reviewCount);
}

async function collectProductReviews(product, reviewCount) {
  reviewCollectorWait.hidden = false;
  reviewCollectorWait.replaceChildren(Object.assign(document.createElement('strong'), { textContent: '쿠팡 상품평을 수집하고 있습니다…' }), Object.assign(document.createElement('small'), { textContent: '공개된 상품평을 페이지별로 천천히 읽습니다. 창을 닫지 말고 기다려 주세요.' }));
  reviewList.hidden = true; reviewChart.hidden = true;
  const result = await runtimeMessage({ kind: 'WL_REVIEWS', productUrl: product.url, productId: product.productId, reviewCount });
  if (!result?.ok || !Array.isArray(result.reviews)) {
    reviewCollectorWait.replaceChildren(Object.assign(document.createElement('strong'), { textContent: result?.error || '자동 리뷰 수집에 실패했습니다.' }), Object.assign(document.createElement('small'), { textContent: '한이룸 후기 수집기 CSV를 불러와 분석할 수 있습니다.' }));
    return;
  }
  importedReviews = result.reviews.map(review => ({
    '리뷰ID': review.reviewId || '', '별점': String(review.rating || ''), '리뷰제목': review.title || '', '리뷰내용': review.content || '', '작성일': review.date || '',
    '리뷰유형': review.type || 'TEXT', '사진수': String(review.photoCount || 0), '도움돼요': String(review.helpful || 0), '상품번호': String(product.productId || '')
  }));
  reviewPeriod = 'all'; reviewRating = 'all';
  reviewSummarySelected = true;
  renderReviewAnalysis();
}

function parseCsv(text) {
  const parsedRows = []; let record = []; let field = ''; let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { field += '"'; index++; }
      else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ',') { record.push(field); field = ''; }
    else if (character === '\n') { record.push(field.replace(/\r$/, '')); parsedRows.push(record); record = []; field = ''; }
    else field += character;
  }
  if (field || record.length) { record.push(field.replace(/\r$/, '')); parsedRows.push(record); }
  const [header = [], ...data] = parsedRows;
  const keys = header.map(value => value.replace(/^\uFEFF/, '').trim());
  return data.filter(values => values.some(value => value.trim())).map(values => Object.fromEntries(keys.map((key, index) => [key, values[index] ?? ''])));
}

function parseReviewDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
}

function matchingReviews() {
  const productId = String(activeReviewProduct?.productId || '');
  const now = new Date();
  return importedReviews.filter(review => {
    if (productId && String(review['상품번호'] || '') !== productId) return false;
    const rating = Number(review['별점']);
    if (reviewRating !== 'all' && rating !== Number(reviewRating)) return false;
    if (reviewPeriod !== 'all') {
      const date = parseReviewDate(review['작성일']);
      const cutoff = new Date(now.getFullYear() - Number(reviewPeriod), now.getMonth(), now.getDate());
      if (!date || date < cutoff) return false;
    }
    if (reviewDate.value && String(review['작성일'] || '').slice(0, 10) !== reviewDate.value) return false;
    return true;
  });
}

function updateReviewFilterButtons() {
  document.querySelectorAll('[data-review-period]').forEach(button => button.classList.toggle('selected', button.dataset.reviewPeriod === reviewPeriod));
  document.querySelectorAll('[data-review-rating]').forEach(button => button.classList.toggle('selected', button.dataset.reviewRating === reviewRating));
  document.querySelectorAll('[data-review-granularity]').forEach(button => button.classList.toggle('selected', button.dataset.reviewGranularity === reviewGranularity));
  reviewSelectAll.classList.toggle('selected', reviewSummarySelected);
  reviewClearAll.classList.toggle('selected', !reviewSummarySelected);
}

function reviewBucket(dateText) {
  const date = parseReviewDate(dateText);
  if (!date) return '';
  if (reviewGranularity === 'month') return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  if (reviewGranularity === 'week') {
    const monday = new Date(date); monday.setDate(date.getDate() - ((date.getDay() + 6) % 7));
    return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
  }
  return String(dateText || '').slice(0, 10);
}

function renderReviewAnalysis(fallbackCount) {
  const reviews = matchingReviews();
  const count = importedReviews.length ? reviews.length : Number(fallbackCount) || 0;
  reviewTotal.replaceChildren('총 ', Object.assign(document.createElement('b'), { textContent: numberText(count) }), '개의 리뷰가 검색되었습니다.');
  updateReviewFilterButtons();
  const hasImportedReviews = importedReviews.length > 0;
  reviewExportButton.disabled = !reviews.length;
  reviewCollectorWait.hidden = hasImportedReviews;
  reviewList.hidden = !hasImportedReviews;
  reviewChart.hidden = !hasImportedReviews;
  if (!hasImportedReviews) return;
  if (!reviews.length) {
    reviewList.replaceChildren(Object.assign(document.createElement('div'), { className: 'review-collector-wait', textContent: '현재 상품과 일치하는 리뷰가 없거나 선택한 필터에 맞는 리뷰가 없습니다.' }));
    reviewChartBars.replaceChildren();
    return;
  }
  const summary = document.createElement('label'); summary.className = 'review-summary-item';
  const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = reviewSummarySelected;
  checkbox.addEventListener('change', () => { reviewSummarySelected = checkbox.checked; renderReviewAnalysis(); });
  const reviewLabel = document.createElement('span'); reviewLabel.className = 'review-summary-count'; reviewLabel.textContent = `리뷰갯수 ${numberText(reviews.length)}`;
  const productName = document.createElement('strong'); productName.textContent = activeReviewProduct?.name || '상품 리뷰';
  const ratioBox = document.createElement('span'); ratioBox.className = 'review-ratio';
  const ratio = document.createElement('i'); ratio.style.width = reviewSummarySelected ? '100%' : '0%'; ratio.textContent = reviewSummarySelected ? '100%' : '0%'; ratioBox.appendChild(ratio);
  summary.append(checkbox, reviewLabel, productName, ratioBox);
  reviewList.replaceChildren(summary);
  const daily = new Map();
  reviews.forEach(review => { const date = reviewBucket(review['작성일']); if (date) daily.set(date, (daily.get(date) || 0) + 1); });
  const entries = [...daily.entries()].sort(([left], [right]) => left.localeCompare(right));
  const values = entries.slice(-180).map(([, value]) => value);
  const max = Math.max(...values, 1);
  const rangeStart = entries[0]?.[0] || '-'; const rangeEnd = entries.at(-1)?.[0] || '-';
  reviewChartRange.textContent = `차트기간 : ${rangeStart} ~ ${rangeEnd}`;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 1000 150');
  svg.setAttribute('preserveAspectRatio', 'none');
  const points = values.length === 1 ? `0,130 1000,${130 - values[0] / max * 110}` : values.map((value, index) => `${index / Math.max(values.length - 1, 1) * 1000},${130 - value / max * 110}`).join(' ');
  for (let line = 0; line < 5; line++) {
    const grid = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    grid.setAttribute('x1', '0'); grid.setAttribute('x2', '1000'); grid.setAttribute('y1', String(20 + line * 27.5)); grid.setAttribute('y2', String(20 + line * 27.5)); grid.setAttribute('class', 'review-chart-grid'); svg.appendChild(grid);
  }
  const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  polyline.setAttribute('points', points || '0,130 1000,130'); polyline.setAttribute('class', 'review-chart-line'); svg.appendChild(polyline);
  reviewChartBars.replaceChildren(svg);
}

async function importReviewCsv(file) {
  const text = await file.text();
  const records = parseCsv(text);
  const required = ['리뷰ID', '별점', '작성일', '상품번호'];
  if (!records.length || !required.every(key => Object.prototype.hasOwnProperty.call(records[0], key))) throw new Error('한이룸 후기 수집기 CSV 형식이 아닙니다.');
  importedReviews = records;
  reviewPeriod = 'all'; reviewRating = 'all';
  reviewSummarySelected = true;
  reviewDate.value = '';
  renderReviewAnalysis();
}

function renderReviewCell(cell, product, reviewCount) {
  const count = Number(reviewCount);
  const hasReviews = Number.isFinite(count) && count > 0;
  const wrapper = document.createElement('div');
  wrapper.className = 'review-cell';
  const countText = document.createElement('span');
  countText.textContent = hasReviews ? numberText(count) : '-';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'review-analyze';
  button.textContent = '리뷰분석⌄';
  button.disabled = !hasReviews;
  button.addEventListener('click', () => openReviewModal(product, count, cell.closest('tr')));
  wrapper.append(countText, button);
  cell.replaceChildren(wrapper);
}

function createRow(product, index) {
  const row = document.createElement('tr');
  row.dataset.originalIndex = String(index + 1);
  const cell = Array.from({ length: 9 }, () => document.createElement('td'));
  cell[0].textContent = String(index + 1).padStart(2, '0');
  cell[0].className = 'number';

  const productBox = document.createElement('div');
  productBox.className = 'product';
  if (product.image) {
    const image = document.createElement('img');
    image.src = product.image; image.alt = '';
    image.addEventListener('error', () => image.remove());
    productBox.appendChild(image);
  }
  const link = document.createElement('a');
  link.href = product.url; link.target = '_blank'; link.rel = 'noreferrer'; link.textContent = product.name;
  productBox.appendChild(link); cell[1].appendChild(productBox);
  cell[2].textContent = product.price ? `${numberText(product.price)}원` : '확인 대기';
  renderReviewCell(cell[3], product, product.reviewCount);
  cell[4].textContent = '확인 대기';
  applyShippingStyle(cell[4], '');
  cell[5].textContent = '조회 대기'; cell[6].textContent = '조회 대기'; cell[7].textContent = '조회 대기'; cell[8].textContent = '조회 대기';
  for (let position = 2; position <= 8; position++) cell[position].classList.add('number');
  cell[8].classList.add('conversion');
  cell.forEach(item => row.appendChild(item));
  requestAnimationFrame(fitNoWrapText);
  return row;
}

async function runMetrics(products, token) {
  let metricSuccess = 0;
  let metricFailed = 0;
  let shippingFailed = 0;
  let lastMetricError = '';
  for (let index = 0; index < products.length; index++) {
    if (token !== runToken) return;
    const product = products[index];
    const row = rows.children[index];
    row.classList.add('working');
    state.textContent = `${index + 1} / ${products.length} · 상세 배송정보와 쿠팡윙 지표 조회 중`;
    row.title = '상세페이지 배송방법과 쿠팡윙 지표 조회 중';

    const [shippingResult, metricResult] = await Promise.all([
      runtimeMessage({ kind: 'WL_SHIPPING', productUrl: product.url }),
      runtimeMessage({ kind: 'WL_METRIC', productId: product.productId })
    ]);
    if (token !== runToken) return;
    row.classList.remove('working');
    row.children[4].textContent = shippingResult?.ok ? shippingResult.shippingMethod : '-';
    applyShippingStyle(row.children[4], shippingResult?.ok ? shippingResult.shippingMethod : '');
    row.children[4].title = shippingResult?.ok
      ? `상세페이지 배송방법: ${shippingResult.raw}`
      : String(shippingResult?.error || '배송방법 조회 실패');
    if (!shippingResult?.ok) shippingFailed++;
    const verifiedPrice = shippingResult?.price || product.price;
    const verifiedReviewCount = shippingResult?.reviewCount || product.reviewCount;
    row.children[2].textContent = verifiedPrice ? `${numberText(verifiedPrice)}원` : '-';
    renderReviewCell(row.children[3], product, verifiedReviewCount);

    const accessError = [metricResult?.error, shippingResult?.error].find(isCoupangAccessLimitError);
    if (accessError) {
      row.classList.add('error-row');
      row.title = String(accessError).slice(0, 100);
      state.textContent = '쿠팡 접근 제한이 감지되어 조회를 중단했습니다. 잠시 후 다시 시도하세요.';
      runToken++;
      runButton.disabled = false;
      cancelButton.disabled = true;
      exportButton.disabled = !rows.children.length;
      setSortingEnabled(Boolean(rows.children.length));
      showCoupangReloginModal('쿠팡 접근 제한 또는 로그인 세션 문제로 조회를 중단했습니다. 일반 쿠팡 홈에서 로그인 후 최소 90초 뒤 다시 시도해 주세요.');
      return;
    }

    if (metricResult?.ok && metricResult.item) {
      metricSuccess++;
      const item = metricResult.item;
      row.children[5].textContent = numberText(item.pvLast28Day);
      row.children[6].textContent = numberText(item.salesLast28d);
      row.children[7].textContent = revenueText(item.salesLast28d, item.salePrice || verifiedPrice);
      row.children[8].textContent = percentText(item.salesLast28d, item.pvLast28Day);
      row.title = shippingResult?.ok ? '조회 완료' : row.children[4].title;
    } else {
      metricFailed++;
      lastMetricError = String(metricResult?.error || '쿠팡윙 조회 실패');
      row.classList.add('error-row');
      row.title = lastMetricError.slice(0, 100);
      row.children[5].textContent = '조회 실패';
      row.children[5].classList.add('error-value');
      row.children[6].textContent = '-';
      row.children[7].textContent = '-';
      row.children[8].textContent = '-';
      fitNoWrapText();
      if (isWingLoginError(lastMetricError)) {
        const wingStatus = await runtimeMessage({ kind: 'WL_WING_STATUS' });
        if (token !== runToken) return;
        if (!wingStatus?.loggedIn) {
          runToken++;
          runButton.disabled = false;
          cancelButton.disabled = true;
          exportButton.disabled = !rows.children.length;
          showWingLoginStatus(wingStatus);
          return;
        }
      }
    }
    if (index < products.length - 1 && token === runToken) await new Promise(resolve => setTimeout(resolve, METRIC_INTERVAL_MS));
  }

  if (token === runToken) {
    state.textContent = metricFailed
      ? `지표 성공 ${metricSuccess} · 실패 ${metricFailed} · 배송 실패 ${shippingFailed} / ${lastMetricError}`
      : `${products.length}개 분석 완료 · 배송 실패 ${shippingFailed}`;
    runButton.disabled = false;
    cancelButton.disabled = true;
    exportButton.disabled = !rows.children.length;
    setSortingEnabled(true);
  }
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  const query = keyword.value.trim();
  if (!query) return;
  const now = Date.now();
  const remaining = MIN_RUN_INTERVAL_MS - (now - lastRunStartedAt);
  if (remaining > 0) {
    state.textContent = `과도한 요청을 피하기 위해 ${Math.ceil(remaining / 1000)}초 후 다시 분석할 수 있습니다.`;
    return;
  }
  const token = ++runToken;
  runButton.disabled = true; cancelButton.disabled = false;
  exportButton.disabled = true;
  setSortingEnabled(false);
  const wingStatus = await runtimeMessage({ kind: 'WL_WING_STATUS' });
  if (token !== runToken) return;
  if (!wingStatus?.loggedIn) {
    runButton.disabled = false;
    cancelButton.disabled = true;
    showWingLoginStatus(wingStatus);
    return;
  }
  lastRunStartedAt = now;
  const selectedStartPage = startPage;
  const selectedEndPage = endPage;
  title.textContent = `“${query}” · ${selectedStartPage}~${selectedEndPage}페이지 상품 수집 중`;
  state.textContent = `쿠팡 검색 결과 ${selectedStartPage}~${selectedEndPage}페이지 확인 중`;
  empty.hidden = true; tableBox.hidden = false; rows.replaceChildren();

  const search = await runtimeMessage({ kind: 'WL_SEARCH', keyword: query, startPage: selectedStartPage, endPage: selectedEndPage });
  if (token !== runToken) return;
  if (!search?.ok || !search.products?.length) {
    title.textContent = '상품 수집 실패';
    state.textContent = search?.error || '검색 결과가 없습니다.';
    empty.hidden = false; tableBox.hidden = true;
    empty.querySelector('strong').textContent = '쿠팡 검색 결과를 읽지 못했습니다.';
    empty.querySelector('small').textContent = /접근이 일시적으로 차단|검색 결과를 읽지 못했습니다/.test(String(search?.error || ''))
      ? '윙렌즈가 자동으로 연 쿠팡 검색 탭의 접근 상태를 확인한 뒤, 잠시 후 다시 시도하세요.'
      : '쿠팡 로그인 상태와 검색 페이지 접근 여부를 확인하세요.';
    runButton.disabled = false; cancelButton.disabled = true;
    setSortingEnabled(false);
    if (isCoupangAccessLimitError(search?.error)) {
      showCoupangReloginModal('쿠팡 검색 결과 접근이 제한되어 조회를 중단했습니다. 일반 쿠팡 홈에서 로그인 후 최소 90초 뒤 다시 시도해 주세요.');
    }
    return;
  }

  const matchedProducts = productsMatchingQuery(search.products, query);
  if (!matchedProducts.length) {
    title.textContent = '관련 상품을 찾지 못했습니다';
    state.textContent = '검색어와 무관한 상품은 분석 대상에서 제외했습니다.';
    empty.hidden = false; tableBox.hidden = true;
    empty.querySelector('strong').textContent = '검색어와 일치하는 상품이 없습니다.';
    empty.querySelector('small').textContent = '더 구체적인 검색어로 다시 시도하세요.';
    runButton.disabled = false; cancelButton.disabled = true;
    setSortingEnabled(false);
    return;
  }

  const safeProducts = matchedProducts;
  title.textContent = `“${query}” · ${selectedStartPage}~${selectedEndPage}페이지 · ${safeProducts.length}개 안전 조회`;
  state.textContent = `선택한 쿠팡 분석 페이지 범위의 ${safeProducts.length}개 상품을 10초 간격으로 조회합니다.`;
  safeProducts.forEach((product, index) => rows.appendChild(createRow(product, index)));
  fitNoWrapText();
  await runMetrics(safeProducts, token);
});

cancelButton.addEventListener('click', () => {
  runToken++;
  state.textContent = '분석을 중지했습니다';
  runButton.disabled = false;
  cancelButton.disabled = true;
  exportButton.disabled = !rows.children.length;
  setSortingEnabled(Boolean(rows.children.length));
});

exportButton.addEventListener('click', exportResults);
rangeButton.addEventListener('click', () => { renderRangeOptions(); rangeModal.hidden = false; });
rangeCloseButton.addEventListener('click', () => { rangeModal.hidden = true; });
rangeApplyButton.addEventListener('click', () => { updateRangeButton(); rangeModal.hidden = true; });
loginWingButton.addEventListener('click', openWingLogin);
modalLoginButton.addEventListener('click', openWingLogin);
modalCloseButton.addEventListener('click', () => { loginModal.hidden = true; });
openCoupangLoginButton.addEventListener('click', async () => {
  const result = await runtimeMessage({ kind: 'WL_OPEN_COUPANG_LOGIN' });
  if (result?.ok) coupangAccessModal.hidden = true;
  else coupangAccessDescription.textContent = result?.error || '쿠팡 홈을 열지 못했습니다. 새 일반 Chrome 탭에서 쿠팡 홈에 접속해 로그인해 주세요.';
});
closeCoupangAccessButton.addEventListener('click', () => { coupangAccessModal.hidden = true; });
reviewCloseButton.addEventListener('click', closeReviewDetail);
reviewExportButton.addEventListener('click', exportReviewResults);
reviewFile.addEventListener('change', async () => {
  const [file] = reviewFile.files;
  if (!file) return;
  try {
    await importReviewCsv(file);
  } catch (error) {
    reviewCollectorWait.hidden = false;
    reviewCollectorWait.replaceChildren(Object.assign(document.createElement('strong'), { textContent: error.message || 'CSV 파일을 읽지 못했습니다.' }));
    reviewList.hidden = true; reviewChart.hidden = true;
  } finally {
    reviewFile.value = '';
  }
});
document.querySelectorAll('[data-review-period]').forEach(button => button.addEventListener('click', () => {
  reviewPeriod = button.dataset.reviewPeriod;
  renderReviewAnalysis();
}));
document.querySelectorAll('[data-review-rating]').forEach(button => button.addEventListener('click', () => {
  reviewRating = button.dataset.reviewRating;
  renderReviewAnalysis();
}));
document.querySelectorAll('[data-review-granularity]').forEach(button => button.addEventListener('click', () => {
  reviewGranularity = button.dataset.reviewGranularity;
  renderReviewAnalysis();
}));
reviewDate.addEventListener('change', () => renderReviewAnalysis());
reviewSelectAll.addEventListener('click', () => { reviewSummarySelected = true; renderReviewAnalysis(); });
reviewClearAll.addEventListener('click', () => { reviewSummarySelected = false; renderReviewAnalysis(); });
reviewResetButton.addEventListener('click', () => {
  reviewPeriod = 'all'; reviewRating = 'all'; reviewGranularity = 'day'; reviewSummarySelected = true; reviewDate.value = '';
  renderReviewAnalysis();
});
new ResizeObserver(fitNoWrapText).observe(tableBox);
document.querySelectorAll('th[data-sort] button').forEach(button => {
  button.addEventListener('click', () => sortRows(button.parentElement.dataset.sort));
});
updateRangeButton();

// 계정 별칭만 로컬 확장프로그램 저장소에 보관합니다.
// 비밀번호, 쿠키, 토큰은 입력·저장·자동 로그인에 사용하지 않습니다.
const sellerAccountStorageKey = 'wing-lens-seller-account-aliases-v1';
const sellerAccountActiveKey = 'wing-lens-seller-account-active-v1';
const sellerAccountModal = document.querySelector('#seller-account-modal');
const sellerAccountManager = document.querySelector('#seller-account-manager');
const sellerAccountClose = document.querySelector('#seller-account-close');
const sellerAccountAlias = document.querySelector('#seller-account-alias');
const sellerAccountAdd = document.querySelector('#seller-account-add');
const sellerAccountList = document.querySelector('#seller-account-list');

function getSellerAccounts() {
  try {
    const items = JSON.parse(localStorage.getItem(sellerAccountStorageKey) || '[]');
    return Array.isArray(items) ? items.filter(item => typeof item?.alias === 'string' && item.alias.trim()) : [];
  } catch (error) {
    return [];
  }
}

function getActiveSellerAccountId() {
  return localStorage.getItem(sellerAccountActiveKey) || '';
}

function setActiveSellerAccount(id) {
  localStorage.setItem(sellerAccountActiveKey, id || '');
  renderSellerAccounts();
}

function renderSellerAccounts() {
  const accounts = getSellerAccounts();
  const activeId = getActiveSellerAccountId();
  sellerAccountList.replaceChildren();
  if (!accounts.length) {
    sellerAccountList.textContent = '등록된 판매자 계정 별칭이 없습니다.';
    sellerAccountList.style.cssText = 'padding:12px;color:#738096;font-size:12px;text-align:center';
    return;
  }
  sellerAccountList.style.cssText = '';
  accounts.forEach(account => {
    const row = document.createElement('div');
    row.className = `seller-account-row${account.id === activeId ? ' active' : ''}`;
    const name = document.createElement('b');
    name.textContent = account.alias;
    const selected = document.createElement('span');
    selected.textContent = '다음 로그인 대상';
    selected.hidden = account.id !== activeId;
    const selectButton = document.createElement('button');
    selectButton.type = 'button';
    selectButton.className = 'seller-account-select';
    selectButton.textContent = '선택';
    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'seller-account-remove';
    removeButton.textContent = '삭제';
    selectButton.onclick = () => setActiveSellerAccount(account.id);
    removeButton.onclick = () => {
      const updated = getSellerAccounts().filter(item => item.id !== account.id);
      localStorage.setItem(sellerAccountStorageKey, JSON.stringify(updated));
      if (getActiveSellerAccountId() === account.id) localStorage.setItem(sellerAccountActiveKey, updated[0]?.id || '');
      renderSellerAccounts();
    };
    row.append(name, selected, selectButton, removeButton);
    sellerAccountList.append(row);
  });
}

function selectNextSellerAccount() {
  const accounts = getSellerAccounts();
  if (!accounts.length) return null;
  const activeIndex = accounts.findIndex(account => account.id === getActiveSellerAccountId());
  const next = accounts[(activeIndex + 1 + accounts.length) % accounts.length];
  localStorage.setItem(sellerAccountActiveKey, next.id);
  renderSellerAccounts();
  return next;
}

sellerAccountManager.addEventListener('click', () => { renderSellerAccounts(); sellerAccountModal.hidden = false; });
sellerAccountClose.addEventListener('click', () => { sellerAccountModal.hidden = true; });
sellerAccountModal.addEventListener('click', event => { if (event.target === sellerAccountModal) sellerAccountModal.hidden = true; });
sellerAccountAdd.addEventListener('click', () => {
  const alias = sellerAccountAlias.value.trim();
  const accounts = getSellerAccounts();
  if (!alias) { sellerAccountAlias.focus(); return; }
  if (accounts.length >= 5) { alert('판매자 계정 별칭은 최대 5개까지 등록할 수 있습니다.'); return; }
  if (accounts.some(account => account.alias === alias)) { alert('같은 별칭이 이미 등록되어 있습니다.'); return; }
  const account = { id: crypto.randomUUID(), alias };
  accounts.push(account);
  localStorage.setItem(sellerAccountStorageKey, JSON.stringify(accounts));
  if (!getActiveSellerAccountId()) localStorage.setItem(sellerAccountActiveKey, account.id);
  sellerAccountAlias.value = '';
  renderSellerAccounts();
});
sellerAccountAlias.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); sellerAccountAdd.click(); } });

// 소싱판별 화면은 같은 확장프로그램 안의 iframe으로 열립니다.
// iframe은 키워드만 전달하며, 쿠팡/쿠팡윙 로그인 정보에는 접근하지 않습니다.
const sourcingPanel = document.querySelector('#sourcing-panel');
const openSourcingButton = document.querySelector('#open-sourcing');
const closeSourcingButton = document.querySelector('#close-sourcing');

openSourcingButton.addEventListener('click', () => { sourcingPanel.hidden = false; });
closeSourcingButton.addEventListener('click', () => { sourcingPanel.hidden = true; });

window.addEventListener('message', event => {
  if (event.origin !== 'http://localhost:8787') return;
  const query = String(event.data?.keyword || '').trim();
  if (event.data?.kind !== 'SOURCING_OPEN_WING_LENS' || !query) return;

  sourcingPanel.hidden = true;
  keyword.value = query;
  keyword.focus();
  form.requestSubmit();
});
