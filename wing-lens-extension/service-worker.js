'use strict';

const SEARCH_LOAD_TIMEOUT = 25000;
const WING_LOGIN_URL = 'https://wing.coupang.com/';
const METRIC_CACHE_TTL = 24 * 60 * 60 * 1000;
const SHIPPING_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
const RUN_LEASE_DEFAULT_TTL = 60 * 1000;
const RUN_LEASE_MAX_TTL = 2 * 60 * 1000;
const RUN_LEASE_CACHE_KEY = 'control:run-lease';
const REMOTE_CIRCUIT_CACHE_KEY = 'control:remote-circuit';
const REMOTE_CIRCUIT_STORAGE_TTL = 24 * 60 * 60 * 1000;
const ACCESS_DENIED_COOLDOWN = 30 * 60 * 1000;
const RATE_LIMIT_COOLDOWN = 60 * 60 * 1000;
const CACHE_DB_NAME = 'wing-lens-request-cache';
const CACHE_STORE_NAME = 'entries';
const memoryCache = new Map();
const metricInflight = new Map();
const shippingInflight = new Map();
let cacheDbPromise;
let activeRunLease = null;
let activeRemoteCircuit = null;
let remoteCircuitProbeInProgress = false;
let leaseOperation = Promise.resolve();
let remoteRequestOperation = Promise.resolve();

function requestError(message, options = {}) {
  const error = new Error(message);
  Object.assign(error, options);
  return error;
}

function errorResponse(error) {
  const response = { ok: false, error: error?.message || String(error) };
  if (error?.code) response.code = error.code;
  if (Number.isFinite(error?.status)) response.status = error.status;
  if (Number.isFinite(error?.retryAt)) response.retryAt = error.retryAt;
  if (Number.isFinite(error?.nextAllowedAt)) response.nextAllowedAt = error.nextAllowedAt;
  return response;
}

function isTerminalRemoteError(error) {
  return ['auth_required', 'access_denied', 'rate_limited', 'login_redirect'].includes(error?.code)
    || /HTTP\s*(401|403|429)|Access Denied|사용권한이 없습니다|접근이 제한|접속이 제한/i.test(error?.message || '');
}

function openCacheDatabase() {
  if (cacheDbPromise) return cacheDbPromise;
  cacheDbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(CACHE_DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(CACHE_STORE_NAME)) {
        request.result.createObjectStore(CACHE_STORE_NAME, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('로컬 캐시를 열지 못했습니다.'));
  });
  return cacheDbPromise;
}

