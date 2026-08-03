import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const workerPath = new URL('../wing-lens-extension/service-worker.js', import.meta.url);
const appPath = new URL('../app.js', import.meta.url);
const targetListPath = new URL('../target-list.js', import.meta.url);
const stylePath = new URL('../style.css', import.meta.url);

async function loadAppFailureClassifier() {
  const source = await readFile(appPath, 'utf8');
  const start = source.indexOf('function wingFailureText');
  const end = source.indexOf('function readWingCircuit');
  assert.ok(start >= 0 && end > start, '앱 오류 분류 함수를 찾을 수 있어야 합니다.');
  const context = { Error, JSON, Number, String };
  vm.createContext(context);
  vm.runInContext(`${source.slice(start, end)}
globalThis.__classifyWingFailure = classifyWingFailure;`, context);
  return context.__classifyWingFailure;
}

async function loadAutoRetryHarness() {
  const source = await readFile(appPath, 'utf8');
  const start = source.indexOf("const wingAutoRetryStorageKey=");
  const end = source.indexOf('const openWingCircuitBeforeAutoRetry');
  assert.ok(start >= 0 && end > start, '30분 자동 재시도 코드를 찾을 수 있어야 합니다.');

  let now = 1_800_000_000_000;
  let nextTimerId = 1;
  const timers = new Map();
  const storage = new Map();
  const notices = [];
  let runCount = 0;
  class FakeDate extends Date {
    static now() { return now; }
  }
  const localStorage = {
    getItem(key) { return storage.has(key) ? storage.get(key) : null; },
    setItem(key, value) { storage.set(key, String(value)); },
    removeItem(key) { storage.delete(key); }
  };
  const context = {
    console,
    crypto: { randomUUID: () => `uuid-${nextTimerId++}` },
    Date: FakeDate,
    localStorage,
    setTimeout(callback, delay) {
      const id = nextTimerId++;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    wingExecutionOwnerId: 'test-owner',
    metricReservationJobs: [{ id: 'job-1', keyword: '테스트키워드', status: '재개대기' }],
    wingKeywordInput: { value: '' },
    wingStatus: { textContent: '' },
    metricQueueStatus: { textContent: '' },
    metricReservationRunning: false,
    showAppNotice(title, message) { notices.push({ title, message }); return Promise.resolve(); },
    readActiveMetricReservationQueue() { return null; },
    restoreActiveMetricReservationQueue() {},
    async runMetricReservations(resume) {
      assert.equal(resume, true);
      runCount += 1;
      return { status: 'complete' };
    },
    readWingCircuit() { return { state: 'closed' }; },
    writeWingCircuit() {}
  };
  vm.createContext(context);
  vm.runInContext(`${source.slice(start, end)}
globalThis.__autoRetry = {
  schedule: scheduleWingAutoRetry,
  run: runWingAutoRetry,
  clear: clearWingAutoRetry,
  read: readWingAutoRetry
};`, context);
  return {
    api: context.__autoRetry,
    notices,
    timers,
    getRunCount: () => runCount,
    now: () => now,
    advanceTo: value => { now = value; }
  };
}

async function loadWorkerHarness() {
  const source = await readFile(workerPath, 'utf8');
  const runtimeListeners = [];
  const externalListeners = [];
  const context = {
    console,
    Date,
    Error,
    JSON,
    Map,
    Math,
    Number,
    Promise,
    RegExp,
    Set,
    String,
    URL,
    clearTimeout,
    setTimeout,
    chrome: {
      action: { onClicked: { addListener() {} } },
      extension: { isAllowedIncognitoAccess: async () => true },
      runtime: {
        getURL: value => `chrome-extension://test/${value}`,
        lastError: null,
        onMessage: { addListener(listener) { runtimeListeners.push(listener); } },
        onMessageExternal: { addListener(listener) { externalListeners.push(listener); } }
      },
      scripting: { executeScript: async () => [] },
      tabs: {
        create: async () => ({ id: 10, status: 'complete' }),
        get: async id => ({ id, status: 'complete' }),
        onUpdated: { addListener() {}, removeListener() {} },
        query: async () => [],
        remove: async () => {},
        sendMessage() {},
        update: async () => {}
      },
      windows: {
        create: async () => ({}),
        update: async () => ({})
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(`${source}
globalThis.__wingSafetyTest = {
  guardedRemoteRequest,
  beginRunLease,
  heartbeatRunLease,
  endRunLease,
  requestError,
  getCircuit: () => activeRemoteCircuit,
  setCircuit: value => { activeRemoteCircuit = value; },
  clearCircuit: () => {
    activeRemoteCircuit = null;
    remoteCircuitProbeInProgress = false;
    memoryCache.delete(REMOTE_CIRCUIT_CACHE_KEY);
  }
};`, context);
  return {
    api: context.__wingSafetyTest,
    runtimeListeners,
    externalListeners,
    source
  };
}

test('구조화된 access_denied 응답을 30분 자동 재시도 대상으로 분류한다', async () => {
  const classifyWingFailure = await loadAppFailureClassifier();
  const retryAt = Date.now() + 10_000;
  const failure = classifyWingFailure({
    ok: false,
    code: 'access_denied',
    error: '쿠팡 페이지 접근이 제한되었습니다.',
    retryAt
  });

  assert.equal(failure.kind, 'blocked_403');
  assert.equal(failure.critical, true);
  assert.equal(failure.cooldownMs, 30 * 60 * 1000);
  assert.equal(failure.retryAt, retryAt);
});

test('자동 재예약 기능이 꺼져 있으면 접근 제한 후에도 자동 실행하지 않는다', async () => {
  const harness = await loadAutoRetryHarness();
  const retryAt = harness.now() + 30 * 60 * 1000;
  harness.api.schedule({ retryAt, keyword: '테스트키워드' });

  await harness.api.run();
  assert.equal(harness.getRunCount(), 0);
  assert.equal(harness.notices.length, 0);
  assert.equal(harness.api.read(), null);

  harness.advanceTo(retryAt);
  await harness.api.run();
  assert.equal(harness.getRunCount(), 0);
  assert.equal(harness.api.read(), null);
});

test('사용자가 중단하면 저장된 30분 자동 재시도도 취소한다', async () => {
  const harness = await loadAutoRetryHarness();
  const retryAt = harness.now() + 30 * 60 * 1000;
  harness.api.schedule({ retryAt, keyword: '취소키워드' });
  harness.api.clear();

  harness.advanceTo(retryAt);
  await harness.api.run();
  assert.equal(harness.getRunCount(), 0);
  assert.equal(harness.api.read(), null);
});

test('자동 재예약이 꺼져 있으면 예약 정보와 안내 팝업을 만들지 않는다', async () => {
  const harness = await loadAutoRetryHarness();
  const retryAt = harness.now() + 30 * 60 * 1000;
  harness.api.schedule({ retryAt, keyword: '중복방지' });
  harness.api.schedule({ retryAt, keyword: '중복방지' });

  assert.equal(harness.notices.length, 0);
  assert.equal(harness.api.read(), null);
});

test('403/429 발생 직후 다음 원격 요청을 보내지 않는다', async () => {
  const { api } = await loadWorkerHarness();
  let remoteCalls = 0;

  await assert.rejects(
    api.guardedRemoteRequest(async () => {
      remoteCalls += 1;
      throw api.requestError('쿠팡윙 HTTP 429', {
        code: 'rate_limited',
        status: 429,
        requestSent: true
      });
    }),
    error => error.code === 'rate_limited' && Number.isFinite(error.retryAt)
  );

  await assert.rejects(
    api.guardedRemoteRequest(async () => {
      remoteCalls += 1;
      return { ok: true };
    }),
    error => error.code === 'circuit_open' && error.requestSent === false
  );

  assert.equal(remoteCalls, 1, '차단 직후 중복 요청이 없어야 합니다.');
  assert.equal(api.getCircuit().status, 429);
});

test('대기시간 뒤 한 요청만 시험하고 성공하면 회로를 닫는다', async () => {
  const { api } = await loadWorkerHarness();
  api.setCircuit({
    state: 'open',
    kind: 'access_denied',
    status: 403,
    reason: '쿠팡 접근 제한',
    nextAllowedAt: Date.now() - 1
  });
  let remoteCalls = 0;

  const result = await api.guardedRemoteRequest(async () => {
    remoteCalls += 1;
    return { ok: true };
  });

  assert.equal(result.ok, true);
  assert.equal(remoteCalls, 1);
  assert.equal(api.getCircuit(), null);
});

test('브라우저 전체 실행 잠금은 소유자 한 명만 허용한다', async () => {
  const { api } = await loadWorkerHarness();
  const senderA = { url: 'chrome-extension://test/dashboard.html', tab: { id: 1 } };
  const senderB = { url: 'http://localhost:8787/', tab: { id: 2 } };

  const acquired = await api.beginRunLease({ ownerToken: 'owner-a', ttlMs: 120000 }, senderA);
  const denied = await api.beginRunLease({ ownerToken: 'owner-b', ttlMs: 120000 }, senderB);
  const wrongRelease = await api.endRunLease({ ownerToken: 'owner-b' }, senderB);
  const heartbeat = await api.heartbeatRunLease({ ownerToken: 'owner-a', ttlMs: 120000 }, senderA);
  const released = await api.endRunLease({ ownerToken: 'owner-a' }, senderA);

  assert.equal(acquired.ok, true);
  assert.equal(denied.code, 'run_locked');
  assert.equal(wrongRelease.ok, false);
  assert.equal(heartbeat.ok, true);
  assert.equal(released.released, true);
});

test('로그인 확인 반복 POST가 없고 안정화 기능이 최종 실행 코드에 연결되어 있다', async () => {
  const [{ source: workerSource }, appSource] = await Promise.all([
    loadWorkerHarness(),
    readFile(appPath, 'utf8')
  ]);

  assert.equal(workerSource.includes('__winglens_login_check__'), false);
  assert.match(workerSource, /WL_EXTERNAL_BEGIN_RUN/);
  assert.match(workerSource, /runGuardedRemoteRequest/);
  assert.match(workerSource, /metricInflight/);
  assert.match(workerSource, /shippingInflight/);
  assert.match(workerSource, /wingLoginAndCircuitStatus/);
  assert.match(workerSource, /remoteCircuit/);

  assert.match(appSource, /wingCircuitStorageKey/);
  assert.match(appSource, /wing-lens-analysis-range-v1/);
  assert.match(appSource, /readWingRange/);
  assert.match(appSource, /saveWingRange\(\)/);
  assert.match(appSource, /wingReviewFilter\.className='wing-review-filter'/);
  assert.match(appSource, /<legend>리뷰수 조회<\/legend>/);
  assert.match(appSource, /WL_EXTERNAL_HEARTBEAT_RUN/);
  assert.match(appSource, /wingCheckpointKey/);
  assert.match(appSource, /dedupeWingProducts/);
  assert.match(appSource, /completedIds/);
  assert.match(appSource, /로그인 완료 확인/);
  assert.match(appSource, /wingAutoRetryDelayMs=30\*60\*1000/);
  assert.match(appSource, /wingAutoRetryEnabled=false/);
  assert.match(appSource, /scheduleWingAutoRetry/);
  assert.match(appSource, /runWingAutoRetry/);
  assert.match(appSource, /showAppNotice/);
  assert.match(appSource, /clearWingAutoRetry\(\)/);
  assert.match(appSource, /wingRemoteProductDelayMs=10000/);
  assert.match(appSource, /madeRemoteRequest&&index<checkpoint\.products\.length-1/);
  assert.match(appSource, /metricCompletedJobsExpanded/);
  assert.match(appSource, /data-metric-completed-toggle/);
  assert.match(appSource, /완료 목록 펼치기/);
  assert.match(appSource, /metricHistoryCollapsed/);
  assert.match(appSource, /metricHistoryToggle/);
  assert.match(appSource, /function toggleMetricHistory\(\)/);
  assert.match(appSource, /items\.style\.display=collapsed\?'none':'grid'/);
  assert.match(appSource, /목록 펼치기/);
  assert.match(appSource, /filter-section-toggle/);
  assert.match(appSource, /필터 펼치기/);
  assert.match(appSource, /judgeRunToggle/);
  assert.match(appSource, /소싱판별 펼치기/);
  assert.match(appSource, /sourcing-judge-collapse-state-v1/);
  assert.match(appSource, /setFilterCollapsed/);
  assert.match(appSource, /setJudgeRunCollapsed/);
  assert.match(appSource, /judgeResults\.classList\.toggle\('is-collapsed',collapsed\)/);
  assert.match(appSource, /metricHistoryCollapsed=window\.sourcingJudgeCollapseState\.get/);
  assert.match(appSource, /metricCompletedJobsExpanded=window\.sourcingJudgeCollapseState\.get/);
  assert.match(appSource, /wing-queue-selection-actions/);
  assert.match(appSource, /wing-queue-completed-actions/);
  assert.match(appSource, /const selectableJobs=indexedJobs\.filter\(\(\{job\}\)=>job\.status!=='완료'\)/);
  assert.match(appSource, /metricManualJobSelection\.has\(job\.id\)&&job\.status!=='완료'/);
});

test('필터결과 목록의 접기·펼치기 제어가 제목 옆에 등록되어 있다', async () => {
  const source = await readFile(targetListPath, 'utf8');
  assert.match(source, /targetListPanelToggle/);
  assert.match(source, /targetListCollapsed/);
  assert.match(source, /target-list-title-row/);
  assert.match(source, /collapsed\?'펼치기':'접기'/);
  assert.match(source, /sourcingJudgeCollapseState/);
  assert.match(source, /targetListFieldCollapsed/);
});

test('판매지표 분석예약 리스트 제목은 가로 한 줄로 표시한다', async () => {
  const source = await readFile(stylePath, 'utf8');
  assert.match(source, /\.wing-queue-list>\.wing-queue-list-title\{display:flex!important/);
  assert.match(source, /\.wing-queue-list-title>strong\{min-width:max-content!important;white-space:nowrap!important\}/);
});

test('리뷰수 조회 입력란은 분석 프레임 안에서 컴팩트하게 표시한다', async () => {
  const source = await readFile(stylePath, 'utf8');
  assert.match(source, /\.wing-search-form \.wing-review-filter\{flex:0 1 168px!important;width:168px!important/);
  assert.match(source, /\.wing-search-form \.wing-review-filter input\{flex:0 1 58px!important;width:58px!important/);
});

test('배송유형 조회 블록은 설정저장 버튼 뒤의 불필요한 여백을 만들지 않는다', async () => {
  const source = await readFile(stylePath, 'utf8');
  assert.match(source, /\.wing-search-form \.wing-delivery-filter\{width:fit-content!important;min-width:0!important;max-width:100%!important\}/);
});

test('선택 키워드 조회는 예약 대기 없이 바로 다음 키워드를 실행한다', async () => {
  const source = await readFile(appPath, 'utf8');
  assert.match(source, /selected\.forEach\(job=>\{job\.status='대기';job\.scheduledAt=''\}\)/);
  assert.match(source, /다음 선택 키워드 조회를 즉시 시작합니다\./);
  assert.doesNotMatch(source, /metricReservationKeywordDelayMs/);
  assert.doesNotMatch(source, /예약일시가 된 .*키워드 조회를 시작합니다/);
});

test('사용자가 선택 키워드 재조회를 누르면 로컬 차단기를 해제한다', async () => {
  const source = await readFile(appPath, 'utf8');
  assert.match(source, /function unlockWingCircuitForManualRetry\(\)/);
  assert.match(source, /writeWingCircuit\(\{state:'closed'\}\)/);
  assert.match(source, /const circuitUnlocked=unlockWingCircuitForManualRetry\(\)/);
  assert.match(source, /재조회 차단을 해제하고 즉시 시작합니다/);
});

test('선택 키워드 조회는 체크한 예약만 실행하고 예약리스트 전체 삭제를 지원한다', async () => {
  const source = await readFile(appPath, 'utf8');
  assert.match(source, /let metricManualRunIds=null/);
  assert.match(source, /metricManualRunIds=new Set\(selected\.map\(job=>job\.id\)\)/);
  assert.match(source, /metricManualRunIds&&!metricManualRunIds\.has\(job\.id\)/);
  assert.match(source, /data-metric-job-delete-all/);
  assert.match(source, /예약리스트 삭제/);
  assert.match(source, /선택한 판매지표 분석예약 .* 삭제할까요/);
  assert.match(source, /metricReservationJobs=metricReservationJobs\.filter\(job=>!selectedIds\.has\(job\.id\)\)/);
  assert.match(source, /metricManualRunIds=null;/);
});
