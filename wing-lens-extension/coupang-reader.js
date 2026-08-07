(() => {
  'use strict';
  if (window.__WING_LENS_READER__) return;
  window.__WING_LENS_READER__ = true;

  function productIdFrom(element) {
    const attributes = ['data-product-id', 'data-productid', 'data-click-product-id'];
    for (const name of attributes) {
      const value = element.getAttribute?.(name);
      if (/^\d+$/.test(value || '')) return value;
    }
    const href = element.getAttribute?.('href') || '';
    return href.match(/\/(?:vp\/)?products\/(\d+)/)?.[1] || '';
  }

  function productCard(element) {
    const named = element.closest?.('li[data-product-id], li.search-product, li[class*="product" i], [class*="ProductUnit"]');
    if (named) return named;
    let node = element;
    for (let depth = 0; depth < 7 && node?.parentElement; depth++) {
      node = node.parentElement;
      const box = node.getBoundingClientRect?.();
      if (node.querySelector?.('img') && /[\d,]+\s*원/.test(node.innerText || '') && (!box || box.width < 600)) return node;
    }
    return element;
  }

  function cleanName(card, anchor) {
    const imageAlt = card.querySelector?.('img[alt]')?.getAttribute('alt') || '';
    const titleNode = card.querySelector?.('[class*="name" i], [class*="title" i]');
    const value = imageAlt || titleNode?.textContent || anchor.textContent || '';
    return value.replace(/\s+/g, ' ').trim().slice(0, 180);
  }

  function reviewCountFrom(card) {
    const preferredNodes = card?.querySelectorAll?.('[class*="review-count" i], [class*="rating-total" i], a[href*="review"], [class*="review" i], [class*="rating" i]') || [];
    for (const node of preferredNodes) {
      const text = String(node.textContent || '').replace(/\s+/g, ' ');
      const parenthesized = text.match(/\(([\d,]+)\)/)?.[1];
      const longNumber = text.match(/\b([\d,]{2,})\b/)?.[1];
      if (parenthesized || longNumber) return (parenthesized || longNumber).replace(/,/g, '');
    }
    const text = String(card?.innerText || '').replace(/\s+/g, ' ');
    const patterns = [/상품평\s*([\d,]+)/, /리뷰\s*([\d,]+)/, /후기\s*([\d,]+)/, /\(([\d,]+)\)/];
    for (const pattern of patterns) {
      const value = text.match(pattern)?.[1];
      if (value) return value.replace(/,/g, '');
    }
    return '';
  }

  function priceFrom(card) {
    const prioritySelectors = ['.total-price', '[class*="total-price" i]', '[class*="final-price" i]', '[class*="sale-price" i]', '[class*="price-value" i]', '[data-price]', '[class*="price" i]'];
    const priceNodes = prioritySelectors.flatMap(selector => Array.from(card?.querySelectorAll?.(selector) || []));
    for (const node of priceNodes) {
      const text = `${node.getAttribute?.('data-price') || ''} ${node.textContent || ''}`;
      const value = text.match(/([\d,]{3,})\s*원?/)?.[1];
      if (value) return value.replace(/,/g, '');
    }
    return String(card?.innerText || '').match(/([\d,]{3,})\s*원/)?.[1]?.replace(/,/g, '') || '';
  }

  function relevantProducts(products, keyword) {
    const source = String(keyword || '').trim();
    const compact = source.replace(/\s+/g, '');
    if (compact.length < 2) return products;
    const words = source.split(/\s+/).filter(word => word.length >= 2);
    const terms = Array.from(new Set([...words, compact, compact.slice(0, 3), compact.slice(-3), compact.slice(-2)])).filter(term => term.length >= 2);
    const matched = products.filter(product => {
      const name = String(product.name || '').replace(/\s+/g, '');
      return terms.some(term => name.includes(term));
    });
    return matched;
  }

  function productList(limit = 30) {
    const output = [];
    const seen = new Set();
    // 검색 화면 개편으로 목록의 class 이름이 달라져도, 상품 ID가 포함된 링크는 유지됩니다.
    // 모든 링크를 보조 후보로 읽되 productIdFrom 검사를 통과한 항목만 상품으로 사용합니다.
    const elements = document.querySelectorAll('a, [data-product-id], [data-productid], [data-click-product-id]');

    for (const element of elements) {
      if (output.length >= limit) break;
      const productId = productIdFrom(element);
      if (!productId || seen.has(productId)) continue;
      seen.add(productId);
      const card = productCard(element);
      const href = element.getAttribute?.('href') || `/vp/products/${productId}`;
      const image = card.querySelector?.('img')?.currentSrc || card.querySelector?.('img')?.src || '';
      const price = priceFrom(card);
      output.push({
        productId,
        name: cleanName(card, element) || `상품 ${productId}`,
        price,
        reviewCount: reviewCountFrom(card),
        image,
        url: new URL(href, location.origin).href
      });
    }
    return output;
  }

  function searchResultProducts(limit = 30, keyword = '') {
    const selectorChoices = [
      '#productList > li.search-product',
      '#productList > li',
      'ul.search-product-list > li.search-product',
      'li.search-product'
    ];
    let cards = [];
    for (const selector of selectorChoices) {
      cards = Array.from(document.querySelectorAll(selector));
      if (cards.length) break;
    }

    const output = [];
    const seen = new Set();
    const candidateLimit = Math.max(limit * 12, 60);
    for (const card of cards) {
      if (output.length >= candidateLimit) break;
      const anchor = card.querySelector?.('a[href*="/products/"], a[href*="/vp/products/"]');
      if (!anchor) continue;
      const productId = productIdFrom(card) || productIdFrom(anchor);
      if (!productId || seen.has(productId)) continue;
      seen.add(productId);
      const href = anchor.getAttribute('href') || `/vp/products/${productId}`;
      const image = card.querySelector?.('img')?.currentSrc || card.querySelector?.('img')?.src || '';
      const price = priceFrom(card);
      output.push({
        productId,
        name: cleanName(card, anchor) || `상품 ${productId}`,
        price,
        reviewCount: reviewCountFrom(card),
        image,
        url: new URL(href, location.origin).href
      });
    }
    // 기존 목록과 새 목록이 함께 표시되는 경우가 있어, ID 기반 후보도 합쳐 누락을 막습니다.
    const fallback = productList(candidateLimit);
    const merged = new Map();
    [...output, ...fallback].forEach(product => {
      const key = String(product.productId || product.url || '');
      if (key && !merged.has(key)) merged.set(key, product);
    });
    return [...merged.values()];
  }

  function coupangPageProblem() {
    const text = String(document.body?.innerText || '').replace(/\s+/g, ' ');
    const currentUrl = String(location.href || '');
    const currentHost = String(location.hostname || '');
    if (
      /Access Denied|You don't have permission to access|errors\.edgesuite\.net|요청하신 페이지의 사용권한이 없습니다|사용권한이 없습니다|접근 권한이 없습니다|접근이 제한|접속이 제한|비정상적인 접근|서비스 이용이 제한|자동화된 접근|captcha/i.test(text)
    ) {
      return {
        code: 'access_denied',
        error: '쿠팡 페이지 접근이 제한되었습니다. 자동 재시도하지 말고 잠시 후 로그인 상태를 직접 확인해 주세요.'
      };
    }
    if (
      /^(?:login|xauth|account)\.coupang\.com$/i.test(currentHost)
      || /\/(?:login|signin|sign-in|auth)(?:\/|$)/i.test(currentUrl)
    ) {
      return {
        code: 'login_redirect',
        error: '쿠팡 로그인 화면으로 이동했습니다. 다시 로그인한 뒤 시도해 주세요.'
      };
    }
    return null;
  }

  function pageProblemError() {
    const problem = coupangPageProblem();
    if (!problem) return null;
    const error = new Error(problem.error);
    error.code = problem.code;
    return error;
  }

  function valueFromStructuredData() {
    let price = '';
    let reviewCount = '';
    const seen = new Set();
    const visit = value => {
      if (!value || typeof value !== 'object' || seen.has(value)) return;
      seen.add(value);
      if (!price) {
        const candidate = value.price ?? value.salePrice ?? value.lowPrice;
        if (candidate != null && /^\d[\d,]*$/.test(String(candidate))) price = String(candidate).replace(/,/g, '');
      }
      if (!reviewCount) {
        const candidate = value.reviewCount ?? value.ratingCount ?? value.review_count;
        if (candidate != null && /^\d[\d,]*$/.test(String(candidate))) reviewCount = String(candidate).replace(/,/g, '');
      }
      for (const child of Array.isArray(value) ? value : Object.values(value)) visit(child);
    };
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try { visit(JSON.parse(script.textContent || '')); } catch (error) {}
    }
    return { price, reviewCount };
  }

  function detailProductFields() {
    const structured = valueFromStructuredData();
    return {
      price: priceFrom(document) || structured.price,
      reviewCount: reviewCountFrom(document) || structured.reviewCount
    };
  }

  function extensionMessage(payload) {
    return new Promise(resolve => {
      try {
        if (!chrome || !chrome.runtime || !chrome.runtime.id) {
          resolve({ ok: false, error: '확장프로그램이 새로고침되었습니다. 쿠팡 페이지를 새로고침한 뒤 다시 실행해 주세요.', code: 'context_invalidated' });
          return;
        }
        chrome.runtime.sendMessage(payload, response => {
          try {
            const error = chrome.runtime.lastError;
            resolve(error ? { ok: false, error: error.message, code: /context invalidated/i.test(error.message || '') ? 'context_invalidated' : '' } : response);
          } catch (error) {
            resolve({ ok: false, error: '확장프로그램이 새로고침되었습니다. 쿠팡 페이지를 새로고침한 뒤 다시 실행해 주세요.', code: 'context_invalidated' });
          }
        });
      } catch (error) {
        const invalidated = /context invalidated/i.test(error?.message || '');
        resolve({ ok: false, error: invalidated ? '확장프로그램이 새로고침되었습니다. 쿠팡 페이지를 새로고침한 뒤 다시 실행해 주세요.' : (error?.message || '윙렌즈 확장프로그램과 통신하지 못했습니다.'), code: invalidated ? 'context_invalidated' : '' });
      }
    });
  }

  function mappedShippingMethod(rawValue) {
    const raw = String(rawValue || '').replace(/\s+/g, '').trim();
    if (raw.includes('업체직송')) return { raw: '업체직송', label: '국내' };
    if (raw.includes('설치배송')) return { raw: '설치배송', label: '설치' };
    if (raw.includes('순차배송')) return { raw: '순차배송', label: '로켓' };
    if (raw.includes('해외직구')) return { raw: '해외직구', label: '해외' };
    return null;
  }

  function shippingMethodInDocument() {
    const rows = document.querySelectorAll('tr');
    for (const row of rows) {
      const cells = row.querySelectorAll('th, td');
      if (cells.length < 2) continue;
      const label = String(cells[0].textContent || '').replace(/\s+/g, ' ').trim();
      if (!label.includes('배송방법')) continue;
      const mapped = mappedShippingMethod(cells[1].textContent);
      if (mapped) return mapped;
    }

    const pageText = String(document.body?.innerText || '').replace(/\s+/g, ' ');
    const match = pageText.match(/배송방법\s*(업체직송|설치배송|순차배송|해외직구)/);
    return mappedShippingMethod(match?.[1]);
  }

  async function readShippingFromDetail() {
    const initialProblem = pageProblemError();
    if (initialProblem) throw initialProblem;
    const tabs = Array.from(document.querySelectorAll('a, button, li, [role="tab"]'));
    const shippingTab = tabs.find(element => {
      const text = String(element.textContent || '').replace(/\s+/g, ' ').trim();
      return text === '배송/교환/반품 안내' || text.includes('배송/교환/반품 안내');
    });
    if (shippingTab) {
      shippingTab.click();
    } else {
      const existing = shippingMethodInDocument();
      if (existing) return existing;
      throw new Error('배송/교환/반품 안내 탭을 찾지 못했습니다.');
    }
    for (let attempt = 0; attempt < 50; attempt++) {
      if (attempt % 10 === 0) {
        const problem = pageProblemError();
        if (problem) throw problem;
      }
      const method = shippingMethodInDocument();
      if (method) return method;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('상세페이지의 배송방법 값을 찾지 못했습니다.');
  }

  function wait(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
  }

  async function openReviewSection() {
    const candidates = Array.from(document.querySelectorAll('a, button, [role="tab"]'));
    const reviewTab = candidates.find(element => {
      const text = String(element.textContent || '').replace(/\s+/g, ' ').trim();
      const href = element.getAttribute?.('href') || '';
      return href.includes('review') || text === '상품평' || /^상품평\s*\d/.test(text) || text.includes('상품평');
    });
    if (reviewTab) {
      reviewTab.click();
      reviewTab.scrollIntoView?.({ block: 'start' });
    }
    for (let attempt = 0; attempt < 35; attempt++) {
      if (document.querySelector('.sdp-review__article__list, [class*="review__article__list" i], article[class*="review" i]')) return;
      await wait(150);
    }
  }

  function reviewCards() {
    const selectors = [
      'li.sdp-review__article__list',
      'div.sdp-review__article__list',
      '[data-review-id]',
      'li[class*="review__article" i]',
      'article[class*="review__article" i]'
    ];
    for (const selector of selectors) {
      const cards = Array.from(document.querySelectorAll(selector)).filter(card => {
        const hasBody = card.querySelector('.sdp-review__article__list__review__content, .js_reviewArticleContent, [data-testid*="review" i]');
        const hasRating = card.querySelector('[aria-label*="점"], [class*="rating" i], [class*="star" i]');
        return Boolean(hasBody || hasRating);
      });
      if (cards.length) return cards;
    }
    return [];
  }

  function reviewText(card, selectors) {
    for (const selector of selectors) {
      const value = card.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim();
      if (value) return value;
    }
    return '';
  }

  function isReviewNoise(value) {
    const compact = String(value || '').replace(/\s+/g, ' ').trim();
    return !compact || /^(도움이 필요|신고하기|도움이 됐어요|\d+명에게 도움이 됐어요|좋아요|답글)$/i.test(compact);
  }

  function reviewBody(card) {
    const selectors = [
      '.sdp-review__article__list__review__content',
      '.js_reviewArticleContent',
      '[data-testid="review-content"]',
      '[data-testid*="review-content" i]',
      '[class*="review__content" i]'
    ];
    for (const selector of selectors) {
      for (const node of card.querySelectorAll(selector)) {
        const value = String(node.textContent || '').replace(/\s+/g, ' ').trim();
        if (!isReviewNoise(value) && !/도움이 됐어요\s*신고하기/.test(value)) return value;
      }
    }
    return '';
  }

  function reviewRecord(card, productId) {
    const allText = String(card.innerText || '').replace(/\s+/g, ' ').trim();
    const ratingText = reviewText(card, ['[aria-label*="점"]', '[class*="rating" i]', '[class*="star" i]']) || allText;
    const width = Number.parseFloat(card.querySelector('[style*="width"]')?.style?.width || '');
    const rating = Number(ratingText.match(/([1-5])\s*점/)?.[1] || (width ? Math.round(width / 20) : 0));
    const dateText = reviewText(card, ['.sdp-review__article__list__info__product-info__reg-date', '[class*="reg-date" i]', '[class*="review-date" i]', 'time']) || allText;
    const dateMatch = dateText.match(/(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
    const date = dateMatch ? `${dateMatch[1]}-${String(dateMatch[2]).padStart(2, '0')}-${String(dateMatch[3]).padStart(2, '0')}` : '';
    const content = reviewBody(card);
    const title = reviewText(card, ['.sdp-review__article__list__review__title', '[data-testid="review-title"]', '[class*="review__title" i]']);
    const helpful = Number((allText.match(/도움돼요\s*([\d,]+)/)?.[1] || '0').replace(/,/g, '')) || 0;
    const photoCount = card.querySelectorAll('[class*="photo" i] img, [class*="image" i] img').length;
    const type = photoCount ? 'PHOTO' : 'TEXT';
    const reviewId = card.getAttribute('data-review-id') || card.id || `${date}-${rating}-${content.slice(0, 50)}`;
    return { reviewId, rating, title, content, date, type, photoCount, helpful, productId };
  }

  function uniqueReviews(productId) {
    const seen = new Set();
    return reviewCards().map(card => reviewRecord(card, productId)).filter(review => {
      const key = `${review.reviewId}|${review.content}`;
      if (seen.has(key)) return false;
      seen.add(key); return Boolean(review.content) && !isReviewNoise(review.content);
    });
  }

  async function clickReviewPage(page) {
    const buttons = Array.from(document.querySelectorAll('a, button'));
    const pageButton = buttons.find(button => String(button.textContent || '').trim() === String(page));
    if (!pageButton) return false;
    const before = uniqueReviews('').map(review => review.reviewId).join('|');
    pageButton.click();
    for (let attempt = 0; attempt < 25; attempt++) {
      await wait(140);
      if (uniqueReviews('').map(review => review.reviewId).join('|') !== before) return true;
    }
    return false;
  }

  async function readProductReviews(productId, maxPages = 35) {
    const problem = pageProblemError();
    if (problem) throw problem;
    await openReviewSection();
    let reviews = uniqueReviews(productId);
    if (!reviews.length) throw new Error('상품 상세페이지에서 공개 리뷰 목록을 찾지 못했습니다.');
    const pageLimit = Math.min(Math.max(Number(maxPages) || 1, 1), 35);
    for (let page = 2; page <= pageLimit; page++) {
      const moved = await clickReviewPage(page);
      if (!moved) break;
      reviews = reviews.concat(uniqueReviews(productId));
      const seen = new Set();
      reviews = reviews.filter(review => {
        const key = `${review.reviewId}|${review.content}`;
        if (seen.has(key)) return false;
        seen.add(key); return true;
      });
      await wait(600);
    }
    return reviews;
  }

  function metricText(item) {
    const pv = Number(item?.pvLast28Day);
    const sales = Number(item?.salesLast28d);
    const rate = Number.isFinite(pv) && pv > 0 && Number.isFinite(sales) ? `${(sales / pv * 100).toFixed(2)}%` : '-';
    const price = Number(item?.salePrice);
    const revenue = Number.isFinite(sales) && Number.isFinite(price) ? sales * price / 10000 : null;
    return [
      ['PV', Number.isFinite(pv) ? pv.toLocaleString('ko-KR') : '-'],
      ['판매', Number.isFinite(sales) ? sales.toLocaleString('ko-KR') : '-'],
      ['전환', rate],
      ['누적매출(만원)', revenue === null ? '-' : `${revenue.toLocaleString('ko-KR', { maximumFractionDigits: 1 })}만원`]
    ];
  }

  function markOverseasProxyThumbnail(card, shipping) {
    const text = String(card?.innerText || card?.textContent || '').replace(/\s+/g, ' ');
    const isOverseasProduct = shipping?.raw === '해외직구' || shipping?.shippingMethod === '해외' || /해외\s*(구매\s*대행|직구)/.test(text);
    card?.classList?.toggle('wl-overseas-proxy-card', isOverseasProduct);
    card?.querySelectorAll?.('img').forEach(image => {
      image.classList.remove('wl-overseas-proxy-thumbnail');
    });
  }

  function attachMetric(product, result, shipping) {
    const candidates = document.querySelectorAll(`[data-product-id="${CSS.escape(product.productId)}"], a[href*="/products/${CSS.escape(product.productId)}"]`);
    for (const candidate of candidates) {
      const card = productCard(candidate);
      markOverseasProxyThumbnail(card, shipping);
      let strip = card.querySelector?.(`.wl-card-metrics[data-product="${CSS.escape(product.productId)}"]`);
      if (!strip) {
        strip = document.createElement('div');
        strip.className = 'wl-card-metrics';
        strip.dataset.product = product.productId;
        card.insertBefore(strip, card.firstChild);
      }
      strip.replaceChildren();
      if (result?.ok && result.item) {
        strip.dataset.state = 'ok';
        metricText(result.item).forEach(([label, value]) => {
          const span = document.createElement('span');
          const name = document.createElement('b'); name.textContent = label;
          const number = document.createElement('strong'); number.textContent = value;
          span.append(name, number); strip.appendChild(span);
        });
      } else {
        strip.dataset.state = 'error';
        strip.textContent = result?.error || '조회 실패';
      }
    }
  }

  async function analyzeCurrentPage(status) {
    const products = productList(20);
    if (!products.length) { status.textContent = '상품을 찾지 못했습니다.'; return; }
    for (let index = 0; index < products.length; index++) {
      status.textContent = `${index + 1}/${products.length} 배송방법 및 지표 조회 중`;
      const shipping = await extensionMessage({ kind: 'WL_SHIPPING', productUrl: products[index].url });
      if (shipping?.code === 'context_invalidated') {
        status.textContent = '확장프로그램이 새로고침되었습니다. 쿠팡 페이지를 새로고침한 뒤 다시 실행해 주세요.';
        return;
      }
      const result = await extensionMessage({ kind: 'WL_METRIC', productId: products[index].productId });
      if (result?.code === 'context_invalidated') {
        status.textContent = '확장프로그램이 새로고침되었습니다. 쿠팡 페이지를 새로고침한 뒤 다시 실행해 주세요.';
        return;
      }
      attachMetric(products[index], result, shipping);
      if (index < products.length - 1) await new Promise(resolve => setTimeout(resolve, 4500));
    }
    status.textContent = `${products.length}개 표시 완료`;
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.kind === 'WL_READ_PRODUCTS') {
      const problem = coupangPageProblem();
      if (problem) {
        sendResponse({ ok: false, ...problem });
        return;
      }
      const products = searchResultProducts(Math.min(Math.max(Number(message.limit) || 20, 1), 240), message.keyword);
      sendResponse(products.length
        ? { ok: true, products }
        : { ok: false, error: '검색어와 일치하는 쿠팡 상품을 찾지 못했습니다.' });
      return;
    }

    if (message?.kind === 'WL_READ_SHIPPING') {
      readShippingFromDetail()
        .then(method => sendResponse({
          ok: true,
          raw: method.raw,
          shippingMethod: method.label,
          ...detailProductFields()
        }))
        .catch(error => sendResponse({ ok: false, error: error.message || String(error), code: error.code || '' }));
      return true;
    }

    if (message?.kind === 'WL_READ_REVIEWS') {
      readProductReviews(String(message.productId || ''), message.maxPages)
        .then(reviews => sendResponse({ ok: true, reviews }))
        .catch(error => sendResponse({ ok: false, error: error.message || String(error), code: error.code || '' }));
      return true;
    }
  });

  const panel = document.createElement('aside');
  panel.id = 'wl-page-tool';
  const title = document.createElement('strong'); title.textContent = '윙렌즈 현재 페이지';
  const button = document.createElement('button'); button.type = 'button'; button.textContent = '지표 표시 시작';
  const status = document.createElement('small'); status.textContent = '쿠팡윙 로그인 탭이 필요합니다.';
  button.addEventListener('click', () => { button.disabled = true; analyzeCurrentPage(status).catch(() => { status.textContent = '확장프로그램 연결이 갱신되었습니다. 쿠팡 페이지를 새로고침한 뒤 다시 실행해 주세요.'; }).finally(() => { button.disabled = false; }); });
  panel.append(title, button, status);
  document.documentElement.appendChild(panel);
})();