async function persistentCacheGet(key, ttl) {
  const now = Date.now();
  const memoryEntry = memoryCache.get(key);
  if (memoryEntry && now - memoryEntry.savedAt <= ttl) return memoryEntry.value;
  if (memoryEntry) memoryCache.delete(key);

  try {
    const database = await openCacheDatabase();
    const entry = await new Promise((resolve, reject) => {
      const request = database.transaction(CACHE_STORE_NAME, 'readonly').objectStore(CACHE_STORE_NAME).get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (!entry || now - entry.savedAt > ttl) return null;
    memoryCache.set(key, entry);
    return entry.value;
  } catch (error) {
    return null;
  }
}

async function persistentCacheSet(key, value) {
  const entry = { key, savedAt: Date.now(), value };
  memoryCache.set(key, entry);
  try {
    const database = await openCacheDatabase();
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(CACHE_STORE_NAME, 'readwrite');
      transaction.objectStore(CACHE_STORE_NAME).put(entry);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } catch (error) {
    // 메모리 캐시는 유지합니다. IndexedDB 장애가 원격 요청을 다시 만들지는 않게 합니다.
  }
}

async function persistentCacheDelete(key) {
  memoryCache.delete(key);
  try {
    const database = await openCacheDatabase();
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(CACHE_STORE_NAME, 'readwrite');
      transaction.objectStore(CACHE_STORE_NAME).delete(key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } catch (error) {
    // 만료 시각 검사를 함께 사용하므로 삭제 실패가 영구 잠금으로 이어지지 않습니다.
  }
}

function serializeLeaseOperation(operation) {
  const result = leaseOperation.then(operation, operation);
  leaseOperation = result.catch(() => {});
  return result;
}

function serializeRemoteRequest(operation) {
  const result = remoteRequestOperation.then(operation, operation);
  remoteRequestOperation = result.catch(() => {});
  return result;
}

function callerOwnerToken(message, sender) {
  const explicit = String(message?.ownerToken || '').trim();
  if (explicit) return explicit;
  if (Number.isInteger(sender?.tab?.id)) return `tab:${sender.tab.id}`;
  if (sender?.documentId) return `document:${sender.documentId}`;
  if (sender?.url) return `url:${sender.url}`;
  return '';
}

async function currentRunLease() {
  if (activeRunLease?.expiresAt > Date.now()) return activeRunLease;
  activeRunLease = null;
  const stored = await persistentCacheGet(RUN_LEASE_CACHE_KEY, RUN_LEASE_MAX_TTL * 2);
  if (stored?.expiresAt > Date.now()) {
    activeRunLease = stored;
    return stored;
  }
  if (stored) await persistentCacheDelete(RUN_LEASE_CACHE_KEY);
  return null;
}

function normalizedLeaseTtl(value) {
  return Math.min(Math.max(Number(value) || RUN_LEASE_DEFAULT_TTL, 15 * 1000), RUN_LEASE_MAX_TTL);
}

async function beginRunLease(message, sender) {
  return serializeLeaseOperation(async () => {
    const ownerToken = callerOwnerToken(message, sender);
    if (!ownerToken) return { ok: false, code: 'owner_token_required', error: '실행 잠금용 ownerToken이 필요합니다.' };
    const current = await currentRunLease();
    if (current && current.ownerToken !== ownerToken) {
      return {
        ok: false,
        code: 'run_locked',
        error: '다른 화면에서 판매지표 분석이 실행 중입니다.',
        expiresAt: current.expiresAt
      };
    }
    activeRunLease = {
      ownerToken,
      ownerUrl: String(sender?.url || ''),
      acquiredAt: current?.acquiredAt || Date.now(),
      expiresAt: Date.now() + normalizedLeaseTtl(message?.ttlMs)
    };
    await persistentCacheSet(RUN_LEASE_CACHE_KEY, activeRunLease);
    return { ok: true, expiresAt: activeRunLease.expiresAt };
  });
}

async function heartbeatRunLease(message, sender) {
  return serializeLeaseOperation(async () => {
    const ownerToken = callerOwnerToken(message, sender);
    const current = await currentRunLease();
    if (!current || current.ownerToken !== ownerToken) {
      return { ok: false, code: 'run_lease_lost', error: '판매지표 분석 실행권이 만료되었거나 다른 화면으로 변경되었습니다.' };
    }
    activeRunLease = { ...current, expiresAt: Date.now() + normalizedLeaseTtl(message?.ttlMs) };
    await persistentCacheSet(RUN_LEASE_CACHE_KEY, activeRunLease);
    return { ok: true, expiresAt: activeRunLease.expiresAt };
  });
}

async function endRunLease(message, sender) {
  return serializeLeaseOperation(async () => {
    const ownerToken = callerOwnerToken(message, sender);
    const current = await currentRunLease();
    if (!current) return { ok: true, released: false };
    if (!ownerToken || current.ownerToken !== ownerToken) {
      return { ok: false, code: 'run_locked', error: '다른 화면의 판매지표 분석 실행권은 해제할 수 없습니다.' };
    }
    activeRunLease = null;
    await persistentCacheDelete(RUN_LEASE_CACHE_KEY);
    return { ok: true, released: true };
  });
}

async function assertRunAccess(message, sender) {
  return serializeLeaseOperation(async () => {
    const ownerToken = callerOwnerToken(message, sender);
    if (!ownerToken) {
      throw requestError('판매지표 분석 실행 화면을 확인하지 못했습니다.', {
        code: 'owner_token_required',
        requestSent: false
      });
    }
    const current = await currentRunLease();
    if (!current) {
      activeRunLease = {
        ownerToken,
        ownerUrl: String(sender?.url || ''),
        acquiredAt: Date.now(),
        expiresAt: Date.now() + RUN_LEASE_DEFAULT_TTL
      };
      await persistentCacheSet(RUN_LEASE_CACHE_KEY, activeRunLease);
      return;
    }
    if (ownerToken === current.ownerToken) {
      if (current.expiresAt - Date.now() < RUN_LEASE_DEFAULT_TTL / 2) {
        activeRunLease = { ...current, expiresAt: Date.now() + RUN_LEASE_DEFAULT_TTL };
        await persistentCacheSet(RUN_LEASE_CACHE_KEY, activeRunLease);
      }
      return;
    }
    throw requestError('다른 화면에서 판매지표 분석이 실행 중입니다.', {
      code: 'run_locked',
      requestSent: false
    });
  });
}

function responseError(response, fallbackMessage) {
  const message = response?.error || fallbackMessage;
  const status = Number(response?.status) || Number(String(message || '').match(/HTTP\s*(401|403|429)/i)?.[1]) || undefined;
  let code = response?.code || '';
  if (!code && status === 401) code = 'auth_required';
  else if (!code && status === 403) code = 'access_denied';
  else if (!code && status === 429) code = 'rate_limited';
  else if (!code && /로그인 화면|로그인이 만료|login redirect/i.test(message || '')) code = 'login_redirect';
  else if (!code && /Access Denied|사용권한이 없습니다|접근이 제한|접속이 제한/i.test(message || '')) code = 'access_denied';
  return requestError(message, {
    code,
    status,
    requestSent: response?.requestSent
  });
}

function remoteCircuitFailure(error) {
  const status = Number(error?.status) || Number(String(error?.message || '').match(/HTTP\s*(403|429)/i)?.[1]) || 0;
  const code = String(error?.code || '');
  if (status === 429 || code === 'rate_limited') {
    return {
      kind: 'rate_limited',
      status: 429,
      cooldownMs: RATE_LIMIT_COOLDOWN,
      reason: '쿠팡 요청량 제한(429)'
    };
  }
  if (status === 403 || code === 'access_denied'
    || /Access Denied|사용권한이 없습니다|접근이 제한|접속이 제한/i.test(error?.message || '')) {
    return {
      kind: 'access_denied',
      status: 403,
      cooldownMs: ACCESS_DENIED_COOLDOWN,
      reason: '쿠팡 접근 제한(403/Access Denied)'
    };
  }
  return null;
}

async function currentRemoteCircuit() {
  const now = Date.now();
  let circuit = activeRemoteCircuit;
  if (!circuit) {
    circuit = await persistentCacheGet(REMOTE_CIRCUIT_CACHE_KEY, REMOTE_CIRCUIT_STORAGE_TTL);
    activeRemoteCircuit = circuit || null;
  }
  if (!circuit) return { state: 'closed', nextAllowedAt: 0 };
  if (circuit.state === 'open' && Number(circuit.nextAllowedAt) <= now) {
    activeRemoteCircuit = { ...circuit, state: 'half-open', probeStartedAt: 0 };
    return activeRemoteCircuit;
  }
  return circuit;
}

async function openRemoteCircuit(failure, error) {
  const now = Date.now();
  const current = await currentRemoteCircuit();
  const nextAllowedAt = Math.max(
    Number(current?.nextAllowedAt) || 0,
    now + failure.cooldownMs
  );
  activeRemoteCircuit = {
    state: 'open',
    kind: failure.kind,
    status: failure.status,
    reason: failure.reason,
    detail: String(error?.message || '').slice(0, 500),
    openedAt: now,
    nextAllowedAt
  };
  await persistentCacheSet(REMOTE_CIRCUIT_CACHE_KEY, activeRemoteCircuit);
  return activeRemoteCircuit;
}

async function closeRemoteCircuit() {
  activeRemoteCircuit = null;
  await persistentCacheDelete(REMOTE_CIRCUIT_CACHE_KEY);
}

function remoteCircuitBlockedError(circuit) {
  const retryAt = Number(circuit?.nextAllowedAt) || Date.now();
  return requestError(
    `${circuit?.reason || '쿠팡 접근 제한'}으로 모든 조회를 중단했습니다. ${new Date(retryAt).toLocaleString('ko-KR')} 이후 한 상품만 시험 조회할 수 있습니다.`,
    {
      code: 'circuit_open',
      status: Number(circuit?.status) || undefined,
      retryAt,
      nextAllowedAt: retryAt,
      requestSent: false
    }
  );
}

async function guardedRemoteRequest(operation) {
  const circuit = await currentRemoteCircuit();
  const now = Date.now();
  if (circuit.state === 'open' && Number(circuit.nextAllowedAt) > now) {
    throw remoteCircuitBlockedError(circuit);
  }

  const isProbe = circuit.state === 'half-open'
    || (circuit.state === 'open' && Number(circuit.nextAllowedAt) <= now);
  if (isProbe && remoteCircuitProbeInProgress) {
    throw requestError('접근 제한 대기시간 종료 후 시험 조회가 이미 진행 중입니다.', {
      code: 'circuit_probe_busy',
      retryAt: Number(circuit.nextAllowedAt) || now,
      nextAllowedAt: Number(circuit.nextAllowedAt) || now,
      requestSent: false
    });
  }
  if (isProbe) remoteCircuitProbeInProgress = true;

  try {
    const result = await operation();
    if (isProbe) await closeRemoteCircuit();
    return result;
  } catch (error) {
    const failure = remoteCircuitFailure(error);
    if (failure) {
      const opened = await openRemoteCircuit(failure, error);
      error.retryAt = opened.nextAllowedAt;
      error.nextAllowedAt = opened.nextAllowedAt;
    } else if (isProbe) {
      // 서버가 정상 응답했지만 상품 데이터만 없는 경우처럼 접근 제한이 아닌 실패는
      // 회로를 다시 열지 않습니다.
      await closeRemoteCircuit();
    }
    throw error;
  } finally {
    if (isProbe) remoteCircuitProbeInProgress = false;
  }
}

function runGuardedRemoteRequest(operation) {
  return serializeRemoteRequest(() => guardedRemoteRequest(operation));
}

async function findIncognitoWingTabs() {
  const allTabs = await chrome.tabs.query({});
  return allTabs.filter(tab => {
    try {
      return tab.incognito && new URL(tab.url || '').hostname === 'wing.coupang.com';
    } catch (error) {
      return false;
    }
  });
}

// 쿠팡윙 시크릿 탭만 닫아 해당 세션 사용을 끝냅니다.
// 일반 쿠팡 탭이나 다른 시크릿 탭은 건드리지 않습니다.
async function closeIncognitoWingTabs() {
  const tabs = await findIncognitoWingTabs();
  if (!tabs.length) return { ok: true, closed: 0 };
  await chrome.tabs.remove(tabs.map(tab => tab.id).filter(Boolean));
  return { ok: true, closed: tabs.length };
}

function wingTabReadiness(tab) {
  let url;
  try {
    url = new URL(tab?.url || '');
  } catch (error) {
    return { loggedIn: false, code: 'wing_tab_url_unavailable' };
  }
  const loginLikeUrl = /(?:^|\/)(?:login|signin|sign-in|auth)(?:\/|$)/i.test(url.pathname)
    || /login|signin|sign-in/i.test(url.search)
    || /로그인|sign\s*in/i.test(tab?.title || '');
  if (loginLikeUrl) return { loggedIn: false, code: 'wing_session_expired' };
  if (tab?.status !== 'complete') return { loggedIn: false, code: 'wing_tab_loading' };
  return { loggedIn: true, code: 'wing_tab_ready' };
}

async function singleWingTab() {
  const incognitoAllowed = await chrome.extension.isAllowedIncognitoAccess();
  if (!incognitoAllowed) {
    throw requestError('윙렌즈의 시크릿 모드 사용이 허용되지 않았습니다.', { code: 'incognito_not_allowed', requestSent: false });
  }
  const tabs = await findIncognitoWingTabs();
  if (!tabs.length) {
    throw requestError('시크릿 모드에서 쿠팡윙 로그인 탭을 열어주세요.', { code: 'wing_tab_not_found', requestSent: false });
  }
  if (tabs.length !== 1) {
    throw requestError(`시크릿 쿠팡윙 탭이 ${tabs.length}개 열려 있습니다. 1개만 남기고 다시 시도하세요.`, {
      code: 'multiple_wing_tabs',
      requestSent: false
    });
  }
  const readiness = wingTabReadiness(tabs[0]);
  if (!readiness.loggedIn) {
    throw requestError(
      readiness.code === 'wing_tab_loading'
        ? '쿠팡윙 탭이 아직 로딩 중입니다. 로딩이 끝난 뒤 다시 시도하세요.'
        : '쿠팡윙 로그인이 필요합니다.',
      { code: readiness.code, requestSent: false }
    );
  }
  return tabs[0];
}

async function openOrFocusWingLogin() {
  const incognitoAllowed = await chrome.extension.isAllowedIncognitoAccess();
  if (!incognitoAllowed) {
    return { ok: false, code: 'incognito_not_allowed', error: '윙렌즈의 시크릿 모드 사용이 허용되지 않았습니다. Chrome 확장프로그램 설정에서 시크릿 모드 허용을 켜 주세요.' };
  }
  const tabs = await findIncognitoWingTabs();
  if (tabs.length > 1) {
    return { ok: false, code: 'multiple_wing_tabs', error: `시크릿 쿠팡윙 탭이 ${tabs.length}개 열려 있습니다. 1개만 남겨 주세요.` };
  }
  if (tabs.length === 1) {
    await chrome.windows.update(tabs[0].windowId, { focused: true });
    await chrome.tabs.update(tabs[0].id, { active: true });
    return { ok: true, reused: true };
  }
  await chrome.windows.create({ url: WING_LOGIN_URL, incognito: true, focused: true });
  return { ok: true };
}

function tabMessage(tabId, payload) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, payload, response => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(response);
    });
  });
}

