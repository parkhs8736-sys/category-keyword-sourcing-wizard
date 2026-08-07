(() => {
  'use strict';
  const BRIDGE_VERSION = '1.3.0';
  if (window.__WING_LENS_BRIDGE__ === BRIDGE_VERSION) return;
  window.__WING_LENS_BRIDGE__ = BRIDGE_VERSION;

  const ENDPOINT = '/tenants/seller-web/pre-matching/search';

  function findMetrics(value) {
    const queue = [value];
    const visited = new Set();
    const output = [];

    while (queue.length) {
      const current = queue.shift();
      if (!current || typeof current !== 'object' || visited.has(current)) continue;
      visited.add(current);

      if ('pvLast28Day' in current || 'salesLast28d' in current) {
        output.push({
          productId: String(current.productId ?? current.id ?? ''),
          itemId: String(current.itemId ?? ''),
          vendorItemId: String(current.vendorItemId ?? ''),
          productName: String(current.productName ?? current.itemName ?? ''),
          salePrice: current.salePrice ?? null,
          pvLast28Day: current.pvLast28Day ?? null,
          salesLast28d: current.salesLast28d ?? null
        });
      }

      const children = Array.isArray(current) ? current : Object.values(current);
      for (const child of children) {
        if (child && typeof child === 'object') queue.push(child);
      }
    }
    return output;
  }

  async function requestMetric(productId) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        credentials: 'include',
        signal: controller.signal,
        headers: {
          accept: 'application/json, text/plain, */*',
          'content-type': 'application/json;charset=UTF-8',
          'x-requested-with': 'XMLHttpRequest'
        },
        body: JSON.stringify({
          keyword: String(productId),
          excludedProductIds: [],
          searchPage: 0,
          searchOrder: 'DEFAULT',
          sortType: 'DEFAULT'
        })
      });

      if (!response.ok) throw new Error(`쿠팡윙 HTTP ${response.status}`);
      const data = await response.json();
      const items = findMetrics(data);
      const exact = items.find(item => item.productId === String(productId));
      return exact || items[0] || null;
    } finally {
      clearTimeout(timer);
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.kind === 'WL_BRIDGE_PING') {
      sendResponse({ ok: true, version: BRIDGE_VERSION });
      return;
    }
    if (message?.kind !== 'WL_WING_QUERY') return;
    requestMetric(message.productId)
      .then(item => item
        ? sendResponse({ ok: true, item })
        : sendResponse({ ok: false, error: '해당 상품의 PV/판매 데이터가 없습니다.' }))
      .catch(error => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  });
})();