function waitUntilLoaded(tabId) {
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = error => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      error ? reject(error) : resolve();
    };
    const onUpdated = (updatedId, info) => {
      if (updatedId === tabId && info.status === 'complete') finish();
    };
    const timer = setTimeout(() => finish(new Error('쿠팡 검색 페이지 로딩 시간이 초과되었습니다.')), SEARCH_LOAD_TIMEOUT);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.get(tabId).then(tab => {
      if (tab.status === 'complete') finish();
    }).catch(() => {});
  });
}

function normalizeKeyword(value) {
  return String(value || '').replace(/\s+/g, '').trim();
}

async function findUserSearchTab(keyword, page) {
  const expectedKeyword = normalizeKeyword(keyword);
  const expectedPage = Math.min(Math.max(Number(page) || 1, 1), 8);
  const tabs = await chrome.tabs.query({ url: 'https://www.coupang.com/np/search*' });
  return tabs.find(tab => {
    try {
      const url = new URL(tab.url || '');
      const tabPage = Number(url.searchParams.get('page') || 1);
      return !tab.incognito && normalizeKeyword(url.searchParams.get('q')) === expectedKeyword && tabPage === expectedPage;
    } catch (error) {
      return false;
    }
  });
}

async function openKeywordSearchTab(keyword, page) {
  const query = String(keyword || '').trim();
  const searchPage = Math.min(Math.max(Number(page) || 1, 1), 8);
  const url = new URL('https://www.coupang.com/np/search');
  url.searchParams.set('q', query);
  url.searchParams.set('page', String(searchPage));
  const tab = await chrome.tabs.create({ url: url.href, active: false });
  if (!tab?.id) throw new Error('쿠팡 검색 탭을 열지 못했습니다.');
  await waitUntilLoaded(tab.id);
  return tab;
}

async function readKeywordPage(keyword, page) {
  const query = String(keyword || '').trim();
  if (!query) throw new Error('검색 키워드를 입력하세요.');

  const maxItems = 240;
  const searchPage = Math.min(Math.max(Number(page) || 1, 1), 8);
  let tab = await findUserSearchTab(query, searchPage);
  let autoOpened = false;
  if (!tab?.id) {
    // 사용자가 분석을 시작한 경우에만 일반 쿠팡 검색 탭을 한 번 엽니다.
    // 접근 제한을 피하기 위해 자동 재시도나 백그라운드 반복 탐색은 하지 않습니다.
    tab = await openKeywordSearchTab(query, searchPage);
    autoOpened = true;
  }

  if (tab.status !== 'complete') await waitUntilLoaded(tab.id);
  try {
    let lastError;
    // 자동으로 연 검색 탭의 동적 목록이 완성될 때까지만 짧게 기다립니다.
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        const response = await tabMessage(tab.id, { kind: 'WL_READ_PRODUCTS', limit: maxItems, keyword: query });
        if (response?.ok && response.products?.length) {
          if (autoOpened) chrome.tabs.remove(tab.id).catch(() => {});
          return response.products;
        }
        lastError = responseError(response, '검색 결과에서 상품을 찾지 못했습니다.');
        if (isTerminalRemoteError(lastError)) throw lastError;
      } catch (error) {
        lastError = error;
        if (isTerminalRemoteError(error)) throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 900));
    }
    throw lastError || new Error('쿠팡 검색 결과를 읽지 못했습니다.');
  } catch (error) {
    // 자동으로 연 탭은 오류 확인을 위해 남겨 둡니다.
    throw error;
  }
}

async function readKeywordProducts(keyword, startPage, endPage) {
  const start = Math.min(Math.max(Number(startPage) || 1, 1), 8);
  const end = Math.min(Math.max(Number(endPage) || start, start), 8);
  const productMap = new Map();
  for (let page = start; page <= end; page++) {
    const products = await readKeywordPage(keyword, page);
    for (const product of products) {
      const key = String(product.productId || product.url || '');
      if (key && !productMap.has(key)) productMap.set(key, product);
    }
  }
  return [...productMap.values()];
}

async function readProductShippingUncached(productUrl) {
  let url;
  try {
    url = new URL(String(productUrl || ''));
  } catch (error) {
    throw new Error('상품 상세페이지 주소가 올바르지 않습니다.');
  }
  if (!/(^|\.)coupang\.com$/i.test(url.hostname) || !/\/(?:vp\/)?products\/\d+/.test(url.pathname)) {
    throw new Error('쿠팡 상품 상세페이지 주소가 아닙니다.');
  }

  const tab = await chrome.tabs.create({ url: url.href, active: false });
  try {
    await waitUntilLoaded(tab.id);
    let lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await tabMessage(tab.id, { kind: 'WL_READ_SHIPPING' });
        if (response?.ok) return response;
        lastError = responseError(response, '상세페이지 배송방법을 읽지 못했습니다.');
        if (isTerminalRemoteError(lastError)) throw lastError;
      } catch (error) {
        lastError = error;
        if (isTerminalRemoteError(error)) throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 700));
    }
    throw lastError || new Error('상세페이지 배송방법을 읽지 못했습니다.');
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function readProductShipping(productUrl) {
  let url;
  try {
    url = new URL(String(productUrl || ''));
  } catch (error) {
    throw new Error('상품 상세페이지 주소가 올바르지 않습니다.');
  }
  const productId = url.pathname.match(/\/(?:vp\/)?products\/(\d+)/)?.[1] || url.href;
  const cacheKey = `shipping:${productId}`;
  const cached = await persistentCacheGet(cacheKey, SHIPPING_CACHE_TTL);
  if (cached) return { ...cached, cached: true };
  if (shippingInflight.has(cacheKey)) return shippingInflight.get(cacheKey);

  const request = readProductShippingUncached(url.href)
    .then(async result => {
      if (result?.ok) await persistentCacheSet(cacheKey, result);
      return result;
    })
    .finally(() => shippingInflight.delete(cacheKey));
  shippingInflight.set(cacheKey, request);
  return request;
}

async function readProductReviews(productUrl, productId, reviewCount) {
  let url;
  try {
    url = new URL(String(productUrl || ''));
  } catch (error) {
    throw new Error('상품 상세페이지 주소가 올바르지 않습니다.');
  }
  if (!/(^|\.)coupang\.com$/i.test(url.hostname) || !/\/(?:vp\/)?products\/\d+/.test(url.pathname)) {
    throw new Error('쿠팡 상품 상세페이지 주소가 아닙니다.');
  }
  const estimatedPages = Math.ceil(Math.max(Number(reviewCount) || 10, 10) / 10);
  const tab = await chrome.tabs.create({ url: url.href, active: false });
  try {
    await waitUntilLoaded(tab.id);
    let lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await tabMessage(tab.id, { kind: 'WL_READ_REVIEWS', productId: String(productId || ''), maxPages: Math.min(estimatedPages, 35) });
        if (response?.ok && Array.isArray(response.reviews)) return response.reviews;
        lastError = new Error(response?.error || '상품 리뷰를 읽지 못했습니다.');
      } catch (error) {
        lastError = error;
      }
      await new Promise(resolve => setTimeout(resolve, 800));
    }
    throw lastError || new Error('상품 리뷰를 읽지 못했습니다.');
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}

function collectMetricItems(root) {
  const results = [];
  const visited = new Set();
  const queue = [root];
  while (queue.length) {
    const value = queue.shift();
    if (!value || typeof value !== 'object' || visited.has(value)) continue;
    visited.add(value);
    if (Object.prototype.hasOwnProperty.call(value, 'pvLast28Day') || Object.prototype.hasOwnProperty.call(value, 'salesLast28d')) {
      results.push({
        productId: String(value.productId ?? value.id ?? ''),
        itemId: String(value.itemId ?? ''),
        vendorItemId: String(value.vendorItemId ?? ''),
        productName: String(value.productName ?? value.itemName ?? ''),
        salePrice: value.salePrice ?? null,
        pvLast28Day: value.pvLast28Day ?? null,
        salesLast28d: value.salesLast28d ?? null
      });
    }
    const children = Array.isArray(value) ? value : Object.values(value);
    for (const child of children) if (child && typeof child === 'object') queue.push(child);
  }
  return results;
}

async function queryWingInPage(tabId, productId) {
  let executions;
  try {
    executions = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      args: [productId],
      func: async id => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 25000);
        try {
          const response = await fetch('/tenants/seller-web/pre-matching/search', {
            method: 'POST',
            credentials: 'include',
            signal: controller.signal,
            headers: {
              accept: 'application/json, text/plain, */*',
              'content-type': 'application/json;charset=UTF-8',
              'x-requested-with': 'XMLHttpRequest'
            },
            body: JSON.stringify({ keyword: String(id), excludedProductIds: [], searchPage: 0, searchOrder: 'DEFAULT', sortType: 'DEFAULT' })
          });
          const text = await response.text();
          const responseUrl = String(response.url || '');
          const loginRedirect = /(?:login|signin|sign-in|xauth|account)\.coupang\.com|\/(?:login|signin|sign-in|auth)(?:\/|$)/i.test(responseUrl)
            || /<title[^>]*>[^<]*(?:로그인|sign\s*in)/i.test(text);
          const accessDenied = /Access Denied|You don't have permission to access|errors\.edgesuite\.net|요청하신 페이지의 사용권한이 없습니다|사용권한이 없습니다|접근이 제한|접속이 제한|비정상적인 접근/i.test(text);

          if (response.status === 401) return { ok: false, error: '쿠팡윙 HTTP 401 · 로그인이 만료되었습니다.', code: 'auth_required', status: 401, requestSent: true };
          if (response.status === 403 || accessDenied) return { ok: false, error: `쿠팡윙 HTTP ${response.status || 403} · 접근이 제한되었습니다.`, code: 'access_denied', status: response.status || 403, requestSent: true };
          if (response.status === 429) return { ok: false, error: '쿠팡윙 HTTP 429 · 요청이 제한되었습니다.', code: 'rate_limited', status: 429, requestSent: true };
          if (loginRedirect) return { ok: false, error: '쿠팡윙 로그인 화면으로 이동했습니다. 다시 로그인해 주세요.', code: 'login_redirect', status: response.status, requestSent: true };
          if (!response.ok) return { ok: false, error: `쿠팡윙 HTTP ${response.status}`, code: 'wing_http_error', status: response.status, requestSent: true };
          try {
            return { ok: true, data: JSON.parse(text) };
          } catch (error) {
            return { ok: false, error: '쿠팡윙이 JSON 형식으로 응답하지 않았습니다.', code: 'invalid_response', status: response.status, requestSent: true };
          }
        } catch (error) {
          return {
            ok: false,
            error: error?.name === 'AbortError' ? '쿠팡윙 요청 시간이 초과되었습니다.' : (error?.message || '쿠팡윙 요청 실패'),
            code: error?.name === 'AbortError' ? 'request_timeout' : 'request_failed',
            requestSent: true
          };
        } finally {
          clearTimeout(timer);
        }
      }
    });
  } catch (error) {
    throw requestError(error?.message || '쿠팡윙 페이지 요청을 실행하지 못했습니다.', {
      code: 'page_execution_unavailable',
      requestSent: false
    });
  }

  const response = executions?.[0]?.result;
  if (!response) {
    throw requestError('쿠팡윙 페이지 요청을 실행하지 못했습니다.', {
      code: 'page_execution_unavailable',
      requestSent: false
    });
  }
  if (!response.ok) throw responseError(response, '쿠팡윙 페이지 요청을 실행하지 못했습니다.');
  const items = collectMetricItems(response.data);
  const exact = items.find(item => item.productId === String(productId));
  const item = exact || items[0];
  if (!item) throw new Error('쿠팡윙 응답에 PV 또는 판매량 필드가 없습니다.');
  return { ok: true, item, method: 'page-session' };
}

async function queryWingUncached(id, tab) {
  try {
    // 본문 컨텍스트에서 실제 요청이 시작된 뒤 발생한 오류는 동일 상품을 다시 요청하지 않습니다.
    return await queryWingInPage(tab.id, id);
  } catch (pageError) {
    if (pageError?.requestSent !== false || isTerminalRemoteError(pageError)) throw pageError;
  }

  // executeScript가 요청을 보내기 전에 실패한 경우에만 브리지를 한 번 사용합니다.
  let ping = null;
  try {
    ping = await tabMessage(tab.id, { kind: 'WL_BRIDGE_PING' });
  } catch (error) {}
  if (!ping?.ok || ping.version !== '1.3.0') {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['wing-bridge.js'] });
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  const result = await tabMessage(tab.id, { kind: 'WL_WING_QUERY', productId: id });
  if (result?.ok) return { ...result, method: 'bridge' };
  throw responseError(result, '쿠팡윙 응답을 받지 못했습니다.');
}

async function queryWing(productId) {
  const id = String(productId || '').trim();
  if (!/^\d+$/.test(id)) throw new Error('올바른 productId가 아닙니다.');
  const tab = await singleWingTab();

  const cacheKey = `metric:${id}`;
  const cached = await persistentCacheGet(cacheKey, METRIC_CACHE_TTL);
  if (cached) return { ...cached, cached: true };
  if (metricInflight.has(id)) return metricInflight.get(id);

  const request = queryWingUncached(id, tab)
    .then(async result => {
      if (result?.ok) await persistentCacheSet(cacheKey, result);
      return result;
    })
    .finally(() => metricInflight.delete(id));
  metricInflight.set(id, request);
  return request;
}

async function wingLoginStatus() {
  const incognitoAllowed = await chrome.extension.isAllowedIncognitoAccess();
  if (!incognitoAllowed) return { loggedIn: false, code: 'incognito_not_allowed' };
  const wingTabs = await findIncognitoWingTabs();
  if (!wingTabs.length) return { loggedIn: false, code: 'wing_tab_not_found' };
  if (wingTabs.length !== 1) {
    return {
      loggedIn: false,
      code: 'multiple_wing_tabs',
      tabCount: wingTabs.length,
      error: `시크릿 쿠팡윙 탭이 ${wingTabs.length}개 열려 있습니다. 1개만 남겨 주세요.`
    };
  }
  return { ...wingTabReadiness(wingTabs[0]), tabCount: 1 };
}

async function wingLoginAndCircuitStatus() {
  const [login, remoteCircuit] = await Promise.all([
    wingLoginStatus(),
    currentRemoteCircuit()
  ]);
  return { ...login, remoteCircuit };
}

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.kind === 'WL_BEGIN_RUN') {
    beginRunLease(message, sender).then(sendResponse).catch(error => sendResponse(errorResponse(error)));
    return true;
  }
  if (message?.kind === 'WL_HEARTBEAT_RUN') {
    heartbeatRunLease(message, sender).then(sendResponse).catch(error => sendResponse(errorResponse(error)));
    return true;
  }
  if (message?.kind === 'WL_END_RUN') {
    endRunLease(message, sender).then(sendResponse).catch(error => sendResponse(errorResponse(error)));
    return true;
  }

  if (message?.kind === 'WL_OPEN_WING_LOGIN') {
    openOrFocusWingLogin()
      .then(sendResponse)
      .catch(error => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }

  if (message?.kind === 'WL_OPEN_COUPANG_LOGIN') {
    // 직접 로그인 주소는 쿠팡 접근 제한 페이지로 연결될 수 있어 일반 홈을 엽니다.
    // 사용자가 홈 화면의 로그인 메뉴에서 직접 로그인합니다.
    chrome.tabs.create({ url: 'https://www.coupang.com/', active: true })
      .then(() => sendResponse({ ok: true }))
      .catch(error => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }

  if (message?.kind === 'WL_WING_STATUS') {
    wingLoginStatus().then(sendResponse).catch(() => sendResponse({ loggedIn: false }));
    return true;
  }

  if (message?.kind === 'WL_SEARCH') {
    assertRunAccess(message, sender)
      .then(() => runGuardedRemoteRequest(() => readKeywordProducts(message.keyword, message.startPage, message.endPage)))
      .then(products => sendResponse({ ok: true, products }))
      .catch(error => sendResponse(errorResponse(error)));
    return true;
  }

  if (message?.kind === 'WL_METRIC') {
    assertRunAccess(message, sender)
      .then(() => runGuardedRemoteRequest(() => queryWing(message.productId)))
      .then(result => sendResponse(result))
      .catch(error => sendResponse(errorResponse(error)));
    return true;
  }

  if (message?.kind === 'WL_SHIPPING') {
    assertRunAccess(message, sender)
      .then(() => runGuardedRemoteRequest(() => readProductShipping(message.productUrl)))
      .then(result => sendResponse(result))
      .catch(error => sendResponse(errorResponse(error)));
    return true;
  }

  if (message?.kind === 'WL_REVIEWS') {
    assertRunAccess(message, sender)
      .then(() => runGuardedRemoteRequest(() => readProductReviews(message.productUrl, message.productId, message.reviewCount)))
      .then(reviews => sendResponse({ ok: true, reviews }))
      .catch(error => sendResponse(errorResponse(error)));
    return true;
  }
});

// 로컬 통합 화면에는 필요한 조회 메시지만 공개합니다.
// manifest의 externally_connectable 설정으로 http://localhost:8787 만 허용됩니다.
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (!String(sender?.url || '').startsWith('http://localhost:8787/')) {
    sendResponse({ ok: false, error: '허용되지 않은 연결입니다.' });
    return;
  }

  if (message?.kind === 'WL_EXTERNAL_BEGIN_RUN') {
    beginRunLease(message, sender).then(sendResponse).catch(error => sendResponse(errorResponse(error)));
    return true;
  }
  if (message?.kind === 'WL_EXTERNAL_HEARTBEAT_RUN') {
    heartbeatRunLease(message, sender).then(sendResponse).catch(error => sendResponse(errorResponse(error)));
    return true;
  }
  if (message?.kind === 'WL_EXTERNAL_END_RUN') {
    endRunLease(message, sender).then(sendResponse).catch(error => sendResponse(errorResponse(error)));
    return true;
  }
  if (message?.kind === 'WL_EXTERNAL_STATUS') {
    wingLoginAndCircuitStatus().then(sendResponse).catch(() => sendResponse({ loggedIn: false }));
    return true;
  }
  if (message?.kind === 'WL_EXTERNAL_OPEN_WING_LOGIN') {
    openOrFocusWingLogin()
      .then(sendResponse)
      .catch(error => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }
  if (message?.kind === 'WL_EXTERNAL_CLOSE_WING_SESSION') {
    closeIncognitoWingTabs()
      .then(sendResponse)
      .catch(error => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }
  if (message?.kind === 'WL_EXTERNAL_SEARCH') {
    assertRunAccess(message, sender)
      .then(() => runGuardedRemoteRequest(() => readKeywordProducts(message.keyword, message.startPage, message.endPage)))
      .then(products => sendResponse({ ok: true, products }))
      .catch(error => sendResponse(errorResponse(error)));
    return true;
  }
  if (message?.kind === 'WL_EXTERNAL_METRIC') {
    assertRunAccess(message, sender)
      .then(() => runGuardedRemoteRequest(() => queryWing(message.productId)))
      .then(sendResponse)
      .catch(error => sendResponse(errorResponse(error)));
    return true;
  }
  if (message?.kind === 'WL_EXTERNAL_SHIPPING') {
    assertRunAccess(message, sender)
      .then(() => runGuardedRemoteRequest(() => readProductShipping(message.productUrl)))
      .then(sendResponse)
      .catch(error => sendResponse(errorResponse(error)));
    return true;
  }
  if (message?.kind === 'WL_EXTERNAL_REVIEWS') {
    assertRunAccess(message, sender)
      .then(() => runGuardedRemoteRequest(() => readProductReviews(message.productUrl, message.productId, message.reviewCount)))
      .then(reviews => sendResponse({ ok: true, reviews }))
      .catch(error => sendResponse(errorResponse(error)));
    return true;
  }
  sendResponse({ ok: false, error: '지원하지 않는 요청입니다.' });
});
