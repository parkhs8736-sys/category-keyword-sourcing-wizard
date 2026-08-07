/* 소싱판별은 다른 화면 기능 오류와 관계없이 항상 실행되도록 독립 실행기를 먼저 등록합니다. */
window.addEventListener('load',()=>{
  const run=document.querySelector('#runButton');
  const stop=document.querySelector('#stopButton');
  const progressBox=document.querySelector('#progressBox');
  const progressLabel=document.querySelector('#progressLabel');
  const progressCount=document.querySelector('#progressCount');
  const progressBar=document.querySelector('#progressBar');
  const resultBody=document.querySelector('#resultBody');
  if(!run||!stop||!progressBox||!resultBody)return;

  const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[char]));
  const draw=()=>{
    const onlyPass=document.querySelector('#passOnly input')?.checked;
    const rows=onlyPass?state.results.filter(row=>row.decision==='통과'):state.results;
    resultBody.innerHTML=rows.length?rows.map(row=>`<tr><td><label class="metric-keyword"><input class="metric-keyword-check" type="checkbox" value="${escapeHtml(row.keyword)}"><b>${escapeHtml(row.keyword)}</b></label></td><td><span class="${escapeHtml(row.className)}">${escapeHtml(row.decision)}</span></td><td class="reason">${escapeHtml(row.reason)}</td><td>${escapeHtml(row.category)}</td><td>${escapeHtml(row.ratio)}</td><td>${escapeHtml(row.volume)}</td><td>${escapeHtml(row.coupang)}</td><td>${escapeHtml(row.naverPrice)}</td><td>${escapeHtml(row.competition)}</td><td>${escapeHtml(row.season)}</td></tr>`).join(''):`<tr class="empty"><td colspan="10">${state.results.length?'통과한 키워드가 없습니다.':'엑셀 파일을 올린 뒤 소싱판별 실행을 눌러 주세요.'}</td></tr>`;
    const count=document.querySelector('#resultCount');
    const download=document.querySelector('#exportButton');
    if(count)count.textContent=rows.length;
    if(download)download.disabled=!state.results.length;
  };
  const notify=message=>{
    const toastElement=document.querySelector('#toast');
    if(toastElement){toastElement.textContent=message;toastElement.classList.add('show');setTimeout(()=>toastElement.classList.remove('show'),2600)}
  };
  stop.onclick=()=>{state.cancelled=true;state.controller?.abort();stop.disabled=true;if(progressLabel)progressLabel.textContent='소싱 판별 중단 요청됨'};
  run.onclick=async()=>{
    const allTargets=(Array.isArray(state.records)?state.records:[]).filter(row=>row&&String(row.keyword||'').trim());
    const selectedTargets=window.targetKeywordSelection instanceof Set?window.targetKeywordSelection:new Set();
    const list=selectedTargets.size?allTargets.filter(row=>selectedTargets.has(String(row.keyword))):allTargets;
    if(!list.length){notify('먼저 전체 키워드를 추출해 판별 대상을 준비해 주세요.');return}
    try{
      const authResponse=await fetch('/api/auth/status');
      const auth=await authResponse.json();
      if(!auth.valid){notify('인증 기간이 만료되었습니다. 인증 화면에서 코드를 다시 입력해 주세요.');return}
    }catch{notify('인증 상태를 확인하지 못했습니다. 서버를 다시 실행해 주세요.');return}
    state.results=[];state.cancelled=false;state.controller=new AbortController();
    run.disabled=true;run.classList.add('is-judging');stop.disabled=false;progressBox.classList.remove('hidden');
    if(progressLabel)progressLabel.textContent='소싱 판별 조회 준비 중';
    if(progressCount)progressCount.textContent=`0 / ${list.length}`;
    if(progressBar)progressBar.style.width='0%';
    draw();
    try{
      for(let index=0;index<list.length&&!state.cancelled;index+=2){
        const chunk=await Promise.all(list.slice(index,index+2).map(async source=>{
          try{
            const response=await fetch(`/api/judge?keyword=${encodeURIComponent(source.keyword)}`,{signal:state.controller.signal});
            const data=await response.json();
            return toRow(source,data,response.ok?'':(data.message||'판별 서버 오류'));
          }catch(error){return toRow(source,null,error.name==='AbortError'?'조회 중단':'판별 서버 연결 실패')}
        }));
        if(state.cancelled)break;
        state.results.push(...chunk);draw();
        const processed=Math.min(index+2,list.length);
        if(progressLabel)progressLabel.textContent='소싱 판별 조회 중';
        if(progressCount)progressCount.textContent=`${processed} / ${list.length}`;
        if(progressBar)progressBar.style.width=`${processed/list.length*100}%`;
        if(processed<list.length)await new Promise(resolve=>setTimeout(resolve,350));
      }
      if(progressLabel)progressLabel.textContent=state.cancelled?'소싱 판별 중단됨':'소싱 판별 완료';
      notify(state.cancelled?`${state.results.length}개 결과까지만 저장했습니다.`:`${state.results.length}개 키워드의 판별이 완료되었습니다.`);
    }catch(error){
      if(progressLabel)progressLabel.textContent='소싱 판별 실행 오류';
      notify(error.message||'소싱판별 실행 중 오류가 발생했습니다.');
    }finally{run.disabled=false;run.classList.remove('is-judging');stop.disabled=true}
  };

  // 판별 결과 전체선택: 화면의 체크 표시와 판매지표 분석 예약 대상이 항상 같은 상태가 되게 합니다.
  const resultSelectAll=document.querySelector('#metricQueueSelectAll');
  if(resultSelectAll){
    resultSelectAll.onchange=event=>{
      const onlyPass=document.querySelector('#passOnly input')?.checked;
      const rows=onlyPass?state.results.filter(row=>row.decision==='통과'):state.results;
      rows.forEach(row=>event.target.checked?metricQueueSelection.add(row.keyword):metricQueueSelection.delete(row.keyword));
      resultBody.querySelectorAll('.metric-keyword-check').forEach(input=>{
        if(rows.some(row=>row.keyword===input.value))input.checked=event.target.checked;
      });
      updateMetricQueueSelection();
    };
  }
});

const state={records:[],results:[],cancelled:false,controller:null};const $=s=>document.querySelector(s);const body=$('#resultBody');const filteredDownload=document.createElement('button');filteredDownload.id='downloadFiltered';filteredDownload.className='outline';filteredDownload.textContent='필터 엑셀 다운로드';filteredDownload.disabled=true;$('#filterInfo').before(filteredDownload);
// 접기·펼치기 상태는 이 PC의 브라우저에만 저장해, 새로고침 뒤에도 마지막 화면을 복원합니다.
const collapseStateKey='sourcing-judge-collapse-state-v1';
const readCollapseState=()=>{try{const saved=JSON.parse(localStorage.getItem(collapseStateKey)||'{}');return saved&&typeof saved==='object'?saved:{}}catch{return {}}};
window.sourcingJudgeCollapseState={
  get(name,fallback=false){const value=readCollapseState()[name];return typeof value==='boolean'?value:fallback},
  set(name,value){const saved=readCollapseState();saved[name]=Boolean(value);localStorage.setItem(collapseStateKey,JSON.stringify(saved))}
};
let currentRecords=[];Object.defineProperty(state,'records',{get:()=>currentRecords,set:value=>{currentRecords=Array.isArray(value)?value:[];window.targetKeywordSelection?.clear?.();if(typeof window.renderTargetList==='function')window.renderTargetList();if(currentRecords.length&&typeof window.persistJudgeWorkspace==='function')window.persistJudgeWorkspace()}});$('.upload p').remove();$('header .intro').remove();$('.filter-head p').remove();
const headerMessage=document.createElement('p');headerMessage.textContent='셀러라이프 카테고리별 키워드를 “한이룸소싱 판별기”로 소싱여부를 빠르게 판단';headerMessage.style.cssText='max-width:430px;margin:0 0 0 30px;padding:15px 18px;border-left:3px solid #1967d9;background:#fff;color:#33445a;font-size:14px;font-weight:700;line-height:1.6';$('header').append(headerMessage);
const authRememberKey='sourcing-remember-auth';
const rememberedDevice=localStorage.getItem(authRememberKey)==='true';
const clientStore=rememberedDevice?localStorage:sessionStorage;
const clientId=clientStore.getItem('sourcing-client-id')||crypto.randomUUID();
clientStore.setItem('sourcing-client-id',clientId);
const originalFetch=window.fetch.bind(window);
window.fetch=(resource,options={})=>{const path=typeof resource==='string'?resource:resource.url;if(path.startsWith('/api/')){const headers=new Headers(options.headers||{});headers.set('x-client-id',clientId);options={...options,headers}}return originalFetch(resource,options)};
const authGate=document.createElement('div');
authGate.innerHTML='<div><p class="auth-mark">S</p><h1>소싱 판별 관리자</h1><p class="auth-copy">사용자 인증코드를 입력해 주세요.</p><input id="authCode" type="password" autocomplete="off" placeholder="인증코드 입력"><label id="authRememberRow"><input id="authRemember" type="checkbox"> 비밀번호 기억</label><button id="authSubmit" type="button">인증하고 시작하기</button><p id="authMessage"></p></div>';
authGate.style.cssText='position:fixed;inset:0;z-index:2000;display:grid;place-items:center;background:linear-gradient(135deg,#122236,#1d3d66);padding:20px';
const authCard=authGate.firstElementChild;
authCard.style.cssText='width:min(400px,100%);padding:38px;background:#fff;border-radius:18px;text-align:center;box-shadow:0 24px 70px rgba(0,0,0,.35)';
authCard.querySelector('.auth-mark').style.cssText='margin:0 auto 12px;width:42px;height:42px;border-radius:12px;display:grid;place-items:center;background:#1967d9;color:#fff;font-weight:900;font-size:22px';
authCard.querySelector('h1').style.cssText='margin:0;font-size:22px';
authCard.querySelector('.auth-copy').style.cssText='margin:10px 0 22px;color:#728094;font-size:13px';
authCard.querySelector('#authCode').style.cssText='width:100%;padding:13px;border:1px solid #d9e2ed;border-radius:8px;font:inherit;text-align:center';
authCard.querySelector('#authRememberRow').style.cssText='display:flex;align-items:center;justify-content:flex-start;gap:7px;margin:12px 0 0;color:#53657a;font-size:13px;font-weight:700;cursor:pointer';
authCard.querySelector('#authRemember').checked=rememberedDevice;
authCard.querySelector('button').style.cssText='width:100%;margin-top:14px;padding:13px;border:0;border-radius:8px;background:#1967d9;color:#fff;font:inherit;font-weight:800;cursor:pointer';
authCard.querySelector('#authMessage').style.cssText='min-height:18px;margin:14px 0 0;color:#cf4a50;font-size:12px';
document.body.append(authGate);
const authMessage=authCard.querySelector('#authMessage');
async function checkAuth(){const res=await fetch('/api/auth/status');const data=await res.json();if(data.valid){authGate.remove();return true}return false}
authCard.querySelector('#authSubmit').onclick=async()=>{const code=authCard.querySelector('#authCode').value.trim(),remember=authCard.querySelector('#authRemember').checked;authMessage.textContent='인증 확인 중…';try{const res=await fetch('/api/auth/activate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code,clientId})});const data=await res.json();if(!res.ok)throw new Error(data.message);if(remember){localStorage.setItem(authRememberKey,'true');localStorage.setItem('sourcing-client-id',clientId)}else{localStorage.removeItem(authRememberKey);localStorage.removeItem('sourcing-client-id');sessionStorage.setItem('sourcing-client-id',clientId)}authMessage.style.color='#16845b';authMessage.textContent=data.kind==='trial'?`인증 완료 · ${new Date(data.expiresAt).toLocaleDateString('ko-KR')}까지 사용 가능`:'인증 완료 · 기간 제한 없음';setTimeout(()=>{authGate.remove();initializeWingLens()},700)}catch(error){authMessage.style.color='#cf4a50';authMessage.textContent=error?.message==='Failed to fetch'?'로컬 서버 연결이 끊겼습니다. 실행하기.bat를 실행한 뒤 새로고침해 주세요.':error.message||'인증에 실패했습니다.'}};
checkAuth().catch(()=>authMessage.textContent='인증 서버에 연결하지 못했습니다.');
$('.upload h2').textContent='엑셀파일올리기';
const guideButton=document.createElement('button');guideButton.type='button';guideButton.className='outline';guideButton.textContent='다운로드 방법 안내';guideButton.style.cssText='margin-left:10px;padding:7px 10px;font-size:12px';$('.upload h2').after(guideButton);const guideModal=document.createElement('div');guideModal.setAttribute('role','dialog');guideModal.setAttribute('aria-modal','true');guideModal.setAttribute('aria-label','카테고리 엑셀 다운로드 방법 안내');guideModal.innerHTML='<div class="guide-panel"><button type="button" class="guide-close" aria-label="닫기">×</button><h2>카테고리 엑셀파일 다운로드 방법</h2><p>셀러라이프의 카테고리 소싱 화면에서 전체 카테고리 엑셀 다운로드 버튼을 선택해 주세요.</p><img src="category-download-guide.png" alt="카테고리 소싱 화면의 전체 카테고리 엑셀 다운로드 위치 안내"></div>';guideModal.style.cssText='display:none;position:fixed;inset:0;z-index:1000;background:rgba(15,30,48,.62);padding:30px;overflow:auto';document.body.append(guideModal);const panel=guideModal.querySelector('.guide-panel');panel.style.cssText='position:relative;max-width:1200px;margin:20px auto;background:#fff;border-radius:14px;padding:24px;box-shadow:0 20px 70px rgba(0,0,0,.3)';panel.querySelector('h2').style.cssText='margin:0 36px 8px 0;font-size:19px';panel.querySelector('p').style.cssText='margin:0 0 16px;color:#66758a;font-size:13px';panel.querySelector('img').style.cssText='display:block;width:100%;height:auto;border:1px solid #e6ebf1;border-radius:8px';const closeGuide=()=>guideModal.style.display='none';guideButton.onclick=()=>guideModal.style.display='block';guideModal.querySelector('.guide-close').onclick=closeGuide;guideModal.onclick=e=>{if(e.target===guideModal)closeGuide()};document.addEventListener('keydown',e=>{if(e.key==='Escape')closeGuide()});
const uploadHeadingPlate=document.createElement('div');uploadHeadingPlate.className='upload-heading-plate';const uploadStep=$('.upload .step'),uploadCopy=$('.upload h2').parentElement;uploadHeadingPlate.append(uploadStep,uploadCopy);$('.upload').prepend(uploadHeadingPlate);
const judgeSource=document.createElement('p');judgeSource.innerHTML='소싱판별기 제공: <strong>한이룸. 소싱 판결사</strong> · <a href="https://select.irumai.kr/" target="_blank" rel="noopener noreferrer">https://select.irumai.kr/</a>';judgeSource.style.cssText='margin:8px 0 16px 48px;color:#728094;font-size:12px';judgeSource.querySelector('a').style.cssText='color:#1967d9;text-decoration:none;font-weight:700';$('.run').after(judgeSource);
$('#applyFilter').style.display='none';const passOnly=document.createElement('label');passOnly.id='passOnly';passOnly.innerHTML='<input type="checkbox"> 통과만 보기';$('.section-title').append(passOnly);passOnly.querySelector('input').onchange=()=>render();const resultStyle=document.createElement('style');resultStyle.textContent='.table-wrap table th:nth-child(1),.table-wrap table td:nth-child(1){position:sticky;left:0;min-width:140px;z-index:2;background:#fff}.table-wrap table th:nth-child(2),.table-wrap table td:nth-child(2){position:sticky;left:140px;min-width:130px;z-index:2;background:#fff}.table-wrap table th:nth-child(3),.table-wrap table td:nth-child(3){position:sticky;left:270px;min-width:280px;z-index:2;background:#fff}.table-wrap table th:nth-child(-n+3){z-index:3;background:#f8fafc}.section-title #passOnly{margin-left:auto;margin-right:12px;color:#53657a;font-size:13px;font-weight:700}.section-title #passOnly input{accent-color:#1967d9;margin-right:6px}';document.head.append(resultStyle);
const extractAll=document.createElement('button');extractAll.id='extractAll';extractAll.type='button';extractAll.className='outline';extractAll.textContent='전체 키워드 추출';extractAll.title='필터 조건에 맞는 모든 키워드를 판별 대상으로 준비합니다.';$('#filterInfo').before(extractAll);
const fullQuery=document.createElement('label');fullQuery.id='fullQuery';fullQuery.innerHTML='<input type="checkbox"> 전체 조회';fullQuery.title='필터 조건에 맞는 모든 키워드를 판별합니다. 결과가 많으면 오래 걸릴 수 있습니다.';$('#limit').closest('label').after(fullQuery);fullQuery.querySelector('input').onchange=e=>{$('#limit').disabled=e.target.checked};
$('#limit').onchange=()=>{const value=Math.max(1,Number($('#limit').value)||100);$('#limit').value=value;if(!fullQuery.querySelector('input').checked&&$('#fileInput').files[0]&&state.records.length!==value){$('#filterInfo').textContent=`최대 ${value.toLocaleString()}개 조회 대상으로 다시 추출 중…`;$('#applyFilter').click()}};
setTimeout(()=>{fullQuery.querySelector('input').onchange=e=>{const all=e.target.checked;$('#limit').disabled=all;if(all&&$('#fileInput').files[0]&&state.records.length<state.totalMatched){state.records=[];$('#runButton').disabled=true;$('#filterInfo').textContent='전체 조회 대상으로 다시 추출 중…';$('#applyFilter').click()}else if(!all&&state.records.length>Number($('#limit').value)){state.records=state.records.slice(0,Math.max(1,Number($('#limit').value)||100));$('#filterInfo').textContent=`최대 ${state.records.length.toLocaleString()}개 조회 대상으로 전환했습니다.`}}},70);
setTimeout(()=>{fullQuery.querySelector('input').onchange=e=>{const all=e.target.checked;$('#limit').disabled=all;if(all&&$('#fileInput').files[0]&&state.records.length<state.totalMatched){if(!$('#stopButton').disabled){state.cancelled=true;state.controller?.abort();$('#stopButton').disabled=true}state.records=[];$('#runButton').disabled=true;$('#filterInfo').textContent='전체 조회 대상으로 다시 추출 중…';$('#applyFilter').click()}else if(!all&&state.records.length>Number($('#limit').value)){state.records=state.records.slice(0,Math.max(1,Number($('#limit').value)||100));$('#filterInfo').textContent=`최대 ${state.records.length.toLocaleString()}개 조회 대상으로 전환했습니다.`}}},90);
const filterToggle=document.createElement('button');filterToggle.type='button';filterToggle.className='outline filter-section-toggle';$('.filter-head').append(filterToggle);const setFilterCollapsed=collapsed=>{const filterSection=$('.filters');filterSection.classList.toggle('is-collapsed',collapsed);filterToggle.textContent=collapsed?'필터 펼치기':'필터 접기';filterToggle.setAttribute('aria-expanded',String(!collapsed));window.sourcingJudgeCollapseState.set('filter',collapsed)};setFilterCollapsed(window.sourcingJudgeCollapseState.get('filter',false));filterToggle.onclick=()=>setFilterCollapsed(!$('.filters').classList.contains('is-collapsed'));
const presetKey='sourcing-judge-filter-presets-v1';const presetBar=document.createElement('div');presetBar.className='filter-presets';presetBar.innerHTML='<strong>저장 필터</strong><select id="presetSlot"></select><input id="presetName" maxlength="20" placeholder="필터 이름"><button id="savePreset" type="button" class="outline">저장</button><button id="loadPreset" type="button" class="outline">불러오기</button><button id="deletePreset" type="button" class="outline">삭제</button>';$('.filter-head').after(presetBar);const presetSlot=$('#presetSlot'),presetName=$('#presetName');const readPresets=()=>JSON.parse(localStorage.getItem(presetKey)||'{}');function renderPresets(){const presets=readPresets();presetSlot.innerHTML=[1,2,3,4,5].map(slot=>`<option value="${slot}">필터${slot}${presets[slot]?.name?' · '+clean(presets[slot].name):''}</option>`).join('')}renderPresets();function applyFilters(data){for(const name of ['brand','shopping','peakMonth'])document.querySelectorAll(`input[name="${name}"]`).forEach(input=>input.checked=(data[name]||[]).includes(input.value));for(const field of ['volume','lastYearVolume','naverPrice','coupangPrice','deliveryRate','overseasReviews']){document.querySelector(`[data-field="${field}"]`).value=data[field]?.operator||'gte';document.querySelector(`[data-value="${field}"]`).value=data[field]?.value||''}}$('#savePreset').onclick=()=>{const slot=presetSlot.value,name=presetName.value.trim();if(!name){toast('저장할 필터 이름을 입력해 주세요.');presetName.focus();return}const presets=readPresets();presets[slot]={name,filters:filters()};localStorage.setItem(presetKey,JSON.stringify(presets));renderPresets();presetSlot.value=slot;toast(`필터${slot} · ${name} 저장 완료`)};$('#loadPreset').onclick=()=>{const preset=readPresets()[presetSlot.value];if(!preset){toast('이 슬롯에는 저장된 필터가 없습니다.');return}presetName.value=preset.name;applyFilters(preset.filters);toast(`${preset.name} 필터를 불러왔습니다.`)};$('#deletePreset').onclick=()=>{const slot=presetSlot.value,presets=readPresets();if(!presets[slot]){toast('삭제할 저장 필터가 없습니다.');return}delete presets[slot];localStorage.setItem(presetKey,JSON.stringify(presets));presetName.value='';renderPresets();presetSlot.value=slot;toast(`필터${slot}을 삭제했습니다.`)};
const labels=['키워드','통과여부','통과/탈락 사유','카테고리','경쟁률(%)','최근1개월검색량','쿠팡평균가','네이버평균가','네이버경쟁강도','계절성월'];
const headerStyle=document.createElement('style');headerStyle.textContent='.table-wrap thead th{position:sticky;top:0;z-index:4}.table-wrap thead th:nth-child(1),.table-wrap thead th:nth-child(2),.table-wrap thead th:nth-child(3){z-index:5}';document.head.append(headerStyle);
document.querySelector('[data-field="deliveryRate"]').parentElement.firstChild.nodeValue='배송비율(로켓+판매자)(AC+AD)';
document.querySelector('input[name="brand"][value="X"]').checked=true;document.querySelector('input[name="shopping"][value="O"]').checked=true;
presetBar.style.cssText='display:flex;align-items:center;gap:8px;margin:-4px 0 16px;padding:10px 12px;background:#f8fafc;border:1px solid #e6ebf1;border-radius:8px;font-size:12px';presetBar.querySelectorAll('select,input').forEach(el=>el.style.cssText='padding:7px;border:1px solid #d7e0ea;border-radius:6px;font:inherit');presetBar.querySelectorAll('button').forEach(el=>el.style.cssText='padding:7px 10px');presetSlot.onchange=()=>{const preset=readPresets()[presetSlot.value];presetName.value=preset?.name||'';if(preset){applyFilters(preset.filters);toast(`“${preset.name}” 필터를 자동으로 적용했습니다.`)}};
filteredDownload.onclick=()=>{const headers=['키워드','카테고리','브랜드키워드','쇼핑키워드','경쟁률','최근1개월검색량','작년검색량','작년최대검색월','계절성월','네이버경쟁강도','네이버평균가','쿠팡평균가','로켓배송비율','판매자로켓배송비율','배송비율(합계)','쿠팡해외배송총리뷰수'];const rows=[headers,...state.records.map(r=>[r.keyword,r.category,r.brand,r.shopping,r.ratio,r.volume,r.lastYearVolume,r.peakMonth,r.season,r.competition,r.naverPrice,r.coupangPrice,r.rocketRate,r.sellerRocketRate,r.deliveryRate,r.overseasReviews])];const ws=XLSX.utils.aoa_to_sheet(rows);ws['!cols']=headers.map((h,i)=>({wch:i===0?26:Math.max(14,h.length+3)}));const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'필터링결과');XLSX.writeFile(wb,`필터링_키워드_${new Date().toISOString().slice(0,10)}.xlsx`)};
setInterval(()=>{filteredDownload.disabled=!state.records.length},250);
extractAll.onclick=async()=>{const file=$('#fileInput').files[0];if(!file){toast('먼저 원본 엑셀 파일을 올려 주세요.');return}const selected=filters();extractAll.disabled=true;extractAll.classList.add('is-extracting');extractAll.textContent='전체 키워드 추출 중…';$('#runButton').disabled=true;$('#filterInfo').textContent='원본 전체에서 필터 조건에 맞는 모든 키워드를 추출 중…';try{const qs=new URLSearchParams({limit:'0',filters:JSON.stringify(selected)});const response=await fetch(`/api/keywords?${qs}`,{method:'POST',body:await file.arrayBuffer()});const result=await response.json();if(!response.ok)throw new Error(result.message);if(JSON.stringify(result.appliedFilters)!==JSON.stringify(selected))throw new Error('필터 서버가 최신 버전이 아닙니다. 실행 창을 닫고 실행하기.bat를 다시 실행해 주세요.');state.records=result.records||[];state.totalMatched=Number(result.matchedCount)||state.records.length;$('#filterInfo').textContent=`필터 조건에 맞는 전체 ${state.records.length.toLocaleString()}개를 판별 대상으로 준비했습니다.`;$('#runButton').disabled=!state.records.length;filteredDownload.disabled=!state.records.length;toast(`전체 ${state.records.length.toLocaleString()}개 키워드가 준비되었습니다.`);alert('키워드 추출완료') }catch(error){$('#filterInfo').textContent='전체 추출 실패';toast(error.message||'전체 키워드를 추출하지 못했습니다.')}finally{extractAll.disabled=false;extractAll.classList.remove('is-extracting');extractAll.textContent='전체 키워드 추출'}};
setTimeout(()=>{$('#applyFilter').onclick=async()=>{const file=$('#fileInput').files[0];if(!file)return;const limit=Math.max(1,Number($('#limit').value)||100),selected=filters();$('#applyFilter').disabled=true;$('#filterInfo').textContent='원본 전체에서 필터 조건을 검증 중…';try{const qs=new URLSearchParams({limit:String(limit),filters:JSON.stringify(selected)});const response=await fetch(`/api/keywords?${qs}`,{method:'POST',body:await file.arrayBuffer()});const result=await response.json();if(!response.ok)throw new Error(result.message);if(JSON.stringify(result.appliedFilters)!==JSON.stringify(selected))throw new Error('필터 서버가 최신 버전이 아닙니다. 실행 창을 닫고 실행하기.bat를 다시 실행해 주세요.');state.records=result.records||[];state.totalMatched=Number(result.matchedCount)||0;$('#fileInfo').textContent=`${result.sheetName} · 필터 완료`;$('#filterInfo').textContent=`전체 ${state.totalMatched.toLocaleString()}개 중 판별 대상 ${state.records.length.toLocaleString()}개를 준비했습니다.`;$('#runButton').disabled=!state.records.length;filteredDownload.disabled=!state.records.length;toast(`필터 조건에 맞는 전체 키워드는 ${state.totalMatched.toLocaleString()}개입니다.`)}catch(error){$('#filterInfo').textContent='추출 실패';toast(error.message||'필터링 중 오류가 발생했습니다.')}finally{$('#applyFilter').disabled=false}}},10);
setTimeout(()=>{$('#applyFilter').onclick=async()=>{const file=$('#fileInput').files[0];if(!file)return;const selected=filters(),all=fullQuery.querySelector('input').checked,limit=all?0:Math.max(1,Number($('#limit').value)||100);$('#applyFilter').disabled=true;$('#filterInfo').textContent=all?'원본 전체에서 모든 판별 대상을 준비 중…':'원본 전체에서 필터 조건을 검증 중…';try{const qs=new URLSearchParams({limit:String(limit),filters:JSON.stringify(selected)});const response=await fetch(`/api/keywords?${qs}`,{method:'POST',body:await file.arrayBuffer()});const result=await response.json();if(!response.ok)throw new Error(result.message);if(JSON.stringify(result.appliedFilters)!==JSON.stringify(selected))throw new Error('필터 서버가 최신 버전이 아닙니다. 실행 창을 닫고 실행하기.bat를 다시 실행해 주세요.');state.records=result.records||[];state.totalMatched=Number(result.matchedCount)||0;$('#fileInfo').textContent=`${result.sheetName} · 필터 완료`;$('#filterInfo').textContent=all?`필터 조건에 맞는 전체 ${state.records.length.toLocaleString()}개를 판별 대상으로 준비했습니다.`:`전체 ${state.totalMatched.toLocaleString()}개 중 판별 대상 ${state.records.length.toLocaleString()}개를 준비했습니다.`;$('#runButton').disabled=!state.records.length;filteredDownload.disabled=!state.records.length;toast(all?`전체 ${state.records.length.toLocaleString()}개 키워드 조회를 준비했습니다.`:`필터 조건에 맞는 전체 키워드는 ${state.totalMatched.toLocaleString()}개입니다.`)}catch(error){$('#filterInfo').textContent='추출 실패';toast(error.message||'필터링 중 오류가 발생했습니다.')}finally{$('#applyFilter').disabled=false}}},50);
setTimeout(()=>{$('#applyFilter').onclick=async()=>{const file=$('#fileInput').files[0];if(!file)return;const limit=Math.max(1,Number($('#limit').value)||100);$('#applyFilter').disabled=true;$('#filterInfo').textContent='원본 전체에서 필터 조건을 검증 중…';try{const qs=new URLSearchParams({limit:String(limit),filters:JSON.stringify(filters())});const response=await fetch(`/api/keywords?${qs}`,{method:'POST',body:await file.arrayBuffer()});const result=await response.json();if(!response.ok)throw new Error(result.message);state.records=result.records||[];state.totalMatched=Number(result.matchedCount)||0;$('#fileInfo').textContent=`${result.sheetName} · 필터 완료`;$('#filterInfo').textContent=`전체 ${state.totalMatched.toLocaleString()}개 중 판별 대상 ${state.records.length.toLocaleString()}개를 준비했습니다.`;$('#runButton').disabled=!state.records.length;filteredDownload.disabled=!state.records.length;toast(`필터 조건에 맞는 전체 키워드는 ${state.totalMatched.toLocaleString()}개입니다.`)}catch(error){$('#filterInfo').textContent='추출 실패';toast(error.message||'필터링 중 오류가 발생했습니다.')}finally{$('#applyFilter').disabled=false}}},0);
filteredDownload.onclick=async()=>{const file=$('#fileInput').files[0];if(!file){toast('먼저 원본 엑셀 파일을 올려 주세요.');return}filteredDownload.disabled=true;const originalLabel=filteredDownload.textContent;filteredDownload.textContent='전체 필터 결과 읽는 중…';try{const qs=new URLSearchParams({limit:'0',filters:JSON.stringify(filters())});const response=await fetch(`/api/keywords?${qs}`,{method:'POST',body:await file.arrayBuffer()});const result=await response.json();if(!response.ok)throw new Error(result.message);const headers=['키워드','카테고리','브랜드키워드','쇼핑키워드','경쟁률','최근1개월검색량','작년검색량','작년최대검색월','계절성월','네이버경쟁강도','네이버평균가','쿠팡평균가','로켓배송비율','판매자로켓배송비율','배송비율(로켓+판매자)','쿠팡해외배송총리뷰수'];const rows=[headers,...(result.records||[]).map(r=>[r.keyword,r.category,r.brand,r.shopping,r.ratio,r.volume,r.lastYearVolume,r.peakMonth,r.season,r.competition,r.naverPrice,r.coupangPrice,r.rocketRate,r.sellerRocketRate,r.deliveryRate,r.overseasReviews])];const ws=XLSX.utils.aoa_to_sheet(rows);ws['!cols']=headers.map((h,i)=>({wch:i===0?26:Math.max(14,h.length+3)}));const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'필터링결과');XLSX.writeFile(wb,`필터링_전체_${new Date().toISOString().slice(0,10)}.xlsx`);toast(`필터 조건에 맞는 전체 ${rows.length-1}개 행을 다운로드했습니다.`)}catch(error){toast(error.message||'전체 필터 결과를 만들지 못했습니다.')}finally{filteredDownload.textContent=originalLabel;filteredDownload.disabled=!state.records.length}};
function toast(message){const t=$('#toast');t.textContent=message;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),3200)}
function number(v,suffix=''){return v===undefined||v===null||v===''?'조회 데이터 없음':Number(v).toLocaleString('ko-KR')+suffix}
function percentage(v){if(v===undefined||v===null||v==='')return '조회 데이터 없음';const numericText=String(v).replace(/,/g,'').replace(/[^0-9.-]/g,'');if(!/[0-9]/.test(numericText))return '조회 데이터 없음';const value=Number(numericText);return Number.isFinite(value)?`${value.toLocaleString('ko-KR',{minimumFractionDigits:1,maximumFractionDigits:1})}%`:'조회 데이터 없음'}
function clean(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function toRow(source,d,error){const verdict=d?.verdict;const pass=verdict==='SELL', broad=verdict==='TOO_BROAD';return {keyword:source.keyword,decision:error?'조회 실패':pass?'통과':broad?'재검토':'불합격',reason:error||d?.reasons?.[0]?.line||d?.roast||'판별 사유 없음',category:source.category||'조회 데이터 없음',brand:source.brand||'조회 데이터 없음',shopping:source.shopping||'조회 데이터 없음',ratio:percentage(source.ratio),volume:number(source.volume,'회'),season:source.season||'조회 데이터 없음',competition:source.competition||'조회 데이터 없음',naverPrice:number(source.naverPrice,'원'),coupang:number(source.coupangPrice,'원'),className:error?'fail':pass?'pass':broad?'broad':'fail'} }
function render(){const rows=state.results;if(!rows.length){body.innerHTML='<tr class="empty"><td colspan="12">엑셀 파일을 올린 뒤 소싱판별 실행을 눌러 주세요.</td></tr>';return}body.innerHTML=rows.map(r=>`<tr><td><b>${clean(r.keyword)}</b></td><td><span class="${r.className}">${r.decision}</span></td><td class="reason">${clean(r.reason)}</td><td>${clean(r.category)}</td><td>${clean(r.brand)}</td><td>${clean(r.shopping)}</td><td>${clean(r.ratio)}</td><td>${clean(r.volume)}</td><td>${clean(r.season)}</td><td>${clean(r.competition)}</td><td>${clean(r.naverPrice)}</td><td>${clean(r.coupang)}</td></tr>`).join('');$('#resultCount').textContent=rows.length;$('#exportButton').disabled=!rows.length}
function render(){const rows=passOnly.querySelector('input').checked?state.results.filter(row=>row.decision==='통과'):state.results;if(!rows.length){body.innerHTML=`<tr class="empty"><td colspan="12">${state.results.length?'통과한 키워드가 없습니다.':'엑셀 파일을 올린 뒤 소싱판별 실행을 눌러 주세요.'}</td></tr>`;$('#resultCount').textContent=0;return}body.innerHTML=rows.map(r=>`<tr><td><b>${clean(r.keyword)}</b></td><td><span class="${r.className}">${r.decision}</span></td><td class="reason">${clean(r.reason)}</td><td>${clean(r.category)}</td><td>${clean(r.brand)}</td><td>${clean(r.shopping)}</td><td>${clean(r.ratio)}</td><td>${clean(r.volume)}</td><td>${clean(r.season)}</td><td>${clean(r.competition)}</td><td>${clean(r.naverPrice)}</td><td>${clean(r.coupang)}</td></tr>`).join('');$('#resultCount').textContent=rows.length;$('#exportButton').disabled=!rows.length}
for(let month=1;month<=12;month++)$('#monthChecks').insertAdjacentHTML('beforeend',`<label><input type="checkbox" name="peakMonth" value="${month}">${month}월</label>`);
function choices(name){return [...document.querySelectorAll(`input[name="${name}"]:checked`)].map(input=>input.value)}
function filters(){const result={brand:choices('brand'),shopping:choices('shopping'),peakMonth:choices('peakMonth')};for(const field of ['volume','lastYearVolume','naverPrice','coupangPrice','deliveryRate','overseasReviews'])result[field]={operator:document.querySelector(`[data-field="${field}"]`).value,value:document.querySelector(`[data-value="${field}"]`).value};return result}
$('#fileInput').addEventListener('change',e=>{const file=e.target.files[0];if(!file)return;$('#fileName').textContent=file.name;state.records=[];$('#runButton').disabled=true;if(location.protocol==='file:'){$('#fileInfo').textContent='서버 실행 필요';toast('실행하기.bat로 연 http://localhost:8787 화면에서만 읽을 수 있습니다.');return}$('#fileInfo').textContent='필터 조건을 정한 뒤 추출 버튼을 눌러 주세요.';$('#applyFilter').disabled=false});
$('#applyFilter').onclick=async()=>{const file=$('#fileInput').files[0];if(!file)return;const limit=Math.max(1,Number($('#limit').value)||100);$('#applyFilter').disabled=true;$('#filterInfo').textContent='원본 엑셀에서 조건에 맞는 행을 추출 중…';try{const qs=new URLSearchParams({limit:String(limit),filters:JSON.stringify(filters())});const response=await fetch(`/api/keywords?${qs}`,{method:'POST',body:await file.arrayBuffer()});const result=await response.json();if(!response.ok)throw new Error(result.message);state.records=result.records||[];$('#fileInfo').textContent=`${result.sheetName} · 필터 완료`;$('#filterInfo').textContent=`조건에 맞는 ${state.records.length.toLocaleString()}개 키워드를 추출했습니다.`;$('#runButton').disabled=!state.records.length;toast(`${state.records.length}개 키워드만 소싱 판별 대상으로 준비했습니다.`)}catch(error){$('#filterInfo').textContent='추출 실패';toast(error.message||'필터링 중 오류가 발생했습니다.')}finally{$('#applyFilter').disabled=false}};
async function judge(source){try{const r=await fetch(`/api/judge?keyword=${encodeURIComponent(source.keyword)}`,{signal:state.controller.signal});const d=await r.json();return toRow(source,d,r.ok?'':(d.message||'판별 서버 오류'))}catch(error){return toRow(source,null,error.name==='AbortError'?'조회 중단': '판별 서버 연결 실패')}}
$('#stopButton').onclick=()=>{state.cancelled=true;state.controller?.abort();$('#stopButton').disabled=true;$('#progressLabel').textContent='조회 중단 요청됨'};
$('#runButton').onclick=async()=>{const list=state.records;state.results=[];state.cancelled=false;state.controller=new AbortController();render();$('#runButton').disabled=true;$('#stopButton').disabled=false;$('#progressBox').classList.remove('hidden');for(let i=0;i<list.length&&!state.cancelled;i+=2){const chunk=await Promise.all(list.slice(i,i+2).map(judge));if(state.cancelled)break;state.results.push(...chunk);render();const n=Math.min(i+2,list.length);$('#progressLabel').textContent='소싱 판별 조회 중';$('#progressCount').textContent=`${n} / ${list.length}`;$('#progressBar').style.width=`${n/list.length*100}%`;if(n<list.length)await new Promise(r=>setTimeout(r,350))}$('#progressLabel').textContent=state.cancelled?'소싱 판별 중단됨':'소싱 판별 완료';$('#runButton').disabled=false;$('#stopButton').disabled=true;toast(state.cancelled?`${state.results.length}개 결과까지만 저장했습니다.`:`${state.results.length}개 키워드의 판별이 완료되었습니다.`)};
$('#exportButton').onclick=()=>{const rows=[labels,...state.results.map(r=>[r.keyword,r.decision,r.reason,r.category,r.brand,r.shopping,r.ratio,r.volume,r.season,r.competition,r.naverPrice,r.coupang])];const ws=XLSX.utils.aoa_to_sheet(rows);ws['!cols']=labels.map((x,i)=>({wch:i===2?50:Math.max(14,x.length+3)}));const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'소싱판별결과');XLSX.writeFile(wb,`소싱판별결과_${new Date().toISOString().slice(0,10)}.xlsx`)};
const reasonLineObserver=new MutationObserver(()=>{document.querySelectorAll('td.reason').forEach(cell=>{if(cell.dataset.reasonFormatted)return;const parts=cell.textContent.split(/\s*—\s*/);if(parts.length<2)return;cell.dataset.reasonFormatted='true';cell.replaceChildren(...parts.flatMap((part,index)=>index?[document.createElement('br'),document.createTextNode(`— ${part}`)]:[document.createTextNode(part)]))})});reasonLineObserver.observe(body,{childList:true,subtree:true});
const filterInfoEmphasisObserver=new MutationObserver(()=>{const info=$('#filterInfo'),text=info.textContent.trim(),match=text.match(/^필터 조건에 맞는 전체 ([\d,]+)개를 판별 대상으로 준비했습니다\.$/);if(info.dataset.emphasisText===text)return;if(!match){info.dataset.emphasisText='';info.style.fontSize='';return}info.dataset.emphasisText=text;info.style.fontSize='18px';info.innerHTML=`필터 조건에 맞는 전체 <strong style="color:#cf4a50">${match[1]}개</strong>를 판별 대상으로 준비했습니다.`});filterInfoEmphasisObserver.observe($('#filterInfo'),{childList:true,subtree:true,characterData:true});
const presetHelpButton=document.createElement('button');presetHelpButton.type='button';presetHelpButton.textContent='?';presetHelpButton.setAttribute('aria-label','저장 필터 안내 보기');presetHelpButton.style.cssText='width:24px;height:24px;padding:0;border:1px solid #b9d1f5;border-radius:50%;background:#fff;color:#1967d9;font-weight:800;line-height:1';const presetHelpText=document.createElement('span');presetHelpText.textContent='최대 5개의 필터를 저장하고 사용가능';presetHelpText.hidden=true;presetHelpText.style.cssText='color:#66758a;font-size:12px;font-weight:500';presetBar.querySelector('strong').after(presetHelpButton);presetHelpButton.after(presetHelpText);presetHelpButton.onclick=()=>{presetHelpText.hidden=!presetHelpText.hidden;presetHelpButton.setAttribute('aria-expanded',String(!presetHelpText.hidden))};
judgeSource.remove();
document.querySelector('.table-wrap thead th:nth-child(2)').textContent='통과여부';
document.querySelector('.section-title .eyebrow')?.remove();
document.querySelector('header .eyebrow')?.remove();
$('#fileInput').addEventListener('change',()=>{const fileInfo=$('#fileInfo');if(fileInfo.textContent==='필터 조건을 정한 뒤 추출 버튼을 눌러 주세요.')fileInfo.textContent=''});
document.querySelector('header h1').textContent='키워드 분석마법사 1.0';
headerMessage.textContent='셀러라이프에서 다운받은 카테고리별 키워드를 “한이룸소싱 판별기”를 사용해서 소싱여부를 빠르게 판단하는 마법사 입니다. (소싱판별 기준 DATA : 네이버데이터랩, 쿠팡X)';
function decorateFilterTitles(){document.querySelectorAll('.filter-grid>label').forEach(label=>{if(label.querySelector('.range-title,.filter-label-title'))return;const textNode=[...label.childNodes].find(node=>node.nodeType===Node.TEXT_NODE&&node.nodeValue.trim());if(!textNode)return;const title=document.createElement('span');title.className='filter-label-title';title.textContent=textNode.nodeValue.trim();textNode.replaceWith(title)})}
decorateFilterTitles();
$('#exportButton').onclick=()=>{const passOnlyChecked=passOnly.querySelector('input').checked,exportRows=passOnlyChecked?state.results.filter(row=>row.decision==='통과'):state.results;if(!exportRows.length){toast(passOnlyChecked?'다운로드할 통과 키워드가 없습니다.':'다운로드할 판별 결과가 없습니다.');return}const rows=[labels,...exportRows.map(row=>[row.keyword,row.decision,row.reason,row.category,row.ratio,row.volume,row.coupang,row.naverPrice,row.competition,row.season])],ws=XLSX.utils.aoa_to_sheet(rows);ws['!cols']=labels.map((label,index)=>({wch:index===2?50:Math.max(14,label.length+3)}));const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'소싱판별결과');XLSX.writeFile(wb,`소싱판별결과${passOnlyChecked?'_통과만':''}_${new Date().toISOString().slice(0,10)}.xlsx`)};
const peakMonthHelp=document.createElement('button');peakMonthHelp.type='button';peakMonthHelp.textContent='?';peakMonthHelp.setAttribute('aria-label','작년최대 검색월 안내 보기');peakMonthHelp.style.cssText='width:21px;height:21px;padding:0;border:1px solid #b9d1f5;border-radius:50%;background:#fff;color:#1967d9;font-weight:800;line-height:1';$('#monthChecks').before(peakMonthHelp);peakMonthHelp.onclick=()=>alert('시즌성 키워드를 찾는경우엔, 다음달부터~최대 4개월까지 체크 합니다(예: 현재 7월이면, 8월~11월까지 체크), 최대검색 월 기준으로 최소 1개월~2개월 전까지 상품준비완료');
const priceRuleOptions='<option value="gte">이상</option><option value="lte">이하</option><option value="lt">미만</option>';
function renderPriceRange(field,title){const label=document.querySelector(`[data-field="${field}"]`).closest('label');label.classList.add('price-range-filter');label.innerHTML=`<span class="range-title">${title}</span><span class="range-control"><b>최소</b><select data-range-field="${field}" data-range-bound="min" data-range-part="operator">${priceRuleOptions}</select><input data-range-field="${field}" data-range-bound="min" data-range-part="value" type="number" min="0" placeholder="원"></span><span class="range-control"><b>최대</b><select data-range-field="${field}" data-range-bound="max" data-range-part="operator">${priceRuleOptions}</select><input data-range-field="${field}" data-range-bound="max" data-range-part="value" type="number" min="0" placeholder="원"></span>`;label.querySelector('[data-range-bound="max"][data-range-part="operator"]').value='lte'}
renderPriceRange('naverPrice','네이버평균가(T)');renderPriceRange('coupangPrice','쿠팡평균가(Y)');
function readPriceCondition(field,bound){return {operator:document.querySelector(`[data-range-field="${field}"][data-range-bound="${bound}"][data-range-part="operator"]`).value,value:document.querySelector(`[data-range-field="${field}"][data-range-bound="${bound}"][data-range-part="value"]`).value}}
function filters(){const result={brand:choices('brand'),shopping:choices('shopping'),peakMonth:choices('peakMonth')};for(const field of ['volume','lastYearVolume','deliveryRate','overseasReviews'])result[field]={operator:document.querySelector(`[data-field="${field}"]`).value,value:document.querySelector(`[data-value="${field}"]`).value};for(const field of ['naverPrice','coupangPrice'])result[field]={min:readPriceCondition(field,'min'),max:readPriceCondition(field,'max')};return result}
function applyFilters(data){for(const name of ['brand','shopping','peakMonth'])document.querySelectorAll(`input[name="${name}"]`).forEach(input=>input.checked=(data[name]||[]).includes(input.value));for(const field of ['volume','lastYearVolume','deliveryRate','overseasReviews']){document.querySelector(`[data-field="${field}"]`).value=data[field]?.operator||'gte';document.querySelector(`[data-value="${field}"]`).value=data[field]?.value||''}for(const field of ['naverPrice','coupangPrice']){const saved=data[field]||{},legacy=saved.operator?saved:null;for(const bound of ['min','max']){const condition=saved[bound]||(bound==='min'?legacy:null)||{};document.querySelector(`[data-range-field="${field}"][data-range-bound="${bound}"][data-range-part="operator"]`).value=condition.operator||(bound==='min'?'gte':'lte');document.querySelector(`[data-range-field="${field}"][data-range-bound="${bound}"][data-range-part="value"]`).value=condition.value||''}}}
function effectiveQueryLimit(){const requested=Math.max(1,Number($('#limit').value)||100);return Math.min(requested,state.records.length)}
const fullQueryCheckbox=fullQuery.querySelector('input');
$('#limit').onchange=()=>{const value=Math.max(1,Number($('#limit').value)||100);$('#limit').value=value;$('#filterInfo').textContent=`최대 ${value.toLocaleString()}개까지 소싱판별을 실행합니다.`};
fullQueryCheckbox.onchange=event=>{$('#limit').disabled=event.target.checked;toast(event.target.checked?'전체 조회를 선택했습니다. 추출된 전체 키워드를 판별합니다.':`최대 ${$('#limit').value}개까지만 소싱판별을 실행합니다.`)};
$('#runButton').onclick=async()=>{const list=fullQueryCheckbox.checked?state.records:state.records.slice(0,effectiveQueryLimit());if(!list.length){toast('먼저 전체 키워드를 추출해 주세요.');return}state.results=[];state.cancelled=false;state.controller=new AbortController();render();$('#runButton').disabled=true;$('#stopButton').disabled=false;$('#progressBox').classList.remove('hidden');for(let i=0;i<list.length&&!state.cancelled;i+=2){const chunk=await Promise.all(list.slice(i,i+2).map(judge));if(state.cancelled)break;state.results.push(...chunk);render();const processed=Math.min(i+2,list.length);$('#progressLabel').textContent='소싱 판별 조회 중';$('#progressCount').textContent=`${processed} / ${list.length}`;$('#progressBar').style.width=`${processed/list.length*100}%`;if(processed<list.length)await new Promise(resolve=>setTimeout(resolve,350))}$('#progressLabel').textContent=state.cancelled?'소싱 판별 중단됨':'소싱 판별 완료';$('#runButton').disabled=false;$('#stopButton').disabled=true;toast(state.cancelled?`${state.results.length}개 결과까지만 저장했습니다.`:`${state.results.length}개 키워드의 판별이 완료되었습니다.`)};

// 로컬 통합 화면은 설치된 윙렌즈 확장프로그램에 필요한 조회만 요청합니다.
// 쿠팡·쿠팡윙 로그인 정보는 이 페이지로 전달되거나 저장되지 않습니다.
const WING_LENS_EXTENSION_ID='akacdnjhcbnmeglmlpemcdpbblmdgkai';
const wingSearchForm=$('#wingSearchForm'),wingKeywordInput=$('#wingKeywordInput'),wingRangeButton=$('#wingRangeButton'),wingRangeModal=$('#wingRangeModal'),wingRangeClose=$('#wingRangeClose'),wingRangeApply=$('#wingRangeApply'),wingRangeStartOptions=$('#wingRangeStartOptions'),wingRangeEndOptions=$('#wingRangeEndOptions'),wingRunButton=$('#wingRunButton'),wingStopButton=$('#wingStopButton'),wingLedgerStopButton=$('#wingLedgerStopButton'),wingConnection=$('#wingConnection'),wingStatus=$('#wingStatus'),wingResultTitle=$('#wingResultTitle'),wingEmpty=$('#wingEmpty'),wingTableBox=$('#wingTableBox'),wingExportButton=$('#wingExportButton'),wingResultBody=$('#wingResultBody'),wingSummary=$('#wingSummary'),wingReviewPanel=$('#wingReviewPanel');
let wingRunToken=0;
const wingRangeStorageKey='wing-lens-analysis-range-v1';
function readWingRange(){try{const saved=JSON.parse(localStorage.getItem(wingRangeStorageKey)||'{}'),startPage=Number(saved.startPage),endPage=Number(saved.endPage);if(Number.isInteger(startPage)&&Number.isInteger(endPage)&&startPage>=1&&startPage<=8&&endPage>=startPage&&endPage<=8)return{startPage,endPage}}catch{}return{startPage:1,endPage:1}}
function saveWingRange(){localStorage.setItem(wingRangeStorageKey,JSON.stringify({startPage:wingStartPage,endPage:wingEndPage}))}
const savedWingRange=readWingRange();
let wingStartPage=savedWingRange.startPage,wingEndPage=savedWingRange.endPage;
const wingDeliveryDefaultKey='wing-lens-delivery-filter-v1';
const wingReviewFilterKey='wing-lens-review-filter-v1';
const wingDeliveryFilter=document.createElement('fieldset');
wingDeliveryFilter.className='wing-delivery-filter';
wingDeliveryFilter.innerHTML='<legend>배송유형 조회</legend><label><input id="wingDeliveryAll" type="checkbox"> 전체</label><label><input type="checkbox" name="wingDeliveryType" value="해외"> 해외</label><label><input type="checkbox" name="wingDeliveryType" value="로켓"> 로켓</label><label><input type="checkbox" name="wingDeliveryType" value="설치"> 설치</label><label><input type="checkbox" name="wingDeliveryType" value="국내"> 국내</label><button id="wingDeliveryDefaultSave" class="outline" type="button">설정저장</button>';
const wingReviewFilter=document.createElement('fieldset');
wingReviewFilter.className='wing-review-filter';
wingReviewFilter.innerHTML='<legend>리뷰수 조회</legend><div><select id="wingReviewOperator" aria-label="리뷰수 조건"><option value="gte">이상</option><option value="lte">이하</option></select><input id="wingReviewValue" type="number" min="0" step="1" inputmode="numeric" placeholder="숫자" aria-label="리뷰수"></div>';
wingRunButton.before(wingDeliveryFilter,wingReviewFilter);
const wingDeliveryAll=$('#wingDeliveryAll'),wingDeliveryTypes=[...document.querySelectorAll('input[name="wingDeliveryType"]')];
function readWingDeliverySetting(){try{const saved=JSON.parse(localStorage.getItem(wingDeliveryDefaultKey)||'null');return saved&&Array.isArray(saved.types)?saved:{all:true,types:[]}}catch{return{all:true,types:[]}}}
function selectedWingDeliveryTypes(){return wingDeliveryAll.checked?[]:wingDeliveryTypes.filter(input=>input.checked).map(input=>input.value)}
function applyWingDeliverySetting(setting){const types=new Set(setting?.types||[]);wingDeliveryAll.checked=setting?.all!==false||!types.size;wingDeliveryTypes.forEach(input=>input.checked=!wingDeliveryAll.checked&&types.has(input.value))}
function normalizeWingDeliveryType(method){const value=String(method||'');return value.includes('해외')?'해외':value.includes('로켓')?'로켓':value.includes('설치')?'설치':'국내'}
applyWingDeliverySetting(readWingDeliverySetting());
wingDeliveryAll.onchange=()=>{if(wingDeliveryAll.checked)wingDeliveryTypes.forEach(input=>input.checked=false)};
wingDeliveryTypes.forEach(input=>input.onchange=()=>{if(input.checked)wingDeliveryAll.checked=false;if(!wingDeliveryTypes.some(item=>item.checked))wingDeliveryAll.checked=true});
$('#wingDeliveryDefaultSave').onclick=()=>{const setting={all:wingDeliveryAll.checked,types:selectedWingDeliveryTypes()};localStorage.setItem(wingDeliveryDefaultKey,JSON.stringify(setting));toast(`배송유형 기본값을 ${setting.all?'전체':setting.types.join(' · ')}로 저장했습니다.`)};
const wingReviewOperator=$('#wingReviewOperator'),wingReviewValue=$('#wingReviewValue');
function readWingReviewFilter(){try{const saved=JSON.parse(localStorage.getItem(wingReviewFilterKey)||'null');return saved&&['gte','lte'].includes(saved.operator)?saved:{operator:'gte',value:''}}catch{return{operator:'gte',value:''}}}
function selectedWingReviewFilter(){const value=Number(wingReviewValue.value);return Number.isFinite(value)&&value>=0?{operator:wingReviewOperator.value,value}:null}
function matchesWingReviewFilter(product){const filter=selectedWingReviewFilter();if(!filter)return true;const reviewCount=Number(product?.reviewCount);if(!Number.isFinite(reviewCount))return false;return filter.operator==='lte'?reviewCount<=filter.value:reviewCount>=filter.value}
const savedWingReviewFilter=readWingReviewFilter();wingReviewOperator.value=savedWingReviewFilter.operator;wingReviewValue.value=savedWingReviewFilter.value??'';
function saveWingFilters(){const deliverySetting={all:wingDeliveryAll.checked,types:selectedWingDeliveryTypes()},reviewFilter=selectedWingReviewFilter()||{operator:wingReviewOperator.value,value:''};localStorage.setItem(wingDeliveryDefaultKey,JSON.stringify(deliverySetting));localStorage.setItem(wingReviewFilterKey,JSON.stringify(reviewFilter));toast(`배송유형 기본값과 리뷰수 조건을 저장했습니다.`)}
$('#wingDeliveryDefaultSave').onclick=saveWingFilters;
const wingMessage=payload=>new Promise(resolve=>{if(!window.chrome?.runtime?.sendMessage){resolve({ok:false,error:'윙렌즈 확장프로그램을 찾지 못했습니다.'});return}try{window.chrome.runtime.sendMessage(WING_LENS_EXTENSION_ID,payload,response=>{const error=window.chrome.runtime.lastError;resolve(error?{ok:false,error:error.message||'윙렌즈 확장프로그램 연결에 실패했습니다.'}:response||{ok:false,error:'윙렌즈 응답이 없습니다.'})})}catch(error){resolve({ok:false,error:error.message||'윙렌즈 확장프로그램 연결에 실패했습니다.'})}});
const wingNumber=value=>Number(value||0).toLocaleString('ko-KR');
const wingManwon=value=>Number(value||0).toLocaleString('ko-KR',{maximumFractionDigits:1});
const wingRevenue=(sales,price)=>sales&&price?wingNumber(Math.round(Number(sales)*Number(price)/10000)):'-';
const wingConversion=(sales,pv)=>pv?`${(Number(sales)/Number(pv)*100).toFixed(1)}%`:'-';
const wingAccessError=value=>/접근.*차단|captcha|자동화|too many|HTTP\s*(403|429)|요청.*제한/i.test(String(value||''));
function wingSetResultView({title,stateMessage,hasTable=false,emptyTitle='아직 분석한 상품이 없습니다.',emptyDescription='위 검색창에서 첫 키워드를 입력해 보세요.'}){if(title)wingResultTitle.textContent=title;if(stateMessage)wingStatus.textContent=stateMessage;wingEmpty.hidden=hasTable;wingTableBox.hidden=!hasTable;if(!hasTable){wingEmpty.querySelector('strong').textContent=emptyTitle;wingEmpty.querySelector('small').textContent=emptyDescription}}
function wingRenderEmpty(message){wingResultBody.innerHTML='';wingSetResultView({title:'상품 수집 실패',stateMessage:message,emptyTitle:'쿠팡 검색 결과를 읽지 못했습니다.',emptyDescription:'쿠팡 로그인 상태와 접근 제한 여부를 확인한 뒤 다시 시도해 주세요.'})}
function wingRenderRows(products){wingReviewPanel.hidden=true;wingResultBody.innerHTML=products.map((product,index)=>{const productUrl=/^https?:\/\//i.test(String(product.url||''))?String(product.url):'',imageUrl=/^https?:\/\//i.test(String(product.image||''))?String(product.image):'';const productName=clean(product.name||'-'),reviewCount=Number(product.reviewCount)||0;const productText=productUrl?`<a href="${clean(productUrl)}" target="_blank" rel="noopener noreferrer" title="쿠팡 상품 페이지 열기">${productName}</a>`:productName;return `<tr data-wing-index="${index}" data-wing-rank="${index+1}" data-wing-name="${productName}" data-wing-url="${clean(productUrl)}" data-wing-product-id="${clean(product.productId||'')}" data-wing-review-count="${reviewCount}"><td>${index+1}</td><td class="wing-product"><div class="wing-product-inner"><div class="wing-product-name">${productText}</div>${imageUrl?`<img src="${clean(imageUrl)}" alt="" loading="lazy">`:'<span class="wing-product-placeholder">상품</span>'}</div></td><td>${product.price?wingManwon(Number(product.price)/10000):'-'}</td><td><div class="wing-review-cell"><span>${wingNumber(reviewCount)}</span><button type="button" class="wing-review-button" ${reviewCount?'':'disabled'}>리뷰 분석</button></div></td><td>-</td><td>대기</td><td>대기</td><td>대기</td><td>대기</td></tr>`}).join('');wingSetResultView({hasTable:true});updateWingSummary()}
function wingMetricNumber(text){const value=Number(String(text||'').replace(/[^0-9.-]/g,''));return Number.isFinite(value)?value:null}
function wingStats(values,decimal=false){const usable=values.filter(value=>Number.isFinite(value));if(!usable.length)return '-';const min=Math.min(...usable),max=Math.max(...usable),average=usable.reduce((sum,value)=>sum+value,0)/usable.length,format=value=>decimal?wingManwon(value):wingNumber(Math.round(value));return `<span class="wing-stat-high">최고 ${format(max)}</span> · <span class="wing-stat-low">최저 ${format(min)}</span> · 평균 ${format(average)}`}
function updateWingSummary(){const rows=[...wingResultBody.querySelectorAll('tr[data-wing-index]')];if(!rows.length){wingSummary.hidden=true;return}const prices=rows.map(row=>wingMetricNumber(row.children[2]?.textContent)),reviews=rows.map(row=>wingMetricNumber(row.children[3]?.querySelector('span')?.textContent));const delivery={해외:0,로켓:0,설치:0,국내:0};rows.forEach(row=>{const method=row.children[4]?.textContent.trim()||'';if(method.includes('해외'))delivery.해외++;else if(method.includes('로켓'))delivery.로켓++;else if(method.includes('설치'))delivery.설치++;else if(method&&method!=='-')delivery.국내++});const deliveryTotal=Object.values(delivery).reduce((sum,value)=>sum+value,0),share=key=>deliveryTotal?Math.round(delivery[key]/deliveryTotal*100):0,overseasEnd=share('해외'),rocketEnd=overseasEnd+share('로켓'),installEnd=rocketEnd+share('설치');const pie=`conic-gradient(#f28f3b 0 ${overseasEnd}%,#2476df ${overseasEnd}% ${rocketEnd}%,#7958c8 ${rocketEnd}% ${installEnd}%,#7d91a8 ${installEnd}% 100%)`;const overseasSales=rows.filter(row=>(row.children[4]?.textContent||'').includes('해외')).map(row=>wingMetricNumber(row.children[7]?.textContent));wingSummary.innerHTML=`<article><b>가격(단위:만원)</b><strong>${wingStats(prices,true)}</strong></article><article><b>리뷰수</b><strong>${wingStats(reviews)}</strong></article><article class="wing-delivery-summary"><b>배송</b><div><i style="background:${pie}"></i><span>해외 ${delivery.해외}건 ${share('해외')}%<br>로켓 ${delivery.로켓}건 ${share('로켓')}%<br>설치 ${delivery.설치}건 ${share('설치')}%<br>국내 ${delivery.국내}건 ${share('국내')}%</span></div></article><article><b>해외 배송판매상품 월매출(단위:만원)</b><strong>${wingStats(overseasSales,true)}</strong></article>`;wingSummary.hidden=false}
async function analyzeWingReviews(button){const row=button.closest('tr');if(!row)return;const productUrl=row.dataset.wingUrl,productId=row.dataset.wingProductId,reviewCount=Number(row.dataset.wingReviewCount)||0;if(!productUrl||!productId||!reviewCount){toast('리뷰 분석에 필요한 상품 정보를 찾지 못했습니다.');return}button.disabled=true;button.textContent='분석 중';wingReviewPanel.hidden=false;wingReviewPanel.textContent='윙렌즈가 공개 리뷰를 수집하고 있습니다. 잠시 기다려 주세요.';const result=await wingMessage({kind:'WL_EXTERNAL_REVIEWS',productUrl,productId,reviewCount});button.disabled=false;button.textContent='리뷰 분석';if(!result?.ok||!Array.isArray(result.reviews)){wingReviewPanel.textContent=result?.error||'공개 리뷰를 수집하지 못했습니다. 쿠팡 상품 페이지 접속 상태를 확인한 뒤 다시 시도해 주세요.';return}const reviews=result.reviews,ratings=reviews.map(review=>Number(review.rating)).filter(Number.isFinite),average=ratings.length?(ratings.reduce((sum,value)=>sum+value,0)/ratings.length).toFixed(1):'-',fiveStars=ratings.filter(value=>value===5).length;wingReviewPanel.innerHTML=`<strong>${clean(row.dataset.wingName||'상품')} · 리뷰 분석 완료</strong><span>공개 리뷰 ${reviews.length.toLocaleString()}건 · 평균 평점 ${average}점 · 5점 리뷰 ${fiveStars.toLocaleString()}건</span>`}
wingResultBody.addEventListener('click',event=>{const button=event.target.closest('.wing-review-button');if(button)analyzeWingReviews(button)});
function wingExportResults(){const rows=[...wingResultBody.querySelectorAll('tr[data-wing-index]')];if(!rows.length)return;const headers=['순위','상품명','가격(단위:만원)','리뷰수','배송','최근 28일 클릭수','최근 28일 판매량','월매출(단위:만원)','전환율'];const data=rows.map(row=>Object.fromEntries(headers.map((header,index)=>[header,row.children[index]?.textContent.trim()||'-'])));const sheet=XLSX.utils.json_to_sheet(data,{header:headers});const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,sheet,'판매지표 분석');XLSX.writeFile(book,`쿠팡판매지표_${new Date().toISOString().slice(0,10)}.xlsx`)}
function renderWingRangeOptions(){wingRangeStartOptions.innerHTML='';wingRangeEndOptions.innerHTML='';for(let page=1;page<=8;page++){const start=document.createElement('button');start.type='button';start.textContent=`${page}페이지`;start.className=page===wingStartPage?'selected':'';start.onclick=()=>{wingStartPage=page;if(wingEndPage<page)wingEndPage=page;renderWingRangeOptions()};const end=document.createElement('button');end.type='button';end.textContent=`${page}페이지`;end.className=page===wingEndPage?'selected':'';end.onclick=()=>{wingEndPage=Math.max(page,wingStartPage);renderWingRangeOptions()};wingRangeStartOptions.append(start);wingRangeEndOptions.append(end)}}
function updateWingRangeButton(){wingRangeButton.textContent=`${wingStartPage}페이지 ~ ${wingEndPage}페이지`}
async function checkWingConnection(){const result=await wingMessage({kind:'WL_EXTERNAL_STATUS'});if(result?.loggedIn){wingConnection.textContent='윙렌즈 연결됨 · 쿠팡윙 로그인 확인';wingConnection.className='connected';wingStatus.textContent='검색어를 입력하면 이 화면에서 판매지표를 조회합니다.';return true}wingConnection.textContent='윙렌즈 로그인 필요';wingConnection.className='problem';wingStatus.textContent=result?.error||'윙렌즈 확장프로그램을 설치하고 시크릿 쿠팡윙 로그인을 완료해 주세요.';return false}
async function runWingMetrics(products,token){const selectedTypes=selectedWingDeliveryTypes(),reviewFilter=selectedWingReviewFilter(),filterDescription=selectedTypes.length?selectedTypes.join(' · '):'전체';for(let index=0;index<products.length;index++){if(token!==wingRunToken)return;const product=products[index],row=wingResultBody.querySelector(`[data-wing-index="${index}"]`);if(!matchesWingReviewFilter(product)){const label=reviewFilter?`리뷰 ${reviewFilter.operator==='gte'?'이상':'이하'} ${wingNumber(reviewFilter.value)}건 제외`:'리뷰 조건 제외';row.children[4].textContent='리뷰 조건 제외';row.children[5].textContent=label;row.children[6].textContent='-';row.children[7].textContent='-';row.children[8].textContent='-';wingStatus.textContent=`${index+1} / ${products.length} · ${label} · 상세 조회 없이 다음 상품으로 이동합니다.`;updateWingSummary();continue}wingStatus.textContent=`${index+1} / ${products.length} · 배송유형 확인 후 ${filterDescription} 판매지표를 조회 중입니다.`;const shipping=await wingMessage({kind:'WL_EXTERNAL_SHIPPING',productUrl:product.url});if(token!==wingRunToken)return;if(wingAccessError(shipping?.error)){wingStatus.textContent='쿠팡 접근 제한이 감지되어 조회를 중단했습니다. 쿠팡에 재로그인한 뒤 최소 90초 후 다시 시도해 주세요.';toast('쿠팡 접근 제한으로 윙렌즈 조회를 중단했습니다.');return}const deliveryCell=row.children[4],deliveryMethod=shipping?.ok?shipping.shippingMethod||'-':'-',deliveryType=normalizeWingDeliveryType(deliveryMethod);deliveryCell.textContent=deliveryMethod;deliveryCell.classList.toggle('wing-delivery-overseas',deliveryType==='해외');deliveryCell.classList.toggle('wing-delivery-rocket',deliveryType==='로켓');if(selectedTypes.length&&!selectedTypes.includes(deliveryType)){row.children[5].textContent='유형 제외';row.children[6].textContent='-';row.children[7].textContent='-';row.children[8].textContent='-';updateWingSummary();if(index<products.length-1)await new Promise(resolve=>setTimeout(resolve,10000));continue}const metric=await wingMessage({kind:'WL_EXTERNAL_METRIC',productId:product.productId});if(token!==wingRunToken)return;if(wingAccessError(metric?.error)){wingStatus.textContent='쿠팡 접근 제한이 감지되어 조회를 중단했습니다. 쿠팡에 재로그인한 뒤 최소 90초 후 다시 시도해 주세요.';toast('쿠팡 접근 제한으로 윙렌즈 조회를 중단했습니다.');return}const item=metric?.item;row.children[5].textContent=item?wingNumber(item.pvLast28Day):'조회 실패';row.children[6].textContent=item?wingNumber(item.salesLast28d):'-';row.children[7].textContent=item?wingRevenue(item.salesLast28d,item.salePrice||shipping?.price):'-';row.children[8].textContent=item?wingConversion(item.salesLast28d,item.pvLast28Day):'-';updateWingSummary();if(index<products.length-1)await new Promise(resolve=>setTimeout(resolve,10000))}if(token===wingRunToken)wingStatus.textContent=`${products.length}개 상품의 ${filterDescription} 판매지표 조회가 완료되었습니다.`}
function stopWingMetrics(){wingRunToken++;if(typeof metricReservationRunning!=='undefined'&&metricReservationRunning){metricReservationCancelled=true;metricReservationJobs.forEach(job=>{if(job.status==='대기'||job.status==='조회중'){job.status='중단';job.stopRequested=true}});metricQueueStatus.textContent='판매지표분석 예약 리스트 전체 중단 요청됨';$('#metricQueueCancel').disabled=true;renderWingQueueDashboard();toast('판매지표분석 예약 리스트의 전체 작업을 중단했습니다.')}else{wingStatus.textContent='윙렌즈 조회를 중단했습니다.'}wingRunButton.disabled=false;wingStopButton.disabled=true;wingLedgerStopButton.disabled=true}
wingSearchForm.onsubmit=async event=>{event.preventDefault();const keyword=wingKeywordInput.value.trim();if(!keyword)return;wingRunButton.disabled=true;wingStopButton.disabled=false;wingLedgerStopButton.disabled=false;wingExportButton.disabled=true;const token=++wingRunToken;wingSetResultView({title:`“${keyword}” · ${wingStartPage}~${wingEndPage}페이지 상품 수집 중`,stateMessage:`쿠팡 검색 결과 ${wingStartPage}~${wingEndPage}페이지 확인 중`});const connected=await checkWingConnection();if(!connected){wingRunButton.disabled=false;wingStopButton.disabled=true;wingLedgerStopButton.disabled=true;return}wingStatus.textContent='쿠팡 검색 결과를 준비 중입니다.';const search=await wingMessage({kind:'WL_EXTERNAL_SEARCH',keyword,startPage:wingStartPage,endPage:wingEndPage});if(token!==wingRunToken)return;if(!search?.ok||!search.products?.length){wingRenderEmpty(search?.error||'검색 결과가 없습니다.');wingRunButton.disabled=false;wingStopButton.disabled=true;wingLedgerStopButton.disabled=true;return}const products=search.products;wingRenderRows(products);wingResultTitle.textContent=`“${keyword}” · ${products.length}개 상품 분석 중`;wingExportButton.disabled=false;await runWingMetrics(products,token);if(token===wingRunToken){wingResultTitle.textContent=`“${keyword}” · 판매지표 분석 완료`;wingRunButton.disabled=false;wingStopButton.disabled=true;wingLedgerStopButton.disabled=true}};
wingStopButton.onclick=stopWingMetrics;wingLedgerStopButton.onclick=stopWingMetrics;wingExportButton.onclick=wingExportResults;
wingRangeButton.onclick=()=>{renderWingRangeOptions();wingRangeModal.hidden=false};
wingRangeClose.onclick=()=>wingRangeModal.hidden=true;
wingRangeModal.onclick=event=>{if(event.target===wingRangeModal)wingRangeModal.hidden=true};
wingRangeApply.onclick=()=>{saveWingRange();updateWingRangeButton();wingRangeModal.hidden=true};
// 판별결과의 행 또는 체크박스를 누르는 것만으로는 판매지표 분석 키워드를 변경하지 않습니다.
function initializeWingLens(){updateWingRangeButton();checkWingConnection().catch(()=>{wingConnection.textContent='윙렌즈 연결 확인 실패';wingConnection.className='problem';wingStatus.textContent='윙렌즈 확장프로그램 상태를 다시 확인해 주세요.'})}
$('#wingLensWorkspace .footnote').textContent='* 선택한 쿠팡 분석 페이지 범위의 모든 검색 결과를 10초 간격으로 순차 조회합니다. 접근 제한이 감지되면 즉시 멈추고 30분 후 실패한 상품부터 자동으로 다시 시도합니다.';
window.addEventListener('load',()=>setTimeout(initializeWingLens,250));
const wingPackageTools=document.createElement('div');
wingPackageTools.className='wing-package-tools';
wingPackageTools.innerHTML='<button type="button" id="wingWingLogin">쿠팡로그인</button><button type="button" id="wingWingLogout" class="outline">쿠팡로그아웃</button><a href="wing-lens-extension.zip" download>윙렌즈 다운로드</a><button type="button" id="wingPackageUpload">파일 업로드</button><input id="wingPackageFile" type="file" accept=".zip,application/zip" hidden>';
wingConnection.after(wingPackageTools);
const wingConnectionTools=document.createElement('div');
wingConnectionTools.className='wing-connection-tools';
wingConnection.before(wingConnectionTools);
wingConnectionTools.append(wingConnection,wingPackageTools);
const wingPackageFile=$('#wingPackageFile');
const wingLoginCheckButton=document.createElement('button');
wingLoginCheckButton.id='wingLoginCheck';
wingLoginCheckButton.type='button';
wingLoginCheckButton.textContent='로그인 완료 확인';
wingLoginCheckButton.className='outline';
$('#wingWingLogin').after(wingLoginCheckButton);
async function checkWingLoginOnce(){
  wingLoginCheckButton.disabled=true;
  wingStatus.textContent='쿠팡윙 로그인 상태를 한 번 확인 중입니다…';
  try{
    const connected=await checkWingConnection();
    if(connected)toast('쿠팡윙 로그인 확인 완료 · 윙렌즈가 연결되었습니다.');
    return connected;
  }finally{
    wingLoginCheckButton.disabled=false;
  }
}
async function openWingLoginWindow(){const result=await wingMessage({kind:'WL_EXTERNAL_OPEN_WING_LOGIN'});if(result?.ok){wingStatus.textContent='시크릿 창에서 쿠팡윙 로그인을 완료한 뒤 “로그인 완료 확인”을 한 번 눌러 주세요.';toast('시크릿 창에 쿠팡윙 로그인 화면을 열었습니다.');return true}toast(result?.error||'쿠팡윙 로그인 창을 열지 못했습니다.');return false}
$('#wingWingLogin').onclick=()=>openWingLoginWindow();
$('#wingWingLogout').onclick=async()=>{if(!confirm('시크릿 쿠팡윙 탭을 닫아 로그아웃할까요?\n일반 쿠팡 탭과 다른 시크릿 탭은 닫지 않습니다.'))return;const button=$('#wingWingLogout');button.disabled=true;try{const result=await wingMessage({kind:'WL_EXTERNAL_CLOSE_WING_SESSION'});if(!result?.ok)throw new Error(result?.error||'쿠팡로그아웃을 실행하지 못했습니다.');wingConnection.textContent='윙렌즈 로그인 필요';wingConnection.className='problem';wingStatus.textContent=result.closed?`시크릿 쿠팡윙 탭 ${result.closed}개를 닫았습니다. 다시 조회하려면 쿠팡로그인을 눌러 주세요.`:'열려 있는 시크릿 쿠팡윙 탭이 없습니다.';toast(result.closed?'쿠팡윙 로그아웃 처리가 완료되었습니다.':'로그아웃할 쿠팡윙 탭이 없습니다.')}catch(error){toast(error.message||'쿠팡로그아웃을 실행하지 못했습니다. 확장프로그램을 새로고침해 주세요.')}finally{button.disabled=false}};
wingLoginCheckButton.onclick=()=>checkWingLoginOnce();
$('#wingPackageUpload').onclick=()=>{const password=prompt('윙렌즈 파일 업로드 비밀번호를 입력해 주세요.');if(password===null)return;wingPackageFile.dataset.password=password;wingPackageFile.click()};
wingPackageFile.onchange=async()=>{const file=wingPackageFile.files?.[0],password=wingPackageFile.dataset.password||'';delete wingPackageFile.dataset.password;if(!file)return;if(!/\.zip$/i.test(file.name)){toast('윙렌즈 ZIP 파일만 올릴 수 있습니다.');wingPackageFile.value='';return}try{const response=await fetch('/api/wing-lens-package',{method:'POST',headers:{'x-wing-upload-password':password},body:await file.arrayBuffer()});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.message||'파일을 올리지 못했습니다.');toast(data.message||'윙렌즈 다운로드 파일을 교체했습니다.')}catch(error){toast(error.message||'파일을 올리지 못했습니다.')}finally{wingPackageFile.value=''}};

// 소싱 판별 결과는 이 브라우저에만 저장합니다. 최대 20개의 목록을 유지합니다.
const savedResultKey='sourcing-judge-saved-results-v1';
const savedResultBar=document.createElement('div');
savedResultBar.className='saved-result-bar';
savedResultBar.innerHTML='<strong>저장한 판별 결과</strong><select id="savedResultSelect" aria-label="저장한 판별 결과 목록"></select><input id="savedResultName" maxlength="30" placeholder="목록명 입력"><button id="savedResultSave" type="button" class="outline">현재 결과 저장</button><button id="savedResultLoad" type="button" class="outline">불러오기</button><button id="savedResultSelectAll" type="button" class="outline">목록 전체선택</button><button id="savedResultDeleteSelected" type="button" class="stop">선택 목록 삭제</button><button id="savedResultDeleteAll" type="button" class="stop">전체 삭제</button><small id="savedResultInfo"></small>';
$('.results .section-title').after(savedResultBar);
const savedResultChecklist=document.createElement('div');
savedResultChecklist.id='savedResultChecklist';
savedResultChecklist.className='saved-result-checklist';
savedResultBar.after(savedResultChecklist);
const savedResultSelect=$('#savedResultSelect'),savedResultName=$('#savedResultName'),savedResultInfo=$('#savedResultInfo'),savedResultSelection=new Set();
function readSavedResults(){try{const value=JSON.parse(localStorage.getItem(savedResultKey)||'[]');return Array.isArray(value)?value:[]}catch{return[]}}
function writeSavedResults(items){localStorage.setItem(savedResultKey,JSON.stringify(items))}
function formatSavedResultTime(value){try{return new Intl.DateTimeFormat('ko-KR',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(value))}catch{return ''}}
function renderSavedResults(selectedId=''){const items=readSavedResults(),ids=new Set(items.map(item=>item.id));[...savedResultSelection].forEach(id=>{if(!ids.has(id))savedResultSelection.delete(id)});const allSelected=items.length>0&&items.every(item=>savedResultSelection.has(item.id));savedResultSelect.innerHTML=items.length?items.map(item=>`<option value="${clean(item.id)}">${clean(item.name)} · ${Number(item.rows?.length||0).toLocaleString()}건 · ${formatSavedResultTime(item.createdAt)}</option>`).join(''):'<option value="">저장된 결과 없음</option>';savedResultChecklist.innerHTML=items.map(item=>`<label><input class="saved-result-check" type="checkbox" value="${clean(item.id)}" ${savedResultSelection.has(item.id)?'checked':''}><span><b>${clean(item.name)}</b><small>${Number(item.rows?.length||0).toLocaleString()}건 · ${formatSavedResultTime(item.createdAt)}</small></span></label>`).join('');savedResultSelect.disabled=!items.length;$('#savedResultLoad').disabled=!items.length;$('#savedResultSelectAll').disabled=!items.length;$('#savedResultSelectAll').textContent=allSelected?'전체선택 해제':'목록 전체선택';$('#savedResultDeleteSelected').disabled=!savedResultSelection.size;$('#savedResultDeleteAll').disabled=!items.length;if(selectedId&&items.some(item=>item.id===selectedId))savedResultSelect.value=selectedId;savedResultInfo.textContent=`${items.length} / 20개 저장됨`}
$('#savedResultSave').onclick=()=>{const name=savedResultName.value.trim();if(!name){toast('저장할 목록명을 입력해 주세요.');savedResultName.focus();return}if(!state.results.length){toast('저장할 소싱판별 결과가 없습니다.');return}const items=readSavedResults();if(items.length>=20){toast('저장 목록은 최대 20개입니다. 기존 목록을 삭제한 뒤 저장해 주세요.');return}const id=crypto.randomUUID();try{items.unshift({id,name,createdAt:new Date().toISOString(),rows:state.results.map(row=>({...row}))});writeSavedResults(items);renderSavedResults(id);savedResultName.value='';toast(`“${name}” 목록으로 ${state.results.length.toLocaleString()}개 결과를 저장했습니다.`)}catch(error){toast('저장 공간이 부족해 결과를 저장하지 못했습니다.')}};
$('#savedResultLoad').onclick=()=>{const item=readSavedResults().find(result=>result.id===savedResultSelect.value);if(!item)return;state.results=Array.isArray(item.rows)?item.rows.map(row=>({...row})):[];passOnly.querySelector('input').checked=false;render();$('#progressBox').classList.add('hidden');toast(`“${item.name}” 결과 ${state.results.length.toLocaleString()}개를 불러왔습니다.`)};
savedResultChecklist.addEventListener('change',event=>{const checkbox=event.target.closest('.saved-result-check');if(!checkbox)return;checkbox.checked?savedResultSelection.add(checkbox.value):savedResultSelection.delete(checkbox.value);renderSavedResults()});
$('#savedResultSelectAll').onclick=()=>{const items=readSavedResults(),allSelected=items.length>0&&items.every(item=>savedResultSelection.has(item.id));items.forEach(item=>allSelected?savedResultSelection.delete(item.id):savedResultSelection.add(item.id));renderSavedResults()};
$('#savedResultDeleteSelected').onclick=async()=>{if(!savedResultSelection.size){toast('삭제할 저장 목록을 선택해 주세요.');return}if(!await showAppConfirm(`선택한 ${savedResultSelection.size}개 판별결과 목록을 삭제할까요?`))return;writeSavedResults(readSavedResults().filter(item=>!savedResultSelection.has(item.id)));const count=savedResultSelection.size;savedResultSelection.clear();renderSavedResults();toast(`${count}개 저장 목록을 삭제했습니다.`)};
$('#savedResultDeleteAll').onclick=async()=>{const count=readSavedResults().length;if(!count)return;if(!await showAppConfirm(`저장한 판별결과 목록 ${count}개를 모두 삭제할까요?`))return;writeSavedResults([]);savedResultSelection.clear();renderSavedResults();toast('저장한 판별결과 목록을 모두 삭제했습니다.')};
savedResultSelect.onchange=()=>{const item=readSavedResults().find(result=>result.id===savedResultSelect.value);savedResultName.value=item?.name||''};
renderSavedResults();
const wingModalVisibilityStyle=document.createElement('style');wingModalVisibilityStyle.textContent='.wing-range-modal[hidden]{display:none!important}';document.head.append(wingModalVisibilityStyle);

// 03번 소싱판별은 필터링으로 준비된 전체 키워드를 항상 조회합니다.
// 이전 버전의 조회 건수/전체 조회 선택 UI는 호환성을 위해 내부 값만 남기고 화면에서는 제거합니다.
fullQuery.remove();
$('#queryLimitControl').hidden=true;
$('#limit').value=0;
$('#runButton').onclick=async()=>{const list=state.records;if(!list.length){toast('먼저 전체 키워드를 추출해 주세요.');return}state.results=[];state.cancelled=false;state.controller=new AbortController();render();$('#runButton').disabled=true;$('#stopButton').disabled=false;$('#progressBox').classList.remove('hidden');for(let index=0;index<list.length&&!state.cancelled;index+=2){const chunk=await Promise.all(list.slice(index,index+2).map(judge));if(state.cancelled)break;state.results.push(...chunk);render();const processed=Math.min(index+2,list.length);$('#progressLabel').textContent='소싱 판별 조회 중';$('#progressCount').textContent=`${processed} / ${list.length}`;$('#progressBar').style.width=`${processed/list.length*100}%`;if(processed<list.length)await new Promise(resolve=>setTimeout(resolve,350))}$('#progressLabel').textContent=state.cancelled?'소싱 판별 중단됨':'소싱 판별 완료';$('#runButton').disabled=false;$('#stopButton').disabled=true;toast(state.cancelled?`${state.results.length}개 결과까지만 저장했습니다.`:`${state.results.length}개 키워드의 판별이 완료되었습니다.`)};

// 결과 수, 통과 필터, 엑셀 다운로드를 서로 겹치지 않도록 정렬합니다.
const resultTitleBar=$('.results .section-title'),resultTitleBlock=resultTitleBar.firstElementChild;
resultTitleBlock.after(passOnly);
resultTitleBar.append($('#exportButton'));
const resultTitleLayoutStyle=document.createElement('style');
resultTitleLayoutStyle.textContent='.results .section-title{align-items:center;gap:14px}.results .section-title #passOnly{margin:0;color:#53657a;font-size:13px;font-weight:700;white-space:nowrap}.results .section-title #exportButton{margin-left:auto;white-space:nowrap}.results .section-title h2{display:flex;align-items:center;gap:8px}.results .section-title #resultCount{display:inline-grid;min-width:30px;height:30px;padding:0 8px;place-items:center;border-radius:99px;background:#edf4ff;color:#1967d9;font-size:18px;font-weight:800;line-height:1}';
document.head.append(resultTitleLayoutStyle);

// 쿠팡 판매지표 분석 표: 헤더 고정 및 필드별 오름차순/내림차순 정렬
function wingSortValue(row,column){if(column===0)return Number(row.dataset.wingRank||0);const text=row.children[column]?.textContent.trim()||'';if(column===1||column===4)return text;const number=Number(text.replace(/[^0-9.-]/g,''));return Number.isFinite(number)&&text!=='대기'?number:Number.NEGATIVE_INFINITY}
function sortWingTable(column,direction){const rows=[...wingResultBody.querySelectorAll('tr[data-wing-index]')];rows.sort((left,right)=>{const a=wingSortValue(left,column),b=wingSortValue(right,column);const result=typeof a==='string'?a.localeCompare(b,'ko'):a-b;return result*direction});rows.forEach((row,index)=>{row.children[0].textContent=String(index+1);wingResultBody.append(row)})}
function setupWingTableSorting(){document.querySelectorAll('.wing-table thead th').forEach((header,column)=>{const title=header.textContent.trim();header.replaceChildren();const label=document.createElement('span');label.className='wing-sort-label';label.textContent=title;const controls=document.createElement('span');controls.className='wing-sort-controls';[['▲',1,'오름차순'],['▼',-1,'내림차순']].forEach(([symbol,direction,description])=>{const button=document.createElement('button');button.type='button';button.className='wing-sort-button';button.textContent=symbol;button.setAttribute('aria-label',`${title} ${description} 정렬`);button.title=`${title} ${description} 정렬`;button.onclick=()=>sortWingTable(column,direction);controls.append(button)});header.append(label,controls)})}
setupWingTableSorting();
const wingTableHeaderStyle=document.createElement('style');
wingTableHeaderStyle.textContent='.wing-table thead th{position:sticky;top:0;z-index:8}.wing-sort-label{vertical-align:middle}.wing-sort-controls{display:inline-flex;flex-direction:column;gap:1px;margin-left:5px;vertical-align:middle}.wing-sort-button{width:14px;height:10px;min-height:0;padding:0;border:0;border-radius:2px;background:transparent;color:#91a1b4;font-size:8px;line-height:10px;cursor:pointer}.wing-sort-button:hover,.wing-sort-button:focus-visible{background:#e7f0fc;color:#1967d9;outline:0}.wing-table td.wing-product a{color:#102238;text-decoration:none}.wing-table td.wing-product a:hover,.wing-table td.wing-product a:focus-visible{color:#1967d9;text-decoration:underline;outline:0}';
document.head.append(wingTableHeaderStyle);
const wingInsightStyle=document.createElement('style');
wingInsightStyle.textContent='.wing-summary{display:grid;grid-template-columns:1fr 1fr 1.25fr 1.25fr;gap:1px;background:#dce5ef;border-bottom:1px solid #dce5ef}.wing-summary article{min-height:118px;padding:18px 20px;background:#fbfdff}.wing-summary article>b{display:block;margin-bottom:10px;color:#65778c;font-size:11px}.wing-summary article>strong{display:block;color:#182c43;font-size:13px;line-height:1.5}.wing-delivery-summary>div{display:flex;align-items:center;gap:10px;color:#52677e;font-size:11px;line-height:1.55}.wing-delivery-summary i{display:block;flex:0 0 58px;width:58px;height:58px;border-radius:50%;position:relative}.wing-delivery-summary i:after{content:"";position:absolute;inset:16px;border-radius:50%;background:#fbfdff}.wing-review-cell{display:grid;justify-items:center;gap:6px}.wing-review-button{min-height:0;padding:4px 7px;border:1px solid #bbd3f6;border-radius:4px;background:#fff;color:#1967d9;font-size:10px;font-weight:800;line-height:1.1}.wing-review-button:hover:not(:disabled){background:#edf4ff}.wing-review-button:disabled{opacity:.45;cursor:not-allowed}.wing-review-panel{padding:13px 22px;border-bottom:1px solid #dce5ef;background:#f2f8ff;color:#47627e;font-size:12px}.wing-review-panel strong{display:block;margin-bottom:4px;color:#173a61;font-size:13px}.wing-product-inner{display:flex;align-items:center;gap:12px;min-width:0}.wing-product-inner img,.wing-product-placeholder{order:2;flex:0 0 72px;width:72px;height:72px;border:1px solid #d5e0ec;border-radius:8px;background:#f5f8fb;object-fit:contain}.wing-product-placeholder{display:grid;place-items:center;color:#a3b0be;font-size:10px}.wing-product-name{order:1;flex:1;min-width:0;line-height:1.5;word-break:break-word;overflow-wrap:anywhere}.wing-product-name a{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden}@media(max-width:1000px){.wing-summary{grid-template-columns:1fr 1fr}.wing-summary article{min-height:104px}}@media(max-width:560px){.wing-summary{grid-template-columns:1fr}.wing-summary article{min-height:auto}}';
document.head.append(wingInsightStyle);

// 소싱판별 실행 제목 바로 뒤에 중단·실행 버튼을 배치합니다.
$('.run-copy').style.flex='0 0 auto';
$('.run').style.gap='14px';
const judgeRunToggle=document.createElement('button');
judgeRunToggle.type='button';judgeRunToggle.id='judgeRunToggle';judgeRunToggle.className='outline judge-run-toggle';
$('.run-copy').append(judgeRunToggle);
const setJudgeRunCollapsed=collapsed=>{const runCard=$('.run'),judgeResults=$('.results');runCard.classList.toggle('is-collapsed',collapsed);judgeResults.classList.toggle('is-collapsed',collapsed);judgeRunToggle.textContent=collapsed?'소싱판별 펼치기':'소싱판별 접기';judgeRunToggle.setAttribute('aria-expanded',String(!collapsed));window.sourcingJudgeCollapseState.set('judgeRun',collapsed)};
setJudgeRunCollapsed(window.sourcingJudgeCollapseState.get('judgeRun',false));
judgeRunToggle.onclick=()=>setJudgeRunCollapsed(!$('.run').classList.contains('is-collapsed'));
headerMessage.remove();

// 판별 결과에서 선택한 키워드를 윙렌즈 판매지표 분석 대기열에 넣고, 완료 결과를 목록으로 보관합니다.
const metricQueueSelection=new Set(),metricHistoryKey='wing-lens-metric-history-v1';
let metricHistoryCollapsed=window.sourcingJudgeCollapseState.get('metricHistory',true);
const metricQueueBar=document.createElement('div');
metricQueueBar.className='metric-queue-bar';
metricQueueBar.innerHTML='<label><input id="metricQueueSelectAll" type="checkbox"> 전체선택</label><strong id="metricQueueSelectedCount">선택 0개</strong><button id="metricQueueRun" type="button" class="outline">쿠팡판매지표 분석예약</button><button id="metricQueueCancel" type="button" class="stop" disabled>예약 취소</button><span id="metricQueueStatus"></span><div class="metric-email-settings"><label>결과 수신 이메일 <input id="metricEmailTo" type="email" placeholder="example@gmail.com"></label><label><input id="metricEmailPerKeyword" type="checkbox"> 키워드별 발송</label><label><input id="metricEmailAllComplete" type="checkbox"> 전체완료시 발송</label><button id="metricEmailSave" type="button" class="outline">설정저장</button></div>';
savedResultBar.after(metricQueueBar);
savedResultBar.after(savedResultChecklist);
const metricQueueStatus=$('#metricQueueStatus'),metricQueueSelectedCount=$('#metricQueueSelectedCount');
const metricEmailSettingsKey='wing-lens-metric-email-settings-v1';
function readMetricEmailSettings(){try{const value=JSON.parse(localStorage.getItem(metricEmailSettingsKey)||'{}');return{to:String(value.to||''),perKeyword:!!value.perKeyword,allComplete:!!value.allComplete}}catch{return{to:'',perKeyword:false,allComplete:false}}}
function currentMetricEmailSettings(){return{to:$('#metricEmailTo').value.trim(),perKeyword:$('#metricEmailPerKeyword').checked,allComplete:$('#metricEmailAllComplete').checked}}
function applyMetricEmailSettings(settings){$('#metricEmailTo').value=settings.to||'';$('#metricEmailPerKeyword').checked=!!settings.perKeyword;$('#metricEmailAllComplete').checked=!!settings.allComplete}
applyMetricEmailSettings(readMetricEmailSettings());
$('#metricEmailSave').onclick=()=>{const settings=currentMetricEmailSettings();if((settings.perKeyword||settings.allComplete)&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(settings.to)){toast('이메일 발송을 선택한 경우 올바른 수신 이메일을 입력해 주세요.');$('#metricEmailTo').focus();return}localStorage.setItem(metricEmailSettingsKey,JSON.stringify(settings));toast('이메일 발송 설정을 저장했습니다.')};
const wingReservationKeywords=document.createElement('div');
wingReservationKeywords.id='wingReservationKeywords';
wingReservationKeywords.className='wing-reservation-keywords';
wingReservationKeywords.hidden=true;
$('.wing-ledger-head').after(wingReservationKeywords);
function renderWingReservationKeywords(keywords,currentKeyword=''){const list=[...new Set(keywords)].filter(Boolean);if(!list.length){wingReservationKeywords.hidden=true;wingReservationKeywords.replaceChildren();return}wingReservationKeywords.hidden=false;wingReservationKeywords.innerHTML=`<strong>분석 예약 키워드 ${list.length}개</strong><span>${list.map(keyword=>`<b class="${keyword===currentKeyword?'current':''}">${clean(keyword)}${keyword===currentKeyword?' · 분석 중':''}</b>`).join('')}</span>`}
wingReservationKeywords.remove();
const wingQueueDashboard=document.createElement('section');
wingQueueDashboard.id='wingQueueDashboard';
wingQueueDashboard.className='wing-queue-dashboard';
wingQueueDashboard.hidden=true;
wingSearchForm.after(wingQueueDashboard);
wingQueueDashboard.after(metricQueueBar.querySelector('.metric-email-settings'));
const metricHistoryPanel=document.createElement('section');
metricHistoryPanel.className='metric-history-panel';
metricHistoryPanel.innerHTML='<div><strong>저장된 지표분석 목록</strong><span id="metricHistoryInfo"></span><button id="metricHistoryToggle" type="button" class="outline" aria-expanded="false">목록 펼치기</button><label class="metric-history-select-all"><input id="metricHistorySelectAll" type="checkbox"> 목록 전체선택</label><button id="metricHistoryDeleteSelected" type="button" class="stop">삭제</button><button id="metricHistoryExportSelected" type="button" class="outline">선택 목록 엑셀</button><button id="metricHistoryExportAll" type="button" class="outline">전체 목록 엑셀</button></div><div id="metricHistoryItems" class="metric-history-items"></div>';
$('#wingLensWorkspace').after(metricHistoryPanel);
const appConfirmModal=document.createElement('div');
appConfirmModal.id='appConfirmModal';
appConfirmModal.hidden=true;
appConfirmModal.innerHTML='<section role="dialog" aria-modal="true" aria-labelledby="appConfirmTitle"><h2 id="appConfirmTitle">확인</h2><p id="appConfirmMessage"></p><div><button id="appConfirmCancel" type="button" class="outline">취소</button><button id="appConfirmAccept" type="button">확인</button></div></section>';
document.body.append(appConfirmModal);
function showAppConfirm(message){return new Promise(resolve=>{const close=value=>{appConfirmModal.hidden=true;resolve(value)};$('#appConfirmTitle').textContent='확인';$('#appConfirmMessage').textContent=message;$('#appConfirmCancel').hidden=false;$('#appConfirmAccept').textContent='확인';appConfirmModal.hidden=false;$('#appConfirmAccept').onclick=()=>close(true);$('#appConfirmCancel').onclick=()=>close(false);appConfirmModal.onclick=event=>{if(event.target===appConfirmModal)close(false)}})}
const appNoticeModal=document.createElement('div');
appNoticeModal.id='appNoticeModal';
appNoticeModal.hidden=true;
appNoticeModal.innerHTML='<section role="alertdialog" aria-modal="true" aria-labelledby="appNoticeTitle"><h2 id="appNoticeTitle">안내</h2><p id="appNoticeMessage"></p><div><button id="appNoticeAccept" type="button">확인</button></div></section>';
document.body.append(appNoticeModal);
const appNoticeQueue=[];
let appNoticeActive=false;
function showNextAppNotice(){
  if(appNoticeActive||!appNoticeQueue.length)return;
  appNoticeActive=true;
  const notice=appNoticeQueue.shift();
  const close=()=>{
    appNoticeModal.hidden=true;appNoticeActive=false;notice.resolve();
    showNextAppNotice();
  };
  $('#appNoticeTitle').textContent=notice.title||'안내';
  $('#appNoticeMessage').textContent=notice.message;
  appNoticeModal.hidden=false;
  $('#appNoticeAccept').onclick=close;
  appNoticeModal.onclick=event=>{if(event.target===appNoticeModal)close()};
}
function showAppNotice(title,message){
  return new Promise(resolve=>{appNoticeQueue.push({title,message,resolve});showNextAppNotice()});
}
function readMetricHistory(){try{const value=JSON.parse(localStorage.getItem(metricHistoryKey)||'[]');return Array.isArray(value)?value:[]}catch{return[]}}
function writeMetricHistory(records){localStorage.setItem(metricHistoryKey,JSON.stringify(records.slice(0,20)))}
// 판매지표 분석예약 키워드는 결과 목록과 별도로 브라우저에 보관합니다.
const metricReservationListKey='wing-lens-reservation-keyword-lists-v1',metricReservationListSelection=new Set();
const metricQueueSaveButton=document.createElement('button');
metricQueueSaveButton.id='metricQueueSave';metricQueueSaveButton.type='button';metricQueueSaveButton.className='outline';metricQueueSaveButton.textContent='예약 목록 저장';
$('#metricQueueRun').after(metricQueueSaveButton);
const metricReservationListPanel=document.createElement('section');
metricReservationListPanel.id='metricReservationListPanel';metricReservationListPanel.className='metric-reservation-list-panel';
metricQueueBar.after(metricReservationListPanel);
function readMetricReservationLists(){try{const lists=JSON.parse(localStorage.getItem(metricReservationListKey)||'[]');return Array.isArray(lists)?lists.filter(item=>item&&Array.isArray(item.keywords)&&item.keywords.length):[]}catch{return[]}}
function writeMetricReservationLists(lists){localStorage.setItem(metricReservationListKey,JSON.stringify(lists))}
function renderMetricReservationLists(){const lists=readMetricReservationLists();for(const id of [...metricReservationListSelection])if(!lists.some(item=>item.id===id))metricReservationListSelection.delete(id);metricReservationListPanel.hidden=!lists.length;if(!lists.length){metricReservationListPanel.replaceChildren();return}const allChecked=lists.length>0&&lists.every(item=>metricReservationListSelection.has(item.id));metricReservationListPanel.innerHTML=`<div class="metric-reservation-list-head"><strong>저장된 판매지표 분석예약</strong><span>${lists.length}개 목록 저장됨</span><label><input id="metricReservationListSelectAll" type="checkbox" ${allChecked?'checked':''}> 목록 전체선택</label><button id="metricReservationListDelete" type="button" class="stop">선택 삭제</button></div><div class="metric-reservation-list-items">${lists.map(item=>`<label><input type="checkbox" data-reservation-list-check value="${clean(item.id)}" ${metricReservationListSelection.has(item.id)?'checked':''}><span><b>${item.keywords.length.toLocaleString()}개 키워드</b><small>${clean(item.savedAt)} · ${item.keywords.slice(0,5).map(clean).join(', ')}${item.keywords.length>5?' 외':''}</small></span><button type="button" class="outline" data-reservation-list-load="${clean(item.id)}">불러오기</button></label>`).join('')}</div>`}
metricQueueSaveButton.onclick=()=>{const keywords=[...metricQueueSelection].filter(Boolean);if(!keywords.length){toast('저장할 판매지표 분석예약 키워드를 선택해 주세요.');return}const lists=readMetricReservationLists();lists.unshift({id:crypto.randomUUID(),keywords:[...new Set(keywords)],savedAt:new Date().toLocaleString('ko-KR')});writeMetricReservationLists(lists);renderMetricReservationLists();toast(`${keywords.length.toLocaleString()}개 키워드 예약 목록을 저장했습니다.`)};
metricReservationListPanel.addEventListener('change',event=>{if(event.target.id==='metricReservationListSelectAll'){const checked=event.target.checked;readMetricReservationLists().forEach(item=>checked?metricReservationListSelection.add(item.id):metricReservationListSelection.delete(item.id));renderMetricReservationLists();return}const checkbox=event.target.closest('[data-reservation-list-check]');if(!checkbox)return;checkbox.checked?metricReservationListSelection.add(checkbox.value):metricReservationListSelection.delete(checkbox.value);renderMetricReservationLists()});
metricReservationListPanel.addEventListener('click',async event=>{const loadButton=event.target.closest('[data-reservation-list-load]');if(loadButton){const list=readMetricReservationLists().find(item=>item.id===loadButton.dataset.reservationListLoad);if(!list)return;list.keywords.forEach(keyword=>metricQueueSelection.add(keyword));updateMetricQueueSelection();toast(`${list.keywords.length.toLocaleString()}개 예약 키워드를 불러왔습니다.`);return}if(event.target.id!=='metricReservationListDelete')return;const ids=[...metricReservationListSelection];if(!ids.length){toast('삭제할 예약 목록을 체크해 주세요.');return}if(!await showAppConfirm(`선택한 ${ids.length}개 판매지표 분석예약 목록을 삭제할까요?`))return;writeMetricReservationLists(readMetricReservationLists().filter(item=>!metricReservationListSelection.has(item.id)));metricReservationListSelection.clear();renderMetricReservationLists();toast('선택한 예약 목록을 삭제했습니다.')});
renderMetricReservationLists();
function updateMetricQueueSelection(){const visible=passOnly.querySelector('input').checked?state.results.filter(row=>row.decision==='통과'):state.results;metricQueueSelectedCount.textContent=`선택 ${metricQueueSelection.size.toLocaleString()}개`;$('#metricQueueSelectAll').checked=visible.length>0&&visible.every(row=>metricQueueSelection.has(row.keyword));$('#metricQueueRun').disabled=!metricQueueSelection.size}
function metricRevenueManwon(value){const text=String(value||'');if(!text.includes('원'))return text||'-';const amount=Number(text.replace(/[^0-9.-]/g,''));return Number.isFinite(amount)?wingNumber(Math.round(amount/10000)):'-'}
function metricPriceManwon(value){const text=String(value||'');if(!text.includes('원'))return text||'-';const amount=Number(text.replace(/[^0-9.-]/g,''));return Number.isFinite(amount)?wingManwon(amount/10000):'-'}
function metricHistoryRows(records){const headers=['분석키워드','분석완료일시','순위','상품명','상품URL','가격(단위:만원)','리뷰수','배송','최근28일클릭수','최근28일판매량','월매출(단위:만원)','전환율'];return [headers,...records.flatMap(record=>record.products.map(product=>[record.keyword,record.completedAt,product.rank,product.name,product.url,metricPriceManwon(product.price),product.reviews,product.shipping,product.pv,product.sales,metricRevenueManwon(product.revenue),product.conversion]))]}
function exportMetricHistory(records,fileName){if(!records.length){toast('다운로드할 지표분석 목록이 없습니다.');return}const rows=metricHistoryRows(records),sheet=XLSX.utils.aoa_to_sheet(rows);sheet['!cols']=rows[0].map((header,index)=>({wch:index===3?42:index===4?48:Math.max(14,header.length+3)}));const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,sheet,'판매지표분석');XLSX.writeFile(book,fileName)}
async function emailMetricHistory(records,scope){const settings=readMetricEmailSettings();if(!settings.to||!records.length)return;const rows=metricHistoryRows(records),sheet=XLSX.utils.aoa_to_sheet(rows);sheet['!cols']=rows[0].map((header,index)=>({wch:index===3?42:index===4?48:Math.max(14,header.length+3)}));const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,sheet,'판매지표분석');const date=new Date().toISOString().slice(0,10),fileName=`쿠팡판매지표_${scope}_${date}.xlsx`,fileBase64=XLSX.write(book,{bookType:'xlsx',type:'base64'});const result=await fetch('/api/metric-email',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({to:settings.to,subject:`[신부장 소싱판별기] 쿠팡 판매지표 분석 ${scope} 결과`,message:`쿠팡 판매지표 분석 ${scope} 결과를 첨부합니다.\n분석 키워드: ${records.map(record=>record.keyword).join(', ')}\n완료 시각: ${new Date().toLocaleString('ko-KR')}`,fileName,fileBase64})});const data=await result.json().catch(()=>({}));if(!result.ok)throw new Error(data.message||'이메일을 발송하지 못했습니다.');return data}
function renderMetricHistory(){const records=readMetricHistory(),items=$('#metricHistoryItems'),toggle=$('#metricHistoryToggle'),collapsed=Boolean(records.length&&metricHistoryCollapsed);$('#metricHistoryInfo').textContent=`${records.length}개 목록 저장됨`;$('#metricHistorySelectAll').checked=false;toggle.disabled=!records.length;toggle.textContent=metricHistoryCollapsed?'목록 펼치기':'목록 접기';toggle.setAttribute('aria-expanded',String(!metricHistoryCollapsed));items.hidden=collapsed;items.classList.toggle('is-collapsed',collapsed);items.style.display=collapsed?'none':'grid';items.innerHTML=records.length?records.map(record=>`<label><input type="checkbox" value="${clean(record.id)}"><span><b>${clean(record.keyword)}</b><small>${clean(record.completedAt)} · ${Number(record.products?.length||0).toLocaleString()}개 상품</small></span></label>`).join(''):'<p>아직 저장된 지표분석 결과가 없습니다.</p>'}
function captureWingProducts(){return [...wingResultBody.querySelectorAll('tr[data-wing-index]')].map(row=>({rank:row.children[0]?.textContent.trim()||'',name:row.dataset.wingName||row.children[1]?.textContent.trim()||'',url:row.dataset.wingUrl||'',price:row.children[2]?.textContent.trim()||'',reviews:row.children[3]?.querySelector('span')?.textContent.trim()||'',shipping:row.children[4]?.textContent.trim()||'',pv:row.children[5]?.textContent.trim()||'',sales:row.children[6]?.textContent.trim()||'',revenue:row.children[7]?.textContent.trim()||'',conversion:row.children[8]?.textContent.trim()||''}))}
let metricReservationRunning=false,metricReservationCancelled=false,metricReservationJobs=[],metricReservationPaused=false;
function queueJobEstimateSeconds(job){const pages=Math.max(1,wingEndPage-wingStartPage+1);return job.productCount?job.productCount*10:pages*300}
function queueEstimateSeconds(){return metricReservationJobs.filter(job=>job.status==='대기'||job.status==='조회중').reduce((seconds,job)=>seconds+queueJobEstimateSeconds(job),0)}
function queueStatusText(status){return status==='조회중'?'조회중':status==='완료'?'완료':'중단'}
function renderWingQueueDashboard(){if(!metricReservationJobs.length){wingQueueDashboard.hidden=true;return}const total=metricReservationJobs.length,done=metricReservationJobs.filter(job=>job.status==='완료').length,running=metricReservationJobs.some(job=>job.status==='조회중'),pending=metricReservationJobs.some(job=>job.status==='대기'),inProgress=running||(metricReservationRunning&&pending),seconds=queueEstimateSeconds(),finishAt=new Date(Date.now()+seconds*1000),status=inProgress?'조회중':done===total?'완료':'중단';let cursor=Date.now();wingQueueDashboard.hidden=false;wingQueueDashboard.innerHTML=`<div class="wing-queue-summary"><span><b>총 조회건수</b><strong>${total}개</strong></span><span><b>진행상황</b><strong class="${inProgress?'running':done===total?'complete':'stopped'}">${status} · ${done}/${total}</strong></span><span><b>남은 예상시간</b><strong>${inProgress?`${Math.max(1,Math.ceil(seconds/60))}분`:'-'}</strong></span><span><b>완료예상시간</b><strong>${inProgress?finishAt.toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'}):status}</strong></span></div><div class="wing-queue-list"><strong>판매지표분석 예약 리스트</strong><div class="wing-queue-list-head"><span>순번</span><span>키워드</span><span>조회건수</span><span>진행상황</span><span>예상 완료</span><span>관리</span></div>${metricReservationJobs.map((job,index)=>{const estimate=queueJobEstimateSeconds(job),eta=job.status==='완료'?'완료':job.status==='중단'?'중단':new Date(cursor+=estimate*1000).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'});return `<div class="wing-queue-job"><span>${index+1}</span><b title="${clean(job.keyword)}">${clean(job.keyword)}</b><span>${job.productCount?`${job.productCount}개`:'확인 중'}</span><em class="${job.status}">${queueStatusText(job.status)}</em><span>${eta}</span>${(job.status==='대기'||job.status==='조회중')?`<button type="button" data-queue-job="${job.id}">중단</button>`:'<span>-</span>'}</div>`}).join('')}</div>`}
async function runMetricReservations(){if(metricReservationRunning)return;const keywords=[...metricQueueSelection];if(!keywords.length)return;const emailSettings=readMetricEmailSettings();if((emailSettings.perKeyword||emailSettings.allComplete)&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailSettings.to)){toast('이메일 발송을 선택한 경우 올바른 수신 이메일을 입력하고 발송 설정을 저장해 주세요.');return}const connected=await checkWingConnection();if(!connected)return;const completedRecords=[];metricReservationJobs=keywords.map(keyword=>({id:crypto.randomUUID(),keyword,status:'대기',productCount:0,stopRequested:false}));metricReservationRunning=true;metricReservationCancelled=false;$('#metricQueueRun').disabled=true;$('#metricQueueCancel').disabled=false;renderWingQueueDashboard();for(const job of metricReservationJobs){if(metricReservationCancelled)break;if(job.status==='중단')continue;job.status='조회중';wingKeywordInput.value=job.keyword;renderWingQueueDashboard();metricQueueStatus.textContent=`“${job.keyword}” 상품을 준비 중`;const search=await wingMessage({kind:'WL_EXTERNAL_SEARCH',keyword:job.keyword,startPage:wingStartPage,endPage:wingEndPage});if(metricReservationCancelled)break;if(job.stopRequested){job.status='중단';renderWingQueueDashboard();continue}if(!search?.ok||!search.products?.length){job.status='중단';renderWingQueueDashboard();metricQueueStatus.textContent=`“${job.keyword}” 검색 결과를 찾지 못해 중단했습니다.`;continue}job.productCount=search.products.length;const token=++wingRunToken;wingRenderRows(search.products);wingResultTitle.textContent=`“${job.keyword}” · ${search.products.length}개 상품 분석 중`;renderWingQueueDashboard();await runWingMetrics(search.products,token);if(metricReservationCancelled)break;if(job.stopRequested||token!==wingRunToken){job.status='중단';renderWingQueueDashboard();continue}const record={id:crypto.randomUUID(),keyword:job.keyword,completedAt:new Date().toLocaleString('ko-KR'),products:captureWingProducts()};try{writeMetricHistory([record,...readMetricHistory()]);renderMetricHistory()}catch{job.status='중단';toast('분석 결과 저장 공간이 부족합니다. 목록을 정리한 뒤 저장 목록을 정리한 뒤 다시 시도해 주세요.');renderWingQueueDashboard();break}job.status='완료';completedRecords.push(record);metricQueueSelection.delete(job.keyword);updateMetricQueueSelection();renderWingQueueDashboard();if(emailSettings.perKeyword){metricQueueStatus.textContent=`“${job.keyword}” 완료 · 이메일 발송 중`;try{await emailMetricHistory([record],`${job.keyword}_완료`);toast(`“${job.keyword}” 완료 결과를 이메일로 발송했습니다.`)}catch(error){toast(error.message||'완료 결과 이메일을 발송하지 못했습니다.')}}if(metricReservationJobs.some(item=>item.status==='대기'))await new Promise(resolve=>setTimeout(resolve,15000))}if(metricReservationCancelled)metricReservationJobs.forEach(job=>{if(job.status==='대기'||job.status==='조회중')job.status='중단'});metricReservationRunning=false;$('#metricQueueCancel').disabled=true;const completed=metricReservationJobs.filter(job=>job.status==='완료').length,stopped=metricReservationJobs.filter(job=>job.status==='중단').length;if(emailSettings.allComplete&&completed===metricReservationJobs.length&&completedRecords.length){metricQueueStatus.textContent='예약목록 전체 완료 · 이메일 발송 중';try{await emailMetricHistory(completedRecords,'예약목록_전체완료');toast('예약목록 전체 완료 결과를 이메일로 발송했습니다.')}catch(error){toast(error.message||'전체 완료 결과 이메일을 발송하지 못했습니다.')}}metricQueueStatus.textContent=`지표분석 예약 ${metricReservationCancelled?'중단':'완료'} · 완료 ${completed}개 · 중단 ${stopped}개`;$('#metricQueueRun').disabled=!metricQueueSelection.size;renderWingQueueDashboard();renderMetricHistory()}
body.addEventListener('change',event=>{const checkbox=event.target.closest('.metric-keyword-check');if(!checkbox)return;checkbox.checked?metricQueueSelection.add(checkbox.value):metricQueueSelection.delete(checkbox.value);updateMetricQueueSelection()});
$('#metricQueueSelectAll').onchange=event=>{const rows=passOnly.querySelector('input').checked?state.results.filter(row=>row.decision==='통과'):state.results;rows.forEach(row=>event.target.checked?metricQueueSelection.add(row.keyword):metricQueueSelection.delete(row.keyword));render();updateMetricQueueSelection()};
$('#metricQueueRun').onclick=async()=>{const count=metricQueueSelection.size;if(!count){toast('지표분석할 키워드를 선택해 주세요.');return}if(await showAppConfirm(`선택한 ${count.toLocaleString()}개 키워드를 순차적으로 지표분석 예약할까요?`))runMetricReservations()};
$('#metricQueueCancel').onclick=()=>{if(!metricReservationRunning)return;metricReservationCancelled=true;metricReservationJobs.forEach(job=>{if(job.status==='대기'||job.status==='조회중'){job.status='중단';job.stopRequested=true}});wingRunToken++;metricQueueStatus.textContent='지표분석 예약 취소 요청됨 · 현재 조회를 중단합니다.';$('#metricQueueCancel').disabled=true;renderWingQueueDashboard();toast('지표분석 예약 취소를 요청했습니다.')};
wingQueueDashboard.addEventListener('click',event=>{const button=event.target.closest('[data-queue-job]');if(!button)return;const job=metricReservationJobs.find(item=>item.id===button.dataset.queueJob);if(!job||job.status==='완료'||job.status==='중단')return;job.stopRequested=true;if(job.status==='조회중')wingRunToken++;job.status='중단';metricQueueStatus.textContent=`“${job.keyword}” 예약을 중단하고 다음 키워드를 조회합니다.`;renderWingQueueDashboard();toast(`“${job.keyword}” 예약을 중단했습니다.`)});
$('#metricHistoryExportAll').onclick=()=>exportMetricHistory(readMetricHistory(),`판매지표분석_전체_${new Date().toISOString().slice(0,10)}.xlsx`);
$('#metricHistoryExportSelected').onclick=()=>{const selected=new Set([...document.querySelectorAll('#metricHistoryItems input:checked')].map(input=>input.value));exportMetricHistory(readMetricHistory().filter(record=>selected.has(record.id)),`판매지표분석_선택_${new Date().toISOString().slice(0,10)}.xlsx`)};
$('#metricHistorySelectAll').onchange=event=>{document.querySelectorAll('#metricHistoryItems input[type="checkbox"]').forEach(input=>input.checked=event.target.checked)};
function toggleMetricHistory(){if(!readMetricHistory().length)return;metricHistoryCollapsed=!metricHistoryCollapsed;window.sourcingJudgeCollapseState.set('metricHistory',metricHistoryCollapsed);renderMetricHistory()}
metricHistoryPanel.addEventListener('click',event=>{if(!event.target.closest('#metricHistoryToggle'))return;event.preventDefault();toggleMetricHistory()});
$('#metricHistoryDeleteSelected').onclick=async()=>{const selected=new Set([...document.querySelectorAll('#metricHistoryItems input:checked')].map(input=>input.value));if(!selected.size){toast('삭제할 저장 목록을 선택해 주세요.');return}if(!await showAppConfirm(`선택한 ${selected.size}개 지표분석 목록을 삭제할까요?`))return;writeMetricHistory(readMetricHistory().filter(record=>!selected.has(record.id)));$('#metricHistorySelectAll').checked=false;renderMetricHistory();toast(`${selected.size}개 지표분석 목록을 삭제했습니다.`)};
function render(){const rows=passOnly.querySelector('input').checked?state.results.filter(row=>row.decision==='통과'):state.results;if(!rows.length){body.innerHTML=`<tr class="empty"><td colspan="10">${state.results.length?'통과한 키워드가 없습니다.':'엑셀 파일을 올린 뒤 소싱판별 실행을 눌러 주세요.'}</td></tr>`;$('#resultCount').textContent=0;$('#exportButton').disabled=!state.results.length;updateMetricQueueSelection();return}body.innerHTML=rows.map(row=>`<tr><td><label class="metric-keyword"><input class="metric-keyword-check" type="checkbox" value="${clean(row.keyword)}" ${metricQueueSelection.has(row.keyword)?'checked':''}><b>${clean(row.keyword)}</b></label></td><td><span class="${row.className}">${row.decision}</span></td><td class="reason">${clean(row.reason)}</td><td>${clean(row.category)}</td><td>${clean(row.ratio)}</td><td>${clean(row.volume)}</td><td>${clean(row.coupang)}</td><td>${clean(row.naverPrice)}</td><td>${clean(row.competition)}</td><td>${clean(row.season)}</td></tr>`).join('');$('#resultCount').textContent=rows.length;$('#exportButton').disabled=!rows.length;updateMetricQueueSelection()}
const metricQueueStyle=document.createElement('style');
metricQueueStyle.textContent='.metric-queue-bar,.metric-history-panel{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:10px 0;padding:12px 14px;border:1px solid #d8e5f6;border-radius:9px;background:#f8fbff;color:#40556d;font-size:12px}.metric-queue-bar label,.metric-keyword{display:inline-flex;align-items:center;gap:6px}.metric-queue-bar strong{color:#1967d9}.metric-queue-bar #metricQueueStatus{color:#728094}.metric-history-panel{display:block;margin:16px 0 0}.metric-history-panel>div:first-child{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.metric-history-panel>div:first-child strong{font-size:14px;color:#173a61}.metric-history-panel #metricHistoryInfo{color:#728094;margin-right:auto}.metric-history-items{display:grid;gap:6px;margin-top:10px}.metric-history-items label{display:flex;align-items:center;gap:9px;padding:9px 10px;border:1px solid #e0e8f1;border-radius:7px;background:#fff}.metric-history-items span{display:grid;gap:2px}.metric-history-items small{color:#738398}.metric-history-items p{margin:4px 0;color:#738398}.metric-keyword input{accent-color:#1967d9}.metric-keyword b{font-weight:800}';
metricQueueStyle.textContent='.metric-queue-bar,.metric-history-panel{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:10px 0;padding:12px 14px;border:1px solid #d8e5f6;border-radius:9px;background:#f8fbff;color:#40556d;font-size:12px}.metric-queue-bar label,.metric-keyword{display:inline-flex;align-items:center;gap:6px}.metric-queue-bar strong{color:#1967d9}.metric-queue-bar #metricQueueStatus{color:#728094}.metric-history-panel{display:block;margin:16px 0 0}.metric-history-panel>div:first-child{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.metric-history-panel>div:first-child strong{font-size:14px;color:#173a61}.metric-history-panel #metricHistoryInfo{color:#728094;margin-right:auto}.metric-history-items{display:grid;gap:6px;margin-top:10px}.metric-history-items label{display:flex;align-items:center;gap:9px;padding:9px 10px;border:1px solid #e0e8f1;border-radius:7px;background:#fff}.metric-history-items span{display:grid;gap:2px}.metric-history-items small{color:#738398}.metric-history-items p{margin:4px 0;color:#738398}.metric-keyword input{accent-color:#1967d9}.metric-keyword b{font-weight:800}.wing-reservation-keywords{display:flex;align-items:flex-start;gap:10px;flex-wrap:wrap;padding:11px 22px;border-bottom:1px solid #dce5ef;background:#f8fbff;color:#56708b;font-size:12px}.wing-reservation-keywords>strong{color:#173a61;white-space:nowrap}.wing-reservation-keywords>span{display:flex;gap:6px;flex-wrap:wrap}.wing-reservation-keywords b{padding:4px 7px;border-radius:99px;background:#eaf0f7;color:#60758b;font-size:11px}.wing-reservation-keywords b.current{background:#e7f1ff;color:#1967d9}.table-wrap table th{font-size:13.2px;text-align:center}';
document.head.append(metricQueueStyle);
renderMetricHistory();
// 상품 표가 표시된 뒤에는 빈 안내 영역이 레이아웃을 차지하지 않도록 합니다.
const wingEmptyVisibilityStyle=document.createElement('style');
wingEmptyVisibilityStyle.textContent='.wing-empty[hidden]{display:none!important}';
document.head.append(wingEmptyVisibilityStyle);
const keywordAlignmentStyle=document.createElement('style');
keywordAlignmentStyle.textContent='.table-wrap table td:first-child{text-align:left}.table-wrap table td:first-child .metric-keyword{justify-content:flex-start;width:100%}';
document.head.append(keywordAlignmentStyle);
const deliveryColorStyle=document.createElement('style');
deliveryColorStyle.textContent='.wing-table td.wing-delivery-overseas{color:#cf4a50;font-weight:800}.wing-table td.wing-delivery-rocket{color:#1967d9;font-weight:800}';
document.head.append(deliveryColorStyle);
const wingQueueDashboardStyle=document.createElement('style');
wingQueueDashboardStyle.textContent='.wing-queue-dashboard{margin:0 0 12px;border:1px solid #d8e5f3;border-radius:10px;background:#fff;overflow:hidden}.wing-queue-summary{display:grid;grid-template-columns:repeat(4,1fr);border-bottom:1px solid #e0e8f1}.wing-queue-summary span{padding:13px 16px;border-right:1px solid #e0e8f1}.wing-queue-summary span:last-child{border-right:0}.wing-queue-summary b{display:block;margin-bottom:5px;color:#7b8ca0;font-size:11px}.wing-queue-summary strong{color:#183653;font-size:14px}.wing-queue-summary strong.running{color:#1967d9}.wing-queue-summary strong.complete{color:#16845b}.wing-queue-summary strong.stopped{color:#cf4a50}.wing-queue-list{padding:12px 16px}.wing-queue-list>strong{display:block;margin-bottom:8px;color:#183653;font-size:13px}.wing-queue-list>div{display:grid;grid-template-columns:26px minmax(0,1fr) 48px 48px;align-items:center;gap:8px;padding:7px 0;border-top:1px solid #eef2f6}.wing-queue-list>div>span{color:#8a99a9;font-size:11px;text-align:center}.wing-queue-list b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}.wing-queue-list em{padding:3px 5px;border-radius:4px;background:#edf2f7;color:#687d92;font-size:10px;font-style:normal;text-align:center}.wing-queue-list em.조회중{background:#e8f1ff;color:#1967d9}.wing-queue-list em.완료{background:#e8f7f0;color:#16845b}.wing-queue-list em.중단{background:#fff0f1;color:#cf4a50}.wing-queue-list button{min-height:0;padding:5px 6px;border:1px solid #f2afb5;border-radius:5px;background:#fff;color:#cf4a50;font-size:10px}@media(max-width:800px){.wing-queue-summary{grid-template-columns:1fr 1fr}.wing-queue-summary span:nth-child(2){border-right:0}.wing-queue-summary span:nth-child(-n+2){border-bottom:1px solid #e0e8f1}}';
document.head.append(wingQueueDashboardStyle);
const mainTitleStyle=document.createElement('style');
mainTitleStyle.textContent='header h1{font-size:45px;color:#0b5d3f;font-weight:900}';
document.head.append(mainTitleStyle);
const filterLabelStyle=document.createElement('style');
filterLabelStyle.textContent='.filter-grid .filter-label-title,.filter-grid .range-title,.filter-presets>strong{color:#174f3a;font-weight:900;text-shadow:0 1px 0 #fff,0 2px 3px rgba(15,71,48,.22);letter-spacing:-.03em}.filter-grid .filter-label-title,.filter-grid .range-title{display:inline-block;padding:2px 4px;border-radius:4px;background:linear-gradient(180deg,#f9fffb 0%,#e7f3eb 100%);box-shadow:inset 0 1px 0 rgba(255,255,255,.96),0 1px 2px rgba(15,71,48,.14)}.filter-presets>strong{padding:4px 6px;border-radius:5px;background:linear-gradient(180deg,#f9fffb 0%,#e7f3eb 100%);box-shadow:inset 0 1px 0 rgba(255,255,255,.96),0 2px 3px rgba(15,71,48,.14)}';
document.head.append(filterLabelStyle);
document.querySelectorAll('.filter-grid>label').forEach(label=>{const title=label.querySelector('.range-title');if(title)return;const textNode=[...label.childNodes].find(node=>node.nodeType===Node.TEXT_NODE&&node.nodeValue.trim());if(!textNode)return;const titleSpan=document.createElement('span');titleSpan.className='filter-label-title';titleSpan.textContent=textNode.nodeValue.trim();textNode.replaceWith(titleSpan)});
presetSlot.onchange=()=>{const preset=readPresets()[presetSlot.value];if(!preset){presetName.value='';return}presetName.value=preset.name;applyFilters(preset.filters);toast(`“${preset.name}” 필터를 자동으로 적용했습니다.`)};
const queueListDetailStyle=document.createElement('style');
queueListDetailStyle.textContent='.wing-queue-list{padding:14px 16px}.wing-queue-list-head,.wing-queue-list .wing-queue-job{display:grid;grid-template-columns:42px minmax(180px,1fr) 80px 82px 100px 58px;align-items:center;gap:10px}.wing-queue-list-head{padding:8px 0;color:#8292a4;font-size:11px;font-weight:800;border-bottom:1px solid #dfe8f1}.wing-queue-list .wing-queue-job{padding:11px 0;border-top:0;border-bottom:1px solid #edf2f6}.wing-queue-list .wing-queue-job:last-child{border-bottom:0}.wing-queue-list .wing-queue-job>span{text-align:center}.wing-queue-list .wing-queue-job b{font-size:13px;color:#183653}.wing-queue-list .wing-queue-job button{justify-self:center}@media(max-width:760px){.wing-queue-list-head{display:none}.wing-queue-list .wing-queue-job{grid-template-columns:30px minmax(120px,1fr) 62px 52px}.wing-queue-list .wing-queue-job>span:nth-of-type(2),.wing-queue-list .wing-queue-job>span:nth-of-type(3){display:none}}';
document.head.append(queueListDetailStyle);
const wingDeliveryFilterStyle=document.createElement('style');
wingDeliveryFilterStyle.textContent='.wing-search-form .wing-delivery-filter,.wing-search-form .wing-review-filter{display:flex;align-items:center;gap:10px;min-height:43px;margin:0;padding:7px 10px;border:1px solid #c8d8e8;border-radius:7px;background:#fbfdff;color:#4d647b}.wing-delivery-filter legend,.wing-review-filter legend{padding:0 4px;color:#596c82;font-size:11px;font-weight:900}.wing-delivery-filter label{display:flex;align-items:center;gap:4px;color:#41576d;font-size:12px;font-weight:700;white-space:nowrap}.wing-delivery-filter input{width:auto!important;height:auto!important;margin:0;accent-color:#1967d9}.wing-delivery-filter button{height:29px!important;margin-left:auto;padding:0 8px!important;font-size:11px!important}.wing-review-filter>div{display:flex;align-items:center;gap:6px}.wing-review-filter select,.wing-review-filter input{width:auto!important;height:29px!important;margin:0!important;padding:0 8px!important;border:1px solid #c9d9ea!important;border-radius:6px!important;background:#fff!important;color:#263f5a!important;font:inherit!important}.wing-review-filter input{width:76px!important}@media(min-width:1050px){.wing-search-form{grid-template-columns:minmax(220px,1fr) 130px minmax(310px,auto) minmax(185px,auto) auto auto}}@media(max-width:1049px){.wing-search-form .wing-delivery-filter,.wing-search-form .wing-review-filter{grid-column:1/-1}}';
document.head.append(wingDeliveryFilterStyle);
const wingStatsColorStyle=document.createElement('style');
wingStatsColorStyle.textContent='.wing-summary .wing-stat-high{color:#cf3f46;font-weight:900}.wing-summary .wing-stat-low{color:#1967d9;font-weight:900}';
document.head.append(wingStatsColorStyle);
const wingSummaryHeadingStyle=document.createElement('style');
wingSummaryHeadingStyle.textContent='.wing-summary article>b{font-size:14.3px!important}';
document.head.append(wingSummaryHeadingStyle);
const wingPackageToolsStyle=document.createElement('style');
wingPackageToolsStyle.textContent='.wing-connection-tools{display:flex;flex-direction:column;align-items:flex-end;gap:9px;margin-left:auto}.wing-package-tools{display:flex;gap:7px;margin:0}.wing-package-tools a,.wing-package-tools button{display:inline-flex;align-items:center;justify-content:center;min-height:32px;padding:0 10px;border:1px solid #b9d1f5;border-radius:6px;background:#fff;color:#1967d9;font-size:11px;font-weight:800;text-decoration:none;cursor:pointer}.wing-package-tools button{border-color:#1d6fd5;background:#1967d9;color:#fff}.wing-workspace-head{margin-bottom:24px}@media(max-width:850px){.wing-connection-tools{align-items:flex-start;margin:12px 0 0}.wing-package-tools{flex-wrap:wrap}}';
document.head.append(wingPackageToolsStyle);
const metricEmailSettingsStyle=document.createElement('style');
metricEmailSettingsStyle.textContent='.metric-email-settings{display:flex;flex:1 0 100%;align-items:center;gap:10px;flex-wrap:wrap;padding-top:10px;border-top:1px solid #dce8f5}.metric-email-settings label{display:inline-flex;align-items:center;gap:6px;color:#52677e;font-size:12px;font-weight:700}.metric-email-settings input[type="email"]{width:220px;height:32px;padding:0 9px;border:1px solid #bfd1e6;border-radius:6px;color:#1d3148;font:inherit}.metric-email-settings input[type="checkbox"]{accent-color:#1967d9}.metric-email-settings button{padding:7px 10px;font-size:11px}@media(max-width:650px){.metric-email-settings{align-items:flex-start;flex-direction:column}.metric-email-settings input[type="email"]{width:min(280px,100%)}}';
document.head.append(metricEmailSettingsStyle);
const metricEmailPositionStyle=document.createElement('style');
metricEmailPositionStyle.textContent='.wing-workspace>.metric-email-settings{justify-content:flex-end;margin:12px 0;padding:12px 14px;border:1px solid #d8e5f3;border-radius:9px;background:#f8fbff}';
document.head.append(metricEmailPositionStyle);

// 필터 다운로드는 제공된 양식의 열 구성과 셀 서식을 유지한 XLSX로 생성합니다.
filteredDownload.onclick=async()=>{const file=$('#fileInput').files[0];if(!file){toast('먼저 원본 엑셀 파일을 올려 주세요.');return}filteredDownload.disabled=true;const originalLabel=filteredDownload.textContent;filteredDownload.textContent='양식 적용 파일 생성 중…';try{const qs=new URLSearchParams({filters:JSON.stringify(filters())});const response=await fetch(`/api/filtered-template?${qs}`,{method:'POST',body:await file.arrayBuffer()});if(!response.ok){const error=await response.json().catch(()=>({}));throw new Error(error.message||'필터 양식 파일을 만들지 못했습니다.')}const blob=await response.blob(),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`필터링_전체_${new Date().toISOString().slice(0,10)}.xlsx`;document.body.append(link);link.click();link.remove();URL.revokeObjectURL(url);toast('양식과 셀 서식이 적용된 필터 엑셀을 다운로드했습니다.')}catch(error){toast(error.message||'필터 양식 파일을 만들지 못했습니다.')}finally{filteredDownload.textContent=originalLabel;filteredDownload.disabled=!state.records.length}};
const resultSort={key:'',direction:1};
const resultSortFields=['keyword','decision','reason','category','ratio','volume','coupang','naverPrice','competition','season'];
const resultTableHead=document.querySelector('.table-wrap thead');
resultTableHead.querySelectorAll('th').forEach((header,index)=>{const title=header.textContent.trim();header.innerHTML=`<span>${clean(title)}</span><span class="result-sort-buttons"><button type="button" data-result-sort="${resultSortFields[index]}" data-result-direction="asc" aria-label="${clean(title)} 오름차순">▲</button><button type="button" data-result-sort="${resultSortFields[index]}" data-result-direction="desc" aria-label="${clean(title)} 내림차순">▼</button></span>`});
function resultSortValue(value){const text=String(value??'').trim(),numeric=Number(text.replace(/[^0-9.-]/g,''));return text&&Number.isFinite(numeric)&&/[0-9]/.test(text)?{kind:'number',value:numeric}:{kind:'text',value:text}}
resultTableHead.addEventListener('click',event=>{const button=event.target.closest('[data-result-sort]');if(!button)return;resultSort.key=button.dataset.resultSort;resultSort.direction=button.dataset.resultDirection==='asc'?1:-1;render()});
function render(){let rows=passOnly.querySelector('input').checked?state.results.filter(row=>row.decision==='통과'):state.results.slice();if(resultSort.key){rows.sort((left,right)=>{const a=resultSortValue(left[resultSort.key]),b=resultSortValue(right[resultSort.key]);const compared=a.kind==='number'&&b.kind==='number'?a.value-b.value:String(a.value).localeCompare(String(b.value),'ko');return compared*resultSort.direction})}if(!rows.length){body.innerHTML=`<tr class="empty"><td colspan="10">${state.results.length?'통과한 키워드가 없습니다.':'엑셀 파일을 올린 뒤 소싱판별 실행을 눌러 주세요.'}</td></tr>`;$('#resultCount').textContent=0;$('#exportButton').disabled=!state.results.length;updateMetricQueueSelection();return}body.innerHTML=rows.map(row=>`<tr><td><label class="metric-keyword"><input class="metric-keyword-check" type="checkbox" value="${clean(row.keyword)}" ${metricQueueSelection.has(row.keyword)?'checked':''}><b>${clean(row.keyword)}</b></label></td><td><span class="${row.className}">${row.decision}</span></td><td class="reason">${clean(row.reason)}</td><td>${clean(row.category)}</td><td>${clean(row.ratio)}</td><td>${clean(row.volume)}</td><td>${clean(row.coupang)}</td><td>${clean(row.naverPrice)}</td><td>${clean(row.competition)}</td><td>${clean(row.season)}</td></tr>`).join('');$('#resultCount').textContent=rows.length;$('#exportButton').disabled=!rows.length;updateMetricQueueSelection()}
const resultSortStyle=document.createElement('style');
resultSortStyle.textContent='.table-wrap table th>span:first-child{vertical-align:middle}.result-sort-buttons{display:inline-flex;flex-direction:column;margin-left:5px;vertical-align:middle;gap:0}.result-sort-buttons button{min-height:0;padding:0;border:0;border-radius:0;background:transparent;color:#8aa0b9;font-size:8px;line-height:8px}.result-sort-buttons button:hover{color:#1967d9}';
document.head.append(resultSortStyle);
$('#runButton').onclick=async()=>{const list=(fullQueryCheckbox.checked?state.records:state.records.slice(0,effectiveQueryLimit())).filter(record=>record?.keyword);if(!list.length){toast('먼저 전체 키워드를 추출해 판별 대상을 준비해 주세요.');return}state.results=[];state.cancelled=false;state.controller=new AbortController();$('#runButton').disabled=true;$('#stopButton').disabled=false;$('#progressBox').classList.remove('hidden');$('#progressLabel').textContent='소싱 판별 조회 준비 중';$('#progressCount').textContent=`0 / ${list.length}`;$('#progressBar').style.width='0%';try{render();for(let index=0;index<list.length&&!state.cancelled;index+=2){const chunk=await Promise.all(list.slice(index,index+2).map(judge));if(state.cancelled)break;state.results.push(...chunk);render();const processed=Math.min(index+2,list.length);$('#progressLabel').textContent='소싱 판별 조회 중';$('#progressCount').textContent=`${processed} / ${list.length}`;$('#progressBar').style.width=`${processed/list.length*100}%`;if(processed<list.length)await new Promise(resolve=>setTimeout(resolve,350))}$('#progressLabel').textContent=state.cancelled?'소싱 판별 중단됨':'소싱 판별 완료';toast(state.cancelled?`${state.results.length}개 결과까지만 저장했습니다.`:`${state.results.length}개 키워드의 판별이 완료되었습니다.`)}catch(error){$('#progressLabel').textContent='소싱 판별 실행 오류';toast(error.message||'소싱판별 실행 중 오류가 발생했습니다.')}finally{$('#runButton').disabled=false;$('#stopButton').disabled=true}};
const wingTitleSizeStyle=document.createElement('style');
wingTitleSizeStyle.textContent='#wingLensTitle{font-size:30px!important}';
document.head.append(wingTitleSizeStyle);
const wingResultTitleSizeStyle=document.createElement('style');
wingResultTitleSizeStyle.textContent='#wingResultTitle{font-size:30px!important}';
document.head.append(wingResultTitleSizeStyle);

// 쿠팡 조회 실패 시 자동 반복 요청하지 않고 안전하게 일시정지한 뒤, 사용자가 재로그인 후 재개합니다.
function queueStatusText(status){return status==='조회중'?'조회중':status==='완료'?'완료':status==='재개대기'?'재개 대기':status==='대기'?'대기':'중단'}
function renderWingQueueDashboard(){if(!metricReservationJobs.length){wingQueueDashboard.hidden=true;return}const total=metricReservationJobs.length,done=metricReservationJobs.filter(job=>job.status==='완료').length,running=metricReservationJobs.some(job=>job.status==='조회중'),paused=metricReservationJobs.some(job=>job.status==='재개대기'),pending=metricReservationJobs.some(job=>job.status==='대기'),inProgress=running||(metricReservationRunning&&pending),seconds=queueEstimateSeconds(),finishAt=new Date(Date.now()+seconds*1000),status=paused?'재개 대기':inProgress?'조회중':done===total?'완료':'중단';let cursor=Date.now();wingQueueDashboard.hidden=false;wingQueueDashboard.innerHTML=`<div class="wing-queue-summary"><span><b>총 조회건수</b><strong>${total}개</strong></span><span><b>진행상황</b><strong class="${paused?'stopped':inProgress?'running':done===total?'complete':'stopped'}">${status} · ${done}/${total}</strong></span><span><b>남은 예상시간</b><strong>${inProgress?`${Math.max(1,Math.ceil(seconds/60))}분`:'-'}</strong></span><span><b>완료예상시간</b><strong>${inProgress?finishAt.toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'}):status}</strong></span></div><div class="wing-queue-list"><strong>판매지표분석 예약 리스트</strong><div class="wing-queue-list-head"><span>순번</span><span>키워드</span><span>조회건수</span><span>진행상황</span><span>예상 완료</span><span>관리</span></div>${metricReservationJobs.map((job,index)=>{const estimate=queueJobEstimateSeconds(job),eta=job.status==='완료'?'완료':job.status==='중단'?'중단':job.status==='재개대기'?'재로그인 후 재개':new Date(cursor+=estimate*1000).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'});const action=job.status==='재개대기'?`<button type="button" data-queue-resume="${job.id}">재개</button>`:(job.status==='대기'||job.status==='조회중'?`<button type="button" data-queue-job="${job.id}">중단</button>`:'<span>-</span>');return `<div class="wing-queue-job"><span>${index+1}</span><b title="${clean(job.keyword)}">${clean(job.keyword)}</b><span>${job.productCount?`${job.productCount}개`:'확인 중'}</span><em class="${job.status}">${queueStatusText(job.status)}</em><span>${eta}</span>${action}</div>`}).join('')}</div>`}
async function runMetricReservations(resume=false){if(metricReservationRunning)return;const emailSettings=readMetricEmailSettings();if((emailSettings.perKeyword||emailSettings.allComplete)&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailSettings.to)){toast('이메일 발송을 선택한 경우 올바른 수신 이메일을 입력하고 발송 설정을 저장해 주세요.');return}if(!resume){const keywords=[...metricQueueSelection];if(!keywords.length)return;metricReservationJobs=keywords.map(keyword=>({id:crypto.randomUUID(),keyword,status:'대기',productCount:0,stopRequested:false}))}if(!metricReservationJobs.some(job=>job.status==='대기'||job.status==='재개대기'))return;const connected=await checkWingConnection();if(!connected)return;metricReservationRunning=true;metricReservationCancelled=false;metricReservationPaused=false;$('#metricQueueRun').disabled=true;$('#metricQueueCancel').disabled=false;renderWingQueueDashboard();for(const job of metricReservationJobs){if(metricReservationCancelled)break;if(job.status!=='대기'&&job.status!=='재개대기')continue;job.status='조회중';job.stopRequested=false;wingKeywordInput.value=job.keyword;renderWingQueueDashboard();metricQueueStatus.textContent=`“${job.keyword}” 상품을 준비 중`;const search=await wingMessage({kind:'WL_EXTERNAL_SEARCH',keyword:job.keyword,startPage:wingStartPage,endPage:wingEndPage});if(metricReservationCancelled)break;if(job.stopRequested){job.status='중단';renderWingQueueDashboard();continue}if(!search?.ok||!search.products?.length){job.status='재개대기';metricReservationPaused=true;metricReservationRunning=false;$('#metricQueueCancel').disabled=true;metricQueueStatus.textContent=`“${job.keyword}” 쿠팡 조회에 실패했습니다. 쿠팡에 다시 로그인한 뒤 재개를 눌러 주세요.`;wingStatus.textContent='쿠팡 조회 실패 · 재로그인 후 예약 리스트의 재개 버튼을 눌러 주세요.';renderWingQueueDashboard();toast('쿠팡 조회 실패로 예약을 일시정지했습니다. 자동 재시도하지 않습니다.');return}job.productCount=search.products.length;const token=++wingRunToken;wingRenderRows(search.products);wingResultTitle.textContent=`“${job.keyword}” · ${search.products.length}개 상품 분석 중`;renderWingQueueDashboard();await runWingMetrics(search.products,token);if(metricReservationCancelled)break;if(job.stopRequested||token!==wingRunToken){job.status='중단';renderWingQueueDashboard();continue}if(wingAccessError(wingStatus.textContent)){job.status='재개대기';metricReservationPaused=true;metricReservationRunning=false;$('#metricQueueCancel').disabled=true;metricQueueStatus.textContent=`“${job.keyword}” 조회가 일시정지되었습니다. 쿠팡에 다시 로그인한 뒤 재개를 눌러 주세요.`;renderWingQueueDashboard();toast('접근 제한으로 예약을 일시정지했습니다. 자동 재시도하지 않습니다.');return}const record={id:crypto.randomUUID(),keyword:job.keyword,completedAt:new Date().toLocaleString('ko-KR'),products:captureWingProducts()};try{writeMetricHistory([record,...readMetricHistory()]);renderMetricHistory()}catch{job.status='중단';toast('분석 결과 저장 공간이 부족합니다. 목록을 정리한 뒤 다시 시도해 주세요.');renderWingQueueDashboard();break}job.status='완료';metricQueueSelection.delete(job.keyword);updateMetricQueueSelection();renderWingQueueDashboard();if(emailSettings.perKeyword){try{await emailMetricHistory([record],`${job.keyword}_완료`);toast(`“${job.keyword}” 완료 결과를 이메일로 발송했습니다.`)}catch(error){toast(error.message||'완료 결과 이메일을 발송하지 못했습니다.')}}if(metricReservationJobs.some(item=>item.status==='대기'))await new Promise(resolve=>setTimeout(resolve,15000))}if(metricReservationCancelled)metricReservationJobs.forEach(job=>{if(job.status==='대기'||job.status==='조회중'||job.status==='재개대기')job.status='중단'});metricReservationRunning=false;$('#metricQueueCancel').disabled=true;const completed=metricReservationJobs.filter(job=>job.status==='완료').length,stopped=metricReservationJobs.filter(job=>job.status==='중단').length;metricQueueStatus.textContent=`지표분석 예약 ${metricReservationCancelled?'중단':'완료'} · 완료 ${completed}개 · 중단 ${stopped}개`;$('#metricQueueRun').disabled=!metricQueueSelection.size;renderWingQueueDashboard();renderMetricHistory()}
wingQueueDashboard.addEventListener('click',async event=>{const button=event.target.closest('[data-queue-resume]');if(!button)return;const job=metricReservationJobs.find(item=>item.id===button.dataset.queueResume);if(!job||job.status!=='재개대기'||metricReservationRunning)return;const confirmed=await showAppConfirm('예약 작업을 재개하려면 쿠팡윙에 다시 로그인해야 합니다. 크롬 시크릿 창에서 쿠팡 판매자센터 로그인 화면을 연 뒤, 로그인 완료 후 다시 재개를 눌러 주세요. 로그인 창을 열까요?');if(!confirmed)return;const opened=await openWingLoginWindow();if(!opened)return;toast('쿠팡윙 로그인 완료 후 재개 버튼을 다시 눌러 예약 작업을 이어가세요.')});

// 예약 목록은 상품 단위 처리 건수를 함께 표시합니다.
function wingQueueMarkProgress(done,total){const activeJob=typeof metricReservationJobs!=='undefined'?metricReservationJobs.find(job=>job.status==='조회중'):null;if(!activeJob)return;activeJob.productCount=total;activeJob.processedCount=done;renderWingQueueDashboard()}
runWingMetrics=async function(products,token){const selectedTypes=selectedWingDeliveryTypes(),reviewFilter=selectedWingReviewFilter(),filterDescription=selectedTypes.length?selectedTypes.join(' · '):'전체';let processed=0;const markProcessed=()=>{processed+=1;wingQueueMarkProgress(processed,products.length)};for(let index=0;index<products.length;index++){if(token!==wingRunToken)return;const product=products[index],row=wingResultBody.querySelector(`[data-wing-index="${index}"]`);if(!row)continue;if(!matchesWingReviewFilter(product)){const label=reviewFilter?`리뷰 ${reviewFilter.operator==='gte'?'이상':'이하'} ${wingNumber(reviewFilter.value)}건 제외`:'리뷰 조건 제외';row.children[4].textContent='리뷰 조건 제외';row.children[5].textContent=label;row.children[6].textContent='-';row.children[7].textContent='-';row.children[8].textContent='-';wingStatus.textContent=`${index+1} / ${products.length} · ${label} · 상세 조회 없이 다음 상품으로 이동합니다.`;markProcessed();updateWingSummary();continue}wingStatus.textContent=`${index+1} / ${products.length} · 배송유형 확인 후 ${filterDescription} 판매지표를 조회 중입니다.`;const shipping=await wingMessage({kind:'WL_EXTERNAL_SHIPPING',productUrl:product.url});if(token!==wingRunToken)return;if(wingAccessError(shipping?.error)){wingStatus.textContent='쿠팡 접근 제한이 감지되어 조회를 중단했습니다. 쿠팡에 재로그인한 뒤 최소 90초 후 다시 시도해 주세요.';toast('쿠팡 접근 제한으로 윙렌즈 조회를 중단했습니다.');return}const deliveryCell=row.children[4],deliveryMethod=shipping?.ok?shipping.shippingMethod||'-':'-',deliveryType=normalizeWingDeliveryType(deliveryMethod);deliveryCell.textContent=deliveryMethod;deliveryCell.classList.toggle('wing-delivery-overseas',deliveryType==='해외');deliveryCell.classList.toggle('wing-delivery-rocket',deliveryType==='로켓');if(selectedTypes.length&&!selectedTypes.includes(deliveryType)){row.children[5].textContent='유형 제외';row.children[6].textContent='-';row.children[7].textContent='-';row.children[8].textContent='-';markProcessed();updateWingSummary();if(index<products.length-1)await new Promise(resolve=>setTimeout(resolve,10000));continue}const metric=await wingMessage({kind:'WL_EXTERNAL_METRIC',productId:product.productId});if(token!==wingRunToken)return;if(wingAccessError(metric?.error)){wingStatus.textContent='쿠팡 접근 제한이 감지되어 조회를 중단했습니다. 쿠팡에 재로그인한 뒤 최소 90초 후 다시 시도해 주세요.';toast('쿠팡 접근 제한으로 윙렌즈 조회를 중단했습니다.');return}const item=metric?.item;row.children[5].textContent=item?wingNumber(item.pvLast28Day):'조회 실패';row.children[6].textContent=item?wingNumber(item.salesLast28d):'-';row.children[7].textContent=item?wingRevenue(item.salesLast28d,item.salePrice||shipping?.price):'-';row.children[8].textContent=item?wingConversion(item.salesLast28d,item.pvLast28Day):'-';markProcessed();updateWingSummary();if(index<products.length-1)await new Promise(resolve=>setTimeout(resolve,10000))}if(token===wingRunToken)wingStatus.textContent=`${products.length}개 상품의 ${filterDescription} 판매지표 조회가 완료되었습니다.`};
renderWingQueueDashboard=function(){if(!metricReservationJobs.length){wingQueueDashboard.hidden=true;return}const total=metricReservationJobs.length,done=metricReservationJobs.filter(job=>job.status==='완료').length,running=metricReservationJobs.some(job=>job.status==='조회중'),paused=metricReservationJobs.some(job=>job.status==='재개대기'),pending=metricReservationJobs.some(job=>job.status==='대기'),inProgress=running||(metricReservationRunning&&pending),seconds=queueEstimateSeconds(),finishAt=new Date(Date.now()+seconds*1000),status=paused?'재개 대기':inProgress?'조회중':done===total?'완료':'중단';let cursor=Date.now();wingQueueDashboard.hidden=false;wingQueueDashboard.innerHTML=`<div class="wing-queue-summary"><span><b>총 조회건수</b><strong>${total}개</strong></span><span><b>진행상황</b><strong class="${paused?'stopped':inProgress?'running':done===total?'complete':'stopped'}">${status} · ${done}/${total}</strong></span><span><b>남은 예상시간</b><strong>${inProgress?`${Math.max(1,Math.ceil(seconds/60))}분`:'-'}</strong></span><span><b>완료예상시간</b><strong>${inProgress?finishAt.toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'}):status}</strong></span></div><div class="wing-queue-list"><strong>판매지표분석 예약 리스트</strong><div class="wing-queue-list-head"><span>순번</span><span>키워드</span><span>조회 진행</span><span>진행상황</span><span>예상 완료</span><span>관리</span></div>${metricReservationJobs.map((job,index)=>{const estimate=queueJobEstimateSeconds(job),eta=job.status==='완료'?'완료':job.status==='중단'?'중단':job.status==='재개대기'?'재로그인 후 재개':new Date(cursor+=estimate*1000).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'}),target=Number(job.productCount)||0,processed=Math.min(Number(job.processedCount)||0,target),percent=target?Math.round(processed/target*100):(job.status==='완료'?100:0),progressText=target?`${processed.toLocaleString()} / ${target.toLocaleString()}개`:'확인 중',action=job.status==='재개대기'?`<button type="button" data-queue-resume="${job.id}">재개</button>`:(job.status==='대기'||job.status==='조회중'?`<button type="button" data-queue-job="${job.id}">중단</button>`:'<span>-</span>');return `<div class="wing-queue-job"><span>${index+1}</span><b title="${clean(job.keyword)}">${clean(job.keyword)}</b><span class="wing-queue-count">${progressText}</span><div class="wing-queue-progress"><div><em class="${job.status}">${queueStatusText(job.status)}</em><b>${percent}%</b></div><i><span style="width:${percent}%"></span></i></div><span>${eta}</span>${action}</div>`}).join('')}</div>`};

// 전체 키워드 추출 결과를 판별 전에 확인할 수 있는 목록입니다.
const targetListFields=[
  ['keyword','키워드'],['category','카테고리'],['brand','브랜드키워드'],['shopping','쇼핑키워드'],
  ['ratio','경쟁률'],['volume','최근1개월검색량'],['lastYearVolume','작년검색량'],['peakMonth','작년최대검색월'],
  ['season','계절성월'],['competition','네이버경쟁강도'],['naverPrice','네이버평균가'],['coupangPrice','쿠팡평균가'],
  ['rocketRate','로켓배송비율'],['sellerRocketRate','판매자로켓배송비율'],['deliveryRate','배송비율(로켓+판매자)'],['overseasReviews','쿠팡해외배송 총리뷰수']
];
const targetListViewStorageKey='sourcing-target-list-view-v1';
const defaultTargetListView={limit:50,columns:targetListFields.map(([key])=>key)};
function readTargetListView(){try{const saved=JSON.parse(localStorage.getItem(targetListViewStorageKey)||'{}'),limit=Number(saved.limit);return {limit:[50,100,200,300,500].includes(limit)?limit:defaultTargetListView.limit,columns:Array.isArray(saved.columns)&&saved.columns.length?saved.columns.filter(key=>targetListFields.some(([field])=>field===key)):defaultTargetListView.columns.slice()}}catch{return {...defaultTargetListView,columns:defaultTargetListView.columns.slice()}}}
let targetListView=readTargetListView();
const targetListPanel=document.createElement('section');
targetListPanel.id='targetListPanel';
targetListPanel.className='target-list-panel';
targetListPanel.innerHTML=`<div class="target-list-heading"><div><span class="target-list-eyebrow">판별 대상 확인</span><h2>판별 대상 목록 <strong id="targetListCount">0개</strong></h2><p id="targetListSummary">전체 키워드를 추출하면 이곳에서 대상 목록을 확인할 수 있습니다.</p></div><div class="target-list-controls"><label>리스트 보기 <select id="targetListSize"><option value="50">50개</option><option value="100">100개</option><option value="200">200개</option><option value="300">300개</option><option value="500">500개</option></select></label><button type="button" class="outline" id="targetListColumnsButton">표시 항목 선택</button><button type="button" class="outline" id="targetListSaveButton">목록 설정 저장</button></div></div><div class="target-list-selection"><label><input type="checkbox" id="targetListSelectAll"> 전체선택</label><strong>선택 <em id="targetListSelectedCount">0</em>개</strong><button type="button" class="outline" id="targetListRunSelected">선택 키워드 판별</button><button type="button" class="outline" id="targetListClearSelected">선택 해제</button></div><div class="target-list-column-panel" id="targetListColumnPanel" hidden><div class="target-list-column-heading"><b>엑셀 필드 표시 선택</b><span>선택한 항목만 목록에 표시됩니다.</span></div><div class="target-list-column-options">${targetListFields.map(([key,label])=>`<label><input type="checkbox" value="${key}"> ${label}</label>`).join('')}</div></div><div class="target-list-table-wrap"><table><thead id="targetListHead"></thead><tbody id="targetListBody"></tbody></table></div>`;
const filterCard=$('#filterInfo')?.closest('.card')||$('#filterInfo')?.parentElement;
if(filterCard)filterCard.after(targetListPanel);
const targetListSize=$('#targetListSize'),targetListColumnPanel=$('#targetListColumnPanel'),targetListHead=$('#targetListHead'),targetListBody=$('#targetListBody');
window.targetKeywordSelection=window.targetKeywordSelection instanceof Set?window.targetKeywordSelection:new Set();
targetListSize.value=String(targetListView.limit);
function syncTargetListOptions(){targetListPanel.querySelectorAll('.target-list-column-options input').forEach(input=>{input.checked=input.value==='keyword'||targetListView.columns.includes(input.value);input.disabled=input.value==='keyword'})}
function displayTargetValue(value){if(value===undefined||value===null||value==='')return '-';return Array.isArray(value)?value.join(', '):String(value)}
window.renderTargetList=()=>{if(!targetListHead||!targetListBody)return;const columns=targetListFields.filter(([key])=>key==='keyword'||targetListView.columns.includes(key)),records=state.records||[],visible=records.slice(0,targetListView.limit),selected=window.targetKeywordSelection;for(const keyword of [...selected])if(!records.some(record=>String(record.keyword)===keyword))selected.delete(keyword);$('#targetListCount').textContent=`${records.length.toLocaleString()}개`;$('#targetListSelectedCount').textContent=selected.size;$('#targetListSelectAll').checked=!!records.length&&records.every(record=>selected.has(String(record.keyword)));$('#targetListSummary').textContent=records.length?`${selected.size?`선택한 ${selected.size.toLocaleString()}개 키워드만 판별할 수 있습니다. `:''}전체 ${records.length.toLocaleString()}개 중 ${visible.length.toLocaleString()}개를 표시합니다.`:'전체 키워드를 추출하면 이곳에서 대상 목록을 확인할 수 있습니다.';targetListHead.innerHTML=`<tr><th>번호</th>${columns.map(([,label])=>`<th>${clean(label)}</th>`).join('')}</tr>`;targetListBody.innerHTML=visible.length?visible.map((record,index)=>`<tr><td>${index+1}</td>${columns.map(([key])=>key==='keyword'?`<td class="target-keyword-cell"><label><input class="target-keyword-check" type="checkbox" value="${clean(String(record.keyword))}" ${selected.has(String(record.keyword))?'checked':''}><b>${clean(displayTargetValue(record[key]))}</b></label></td>`:`<td>${clean(displayTargetValue(record[key]))}</td>`).join('')}</tr>`).join(''):`<tr><td class="target-list-empty" colspan="${columns.length+1}">추출된 판별 대상이 없습니다.</td></tr>`};
syncTargetListOptions();
$('#targetListColumnsButton').onclick=()=>{targetListColumnPanel.hidden=!targetListColumnPanel.hidden;$('#targetListColumnsButton').textContent=targetListColumnPanel.hidden?'표시 항목 선택':'표시 항목 닫기'};
targetListSize.onchange=()=>{targetListView.limit=Number(targetListSize.value);window.renderTargetList()};
targetListPanel.querySelector('.target-list-column-options').onchange=()=>{const columns=[...targetListPanel.querySelectorAll('.target-list-column-options input:checked')].map(input=>input.value);if(!columns.length){toast('목록에 표시할 항목을 한 개 이상 선택해 주세요.');syncTargetListOptions();return}targetListView.columns=columns;window.renderTargetList()};
$('#targetListSaveButton').onclick=()=>{localStorage.setItem(targetListViewStorageKey,JSON.stringify(targetListView));toast('판별 대상 목록 설정을 저장했습니다.')};
targetListPanel.querySelector('#targetListSelectAll').onchange=event=>{const selected=window.targetKeywordSelection;if(event.target.checked)(state.records||[]).forEach(record=>{if(record?.keyword)selected.add(String(record.keyword))});else selected.clear();window.renderTargetList()};
targetListBody.onchange=event=>{const checkbox=event.target.closest('.target-keyword-check');if(!checkbox)return;if(checkbox.checked)window.targetKeywordSelection.add(checkbox.value);else window.targetKeywordSelection.delete(checkbox.value);window.renderTargetList()};
$('#targetListClearSelected').onclick=()=>{window.targetKeywordSelection.clear();window.renderTargetList()};
$('#targetListRunSelected').onclick=()=>{const count=window.targetKeywordSelection.size;if(!count){toast('판별할 키워드를 먼저 선택해 주세요.');return}if(!confirm(`선택한 ${count.toLocaleString()}개 키워드만 소싱판별을 실행할까요?`))return;$('#runButton').click()};
window.renderTargetList();

// 마지막으로 성공한 원본 파일과 필터링 결과를 이 PC의 브라우저에만 보관합니다.
// 서버나 외부 서비스에는 원본 파일을 저장하지 않습니다.
const judgeWorkspaceDbName='sourcing-judge-workspace-v1';
const judgeWorkspaceStoreName='workspace';
function openJudgeWorkspaceDb(){return new Promise((resolve,reject)=>{const request=indexedDB.open(judgeWorkspaceDbName,1);request.onupgradeneeded=()=>request.result.createObjectStore(judgeWorkspaceStoreName);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})}
async function writeJudgeWorkspace(value){const db=await openJudgeWorkspaceDb();return new Promise((resolve,reject)=>{const transaction=db.transaction(judgeWorkspaceStoreName,'readwrite');transaction.objectStore(judgeWorkspaceStoreName).put(value,'active');transaction.oncomplete=()=>{db.close();resolve()};transaction.onerror=()=>{db.close();reject(transaction.error)}})}
async function readJudgeWorkspace(){const db=await openJudgeWorkspaceDb();return new Promise((resolve,reject)=>{const transaction=db.transaction(judgeWorkspaceStoreName,'readonly'),request=transaction.objectStore(judgeWorkspaceStoreName).get('active');request.onsuccess=()=>{db.close();resolve(request.result)};request.onerror=()=>{db.close();reject(request.error)}})}
window.persistJudgeWorkspace=async()=>{const file=$('#fileInput')?.files?.[0];if(!file||!state.records.length)return;try{await writeJudgeWorkspace({file,records:state.records,totalMatched:state.totalMatched||state.records.length,appliedFilters:filters(),savedAt:Date.now()})}catch(error){console.warn('작업 상태를 보관하지 못했습니다.',error)}};
$('#fileInput').addEventListener('change',async event=>{const file=event.target.files?.[0];if(!file)return;try{await writeJudgeWorkspace({file,records:[],totalMatched:0,appliedFilters:filters(),savedAt:Date.now()})}catch(error){console.warn('원본 파일을 보관하지 못했습니다.',error)}});
(async()=>{try{const workspace=await readJudgeWorkspace(),fileInput=$('#fileInput');if(!workspace?.file||fileInput.files?.length)return;const transfer=new DataTransfer();transfer.items.add(new File([workspace.file],workspace.file.name,{type:workspace.file.type,lastModified:workspace.file.lastModified}));fileInput.files=transfer.files;$('#fileName').textContent=workspace.file.name;if(workspace.appliedFilters)applyFilters(workspace.appliedFilters);if(Array.isArray(workspace.records)&&workspace.records.length){state.totalMatched=Number(workspace.totalMatched)||workspace.records.length;state.records=workspace.records;$('#fileInfo').textContent='이전 원본 파일 · 필터 결과 유지됨';$('#filterInfo').textContent=`필터 조건에 맞는 전체 ${state.records.length.toLocaleString()}개를 판별 대상으로 준비했습니다.`;$('#runButton').disabled=false;filteredDownload.disabled=false;toast('이전 원본 파일과 필터링 결과를 불러왔습니다.')}else{$('#fileInfo').textContent='이전 원본 파일 유지됨 · 필터 조건을 정한 뒤 전체 키워드를 추출해 주세요.';$('#applyFilter').disabled=false}}catch(error){console.warn('이전 작업 상태를 불러오지 못했습니다.',error)}})();

// 저장 필터는 선택하는 즉시 조건을 화면에 적용합니다.
function applySelectedFilterPreset(){const preset=readPresets()[presetSlot.value];if(!preset){presetName.value='';return}try{presetName.value=preset.name||'';applyFilters(preset.filters||{});$('#filterInfo').textContent=`“${preset.name}” 필터 조건을 불러왔습니다. 전체 키워드 추출을 누르면 적용됩니다.`;toast(`“${preset.name}” 필터를 자동으로 적용했습니다.`)}catch(error){toast('저장된 필터 조건을 불러오지 못했습니다.');console.warn('저장 필터 자동 적용 실패',error)}}
presetSlot.onchange=applySelectedFilterPreset;

// 판매지표 분석 예약 작업은 이 브라우저에만 별도로 보관합니다.
// 시스템/브라우저가 중단되어도 완료 전 작업은 "재개 대기" 상태로 복원됩니다.
const activeMetricReservationKey='wing-lens-active-reservation-v1';
function writeActiveMetricReservationQueue(){
  if(!Array.isArray(metricReservationJobs)||!metricReservationJobs.length){localStorage.removeItem(activeMetricReservationKey);return}
  const jobs=metricReservationJobs.map(job=>({
    id:String(job.id||crypto.randomUUID()),keyword:String(job.keyword||''),status:String(job.status||'대기'),
    productCount:Number(job.productCount)||0,processedCount:Number(job.processedCount)||0,scheduledAt:String(job.scheduledAt||''),
    pausedAt:Number(job.pausedAt)||0,pauseKind:String(job.pauseKind||''),pauseReason:String(job.pauseReason||''),
    startPage:Math.max(1,Number(job.startPage)||wingStartPage),endPage:Math.max(1,Number(job.endPage)||wingEndPage)
  })).filter(job=>job.keyword);
  localStorage.setItem(activeMetricReservationKey,JSON.stringify({jobs,savedAt:Date.now()}));
}
function readActiveMetricReservationQueue(){
  try{const saved=JSON.parse(localStorage.getItem(activeMetricReservationKey)||'null');return Array.isArray(saved?.jobs)?saved:null}catch{return null}
}
function clearActiveMetricReservationQueue(){localStorage.removeItem(activeMetricReservationKey)}
const stopWingMetricsWithNormalSupport=stopWingMetrics;
const renderWingQueueDashboardWithPersistence=renderWingQueueDashboard;
renderWingQueueDashboard=function(){writeActiveMetricReservationQueue();return renderWingQueueDashboardWithPersistence()};
function restoreActiveMetricReservationQueue(){
  const saved=readActiveMetricReservationQueue();
  if(!saved?.jobs?.length)return;
  metricReservationJobs=saved.jobs.map(job=>({
    id:job.id||crypto.randomUUID(),keyword:String(job.keyword||'').trim(),
    status:job.status==='조회중'||job.status==='재개대기'?'재개대기':job.status==='예약대기'?'예약대기':job.status==='완료'?'완료':job.status==='중단'?'중단':'대기',
    productCount:Number(job.productCount)||0,processedCount:Number(job.processedCount)||0,scheduledAt:String(job.scheduledAt||''),
    pausedAt:Number(job.pausedAt)||0,pauseKind:String(job.pauseKind||''),pauseReason:String(job.pauseReason||''),
    startPage:Math.max(1,Number(job.startPage)||wingStartPage),endPage:Math.max(1,Number(job.endPage)||wingEndPage),stopRequested:false
  })).filter(job=>job.keyword);
  metricReservationRunning=false;metricReservationCancelled=false;metricReservationPaused=metricReservationJobs.some(job=>job.status==='재개대기');
  if(!metricReservationJobs.length){clearActiveMetricReservationQueue();return}
  metricQueueStatus.textContent='이전 판매지표 분석 예약을 복원했습니다. 재개 버튼을 누르면 이어서 조회합니다.';
  renderWingQueueDashboard();
}
function clearMetricReservationByUser(){
  const hasQueue=metricReservationJobs.length>0;
  if(!hasQueue){stopWingMetricsWithNormalSupport();return}
  metricReservationCancelled=true;wingRunToken++;
  metricReservationJobs=[];metricReservationRunning=false;metricReservationPaused=false;
  clearActiveMetricReservationQueue();
  $('#metricQueueCancel').disabled=true;
  if(hasQueue){metricQueueStatus.textContent='판매지표 분석 예약 리스트를 삭제했습니다.';toast('중단 요청으로 판매지표 분석 예약 리스트를 모두 삭제했습니다.')}
  renderWingQueueDashboard();
  wingRunButton.disabled=false;wingStopButton.disabled=true;wingLedgerStopButton.disabled=true;
}
// 전체 중단/예약 취소는 사용자가 명시적으로 누른 경우에만 보관 중인 예약도 삭제합니다.
wingStopButton.onclick=clearMetricReservationByUser;
wingLedgerStopButton.onclick=clearMetricReservationByUser;
$('#metricQueueCancel').onclick=clearMetricReservationByUser;
$('#metricQueueRun').onclick=async()=>{
  const resumable=metricReservationJobs.some(job=>job.status==='대기'||job.status==='조회중'||job.status==='재개대기');
  if(resumable){
    if(await showAppConfirm('저장된 판매지표 분석 예약을 이어서 조회할까요?'))runMetricReservations(true);
    return;
  }
  const count=metricQueueSelection.size;
  if(!count){toast('지표분석할 키워드를 선택해 주세요.');return}
  if(await showAppConfirm(`선택한 ${count.toLocaleString()}개 키워드를 순차적으로 지표분석 예약할까요?`))runMetricReservations();
};
// 기존 안내 클릭 처리보다 먼저 실행해, 로그인된 경우 바로 재개합니다.
wingQueueDashboard.addEventListener('click',async event=>{
  const button=event.target.closest('[data-queue-resume]');
  if(!button)return;
  event.stopImmediatePropagation();
  const job=metricReservationJobs.find(item=>item.id===button.dataset.queueResume);
  if(!job||job.status!=='재개대기'||metricReservationRunning)return;
  const connected=await checkWingConnection();
  if(!connected){
    if(await showAppConfirm('쿠팡윙 로그인이 필요합니다. 크롬 시크릿 창에서 쿠팡 판매자센터 로그인 화면을 열까요?'))await openWingLoginWindow();
    return;
  }
  toast('저장된 예약 작업을 이어서 조회합니다.');
  runMetricReservations(true);
},true);
restoreActiveMetricReservationQueue();

// 선택 키워드 조회는 사용자가 직접 시작했을 때 지연 없이 바로 이어서 실행합니다.
runMetricReservations=async function(resume=false){
  if(metricReservationRunning)return;
  const emailSettings=readMetricEmailSettings();
  if((emailSettings.perKeyword||emailSettings.allComplete)&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailSettings.to)){
    toast('이메일 발송을 선택한 경우 올바른 수신 이메일을 입력하고 설정저장을 눌러 주세요.');return;
  }
  if(!resume){
    const keywords=[...metricQueueSelection];
    if(!keywords.length)return;
    metricReservationJobs=keywords.map(keyword=>({id:crypto.randomUUID(),keyword,status:'대기',productCount:0,processedCount:0,stopRequested:false}));
  }
  if(!metricReservationJobs.some(job=>job.status==='대기'||job.status==='재개대기'))return;
  const connected=await checkWingConnection();
  if(!connected)return;
  metricReservationRunning=true;metricReservationCancelled=false;metricReservationPaused=false;
  $('#metricQueueRun').disabled=true;$('#metricQueueCancel').disabled=false;renderWingQueueDashboard();
  let completedInBatch=0;
  const completedRecords=[];
  for(const job of metricReservationJobs){
    if(metricReservationCancelled)break;
    if(job.status!=='대기'&&job.status!=='재개대기')continue;
    job.status='조회중';job.stopRequested=false;job.processedCount=0;wingKeywordInput.value=job.keyword;
    metricQueueStatus.textContent=`“${job.keyword}” 상품을 준비 중`;
    renderWingQueueDashboard();
    const search=await wingMessage({kind:'WL_EXTERNAL_SEARCH',keyword:job.keyword,startPage:wingStartPage,endPage:wingEndPage});
    if(metricReservationCancelled)break;
    if(job.stopRequested){job.status='중단';renderWingQueueDashboard();continue}
    if(!search?.ok||!search.products?.length){
      job.status='재개대기';metricReservationPaused=true;metricReservationRunning=false;$('#metricQueueCancel').disabled=true;
      metricQueueStatus.textContent=`“${job.keyword}” 쿠팡 조회에 실패했습니다. 쿠팡에 다시 로그인한 뒤 재개를 눌러 주세요.`;
      wingStatus.textContent='쿠팡 조회 실패 · 재로그인 후 예약 리스트의 재개 버튼을 눌러 주세요.';
      renderWingQueueDashboard();toast('쿠팡 조회 실패로 예약을 일시정지했습니다. 자동 재시도하지 않습니다.');return;
    }
    job.productCount=search.products.length;job.processedCount=0;
    const token=++wingRunToken;wingRenderRows(search.products);
    wingResultTitle.textContent=`“${job.keyword}” · ${search.products.length}개 상품 분석 중`;
    renderWingQueueDashboard();await runWingMetrics(search.products,token);
    if(metricReservationCancelled)break;
    if(job.stopRequested||token!==wingRunToken){job.status='중단';renderWingQueueDashboard();continue}
    if(wingAccessError(wingStatus.textContent)){
      job.status='재개대기';metricReservationPaused=true;metricReservationRunning=false;$('#metricQueueCancel').disabled=true;
      metricQueueStatus.textContent=`“${job.keyword}” 조회가 일시정지되었습니다. 쿠팡에 다시 로그인한 뒤 재개를 눌러 주세요.`;
      renderWingQueueDashboard();toast('접근 제한으로 예약을 일시정지했습니다. 자동 재시도하지 않습니다.');return;
    }
    const record={id:crypto.randomUUID(),keyword:job.keyword,completedAt:new Date().toLocaleString('ko-KR'),products:captureWingProducts()};
    try{writeMetricHistory([record,...readMetricHistory()]);renderMetricHistory()}catch{
      job.status='중단';toast('분석 결과 저장 공간이 부족합니다. 목록을 정리한 뒤 다시 시도해 주세요.');renderWingQueueDashboard();break;
    }
    job.status='완료';completedRecords.push(record);completedInBatch+=1;metricQueueSelection.delete(job.keyword);
    updateMetricQueueSelection();renderWingQueueDashboard();
    if(emailSettings.perKeyword){try{await emailMetricHistory([record],`${job.keyword}_완료`);toast(`“${job.keyword}” 완료 결과를 이메일로 발송했습니다.`)}catch(error){toast(error.message||'완료 결과 이메일을 발송하지 못했습니다.')}}
    const hasNext=metricReservationJobs.some(item=>item.status==='대기'||item.status==='재개대기');
    if(hasNext){
      metricQueueStatus.textContent='다음 선택 키워드 조회를 즉시 시작합니다.';
      renderWingQueueDashboard();
      if(metricReservationCancelled)break;
    }
  }
  if(metricReservationCancelled)metricReservationJobs.forEach(job=>{if(job.status==='대기'||job.status==='조회중'||job.status==='재개대기')job.status='중단'});
  metricReservationRunning=false;$('#metricQueueCancel').disabled=true;
  const completed=metricReservationJobs.filter(job=>job.status==='완료').length,stopped=metricReservationJobs.filter(job=>job.status==='중단').length;
  if(emailSettings.allComplete&&completed===metricReservationJobs.length&&completedRecords.length){
    metricQueueStatus.textContent='예약목록 전체 완료 · 이메일 발송 중';
    try{await emailMetricHistory(completedRecords,'예약목록_전체완료');toast('예약목록 전체 완료 결과를 이메일로 발송했습니다.')}catch(error){toast(error.message||'전체 완료 결과 이메일을 발송하지 못했습니다.')}
  }
  metricQueueStatus.textContent=`지표분석 예약 ${metricReservationCancelled?'중단':'완료'} · 완료 ${completed}개 · 중단 ${stopped}개`;
  $('#metricQueueRun').disabled=!metricQueueSelection.size;renderWingQueueDashboard();renderMetricHistory();
};

// 판매지표 분석예약은 목록에만 추가하고, 사용자가 선택해 조회할 때 실행합니다.
const metricManualJobSelection=window.metricManualJobSelection instanceof Set?window.metricManualJobSelection:new Set();
window.metricManualJobSelection=metricManualJobSelection;
// 사용자가 직접 선택해 시작한 실행은 선택된 예약 ID만 처리합니다.
let metricManualRunIds=null;
let metricCompletedJobsExpanded=window.sourcingJudgeCollapseState.get('metricCompletedJobsExpanded',false);
function metricScheduleLabel(value){
  if(!value)return '예약일시 미설정';
  const date=new Date(value);
  return Number.isNaN(date.getTime())?'예약일시 미설정':date.toLocaleString('ko-KR',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
}
function metricQueueDisplayStatus(job){
  if(job.status==='예약대기')return job.scheduledAt?'예약됨':'대기';
  if(job.status==='재개대기')return '재개 대기';
  return job.status||'대기';
}
function renderMetricReservationSelectionQueue(){
  writeActiveMetricReservationQueue();
  if(!metricReservationJobs.length){wingQueueDashboard.hidden=true;return}
  const indexedJobs=metricReservationJobs.map((job,index)=>({job,index}));
  const completedJobs=indexedJobs.filter(({job})=>job.status==='완료');
  const visibleJobs=indexedJobs.filter(({job})=>job.status!=='완료'||metricCompletedJobsExpanded);
  // 중단된 키워드는 사용자가 체크해 즉시 다시 조회할 수 있습니다. 완료된 항목만 제외합니다.
  const selectableJobs=indexedJobs.filter(({job})=>job.status!=='완료');
  const activeJobs=metricReservationJobs.filter(job=>job.status==='대기'||job.status==='조회중'||job.status==='재개대기').length;
  const selectedCount=selectableJobs.filter(({job})=>metricManualJobSelection.has(job.id)).length;
  const allSelected=selectableJobs.length>0&&selectableJobs.every(({job})=>metricManualJobSelection.has(job.id));
  wingQueueDashboard.hidden=false;
  wingQueueDashboard.innerHTML=`<div class="wing-queue-summary"><span><b>총 예약건수</b><strong>${metricReservationJobs.length}개</strong></span><span><b>선택 키워드</b><strong>${selectedCount}개</strong></span><span><b>조회 진행</b><strong>${activeJobs}개</strong></span><span><b>안내</b><strong>체크 후 조회</strong></span></div><div class="wing-queue-actions"><div class="wing-queue-selection-actions"><label><input type="checkbox" data-metric-job-select-all ${allSelected?'checked':''}> 전체선택</label><button type="button" class="outline" data-metric-job-run ${selectedCount?'':'disabled'}>선택 키워드 조회</button><button type="button" class="outline" data-metric-job-clear>선택 해제</button><button type="button" class="stop" data-metric-job-delete-all ${selectedCount?'':'disabled'}>예약리스트 삭제</button></div>${completedJobs.length?`<div class="wing-queue-completed-actions"><button type="button" class="outline wing-queue-completed-toggle" data-metric-completed-toggle aria-expanded="${metricCompletedJobsExpanded}">${metricCompletedJobsExpanded?'완료 목록 접기':'완료 목록 펼치기'} (${completedJobs.length}개)</button></div>`:''}</div><div class="wing-queue-list"><div class="wing-queue-list-title"><strong>판매지표분석 예약 리스트</strong></div><div class="wing-queue-list-head"><span>선택</span><span>순번</span><span>키워드</span><span>조회 예약일시</span><span>진행상황</span><span>관리</span></div>${!metricCompletedJobsExpanded&&completedJobs.length?`<p class="wing-completed-collapsed">완료된 예약 ${completedJobs.length}개가 접혀 있습니다.</p>`:''}${visibleJobs.map(({job,index})=>`<div class="wing-queue-job metric-manual-job"><label><input type="checkbox" data-metric-job-check value="${clean(job.id)}" ${metricManualJobSelection.has(job.id)?'checked':''} ${job.status==='완료'?'disabled':''}></label><span>${index+1}</span><b title="${clean(job.keyword)}">${clean(job.keyword)}</b><span>${metricScheduleLabel(job.scheduledAt)}</span><em class="${clean(job.status)}">${metricQueueDisplayStatus(job)}</em><span class="metric-job-actions"><button type="button" class="outline" data-metric-job-schedule="${clean(job.id)}" ${job.status==='완료'||job.status==='중단'?'disabled':''}>예약일시 설정</button>${job.scheduledAt&&job.status!=='완료'&&job.status!=='중단'?`<button type="button" class="outline" data-metric-job-unschedule="${clean(job.id)}">해제</button>`:''}</span></div>`).join('')}</div>`;
}
renderWingQueueDashboard=renderMetricReservationSelectionQueue;
$('#metricQueueRun').onclick=async()=>{
  const keywords=[...metricQueueSelection].filter(Boolean);
  if(!keywords.length){toast('소싱판별 결과에서 예약할 키워드를 선택해 주세요.');return}
  const existing=new Set(metricReservationJobs.map(job=>job.keyword));
  const additions=[...new Set(keywords)].filter(keyword=>!existing.has(keyword));
  if(!additions.length){toast('선택한 키워드는 이미 판매지표 분석예약 목록에 있습니다.');return}
  metricReservationJobs.push(...additions.map(keyword=>({id:crypto.randomUUID(),keyword,status:'예약대기',productCount:0,processedCount:0,scheduledAt:'',startPage:wingStartPage,endPage:wingEndPage,stopRequested:false})));
  metricQueueSelection.clear();updateMetricQueueSelection();
  metricQueueStatus.textContent=`${additions.length.toLocaleString()}개 키워드를 판매지표 분석예약 목록에 추가했습니다. 체크 후 조회를 누르면 실행합니다.`;
  renderMetricReservationSelectionQueue();toast('판매지표 분석예약 목록에 추가했습니다.');
};
wingQueueDashboard.addEventListener('change',event=>{
  const all=event.target.closest('[data-metric-job-select-all]');
  if(all){
    metricReservationJobs.forEach(job=>{if(job.status!=='완료'){if(all.checked)metricManualJobSelection.add(job.id);else metricManualJobSelection.delete(job.id)}});
    renderMetricReservationSelectionQueue();return;
  }
  const checkbox=event.target.closest('[data-metric-job-check]');
  if(!checkbox)return;
  if(checkbox.checked)metricManualJobSelection.add(checkbox.value);else metricManualJobSelection.delete(checkbox.value);
  renderMetricReservationSelectionQueue();
});
wingQueueDashboard.addEventListener('click',async event=>{
  if(event.target.closest('[data-metric-completed-toggle]')){
    metricCompletedJobsExpanded=!metricCompletedJobsExpanded;window.sourcingJudgeCollapseState.set('metricCompletedJobsExpanded',metricCompletedJobsExpanded);
    renderMetricReservationSelectionQueue();return;
  }
  if(event.target.closest('[data-metric-job-delete-all]')){
    if(metricReservationRunning){toast('조회 중에는 예약리스트를 삭제할 수 없습니다. 먼저 중단해 주세요.');return}
    const selectedIds=new Set([...metricManualJobSelection]);
    const selectedJobs=metricReservationJobs.filter(job=>selectedIds.has(job.id));
    if(!selectedJobs.length){toast('삭제할 예약 키워드를 선택해 주세요.');return}
    if(!await showAppConfirm(`선택한 판매지표 분석예약 ${selectedJobs.length.toLocaleString()}개를 삭제할까요?`))return;
    selectedJobs.forEach(job=>wingRuntimeDelete(wingCheckpointKey(job.id)).catch(()=>{}));
    metricReservationJobs=metricReservationJobs.filter(job=>!selectedIds.has(job.id));
    metricManualJobSelection.clear();
    metricManualRunIds=null;
    if(metricReservationJobs.length)writeActiveMetricReservationQueue();else clearActiveMetricReservationQueue();
    metricQueueStatus.textContent=`선택한 예약 ${selectedJobs.length.toLocaleString()}개를 삭제했습니다.`;
    toast('선택한 판매지표 분석예약을 삭제했습니다.');
    renderMetricReservationSelectionQueue();
    return;
  }
  const runButton=event.target.closest('[data-metric-job-run]');
  if(runButton){
    if(metricReservationRunning){toast('판매지표 분석이 이미 실행 중입니다.');return}
    const selected=metricReservationJobs.filter(job=>metricManualJobSelection.has(job.id)&&job.status!=='완료');
    if(!selected.length){toast('조회할 키워드를 선택해 주세요.');return}
    const circuitUnlocked=unlockWingCircuitForManualRetry();
    metricManualRunIds=new Set(selected.map(job=>job.id));
    selected.forEach(job=>{job.status='대기';job.scheduledAt=''});
    metricQueueStatus.textContent=circuitUnlocked
      ?`선택한 ${selected.length.toLocaleString()}개 키워드의 재조회 차단을 해제하고 즉시 시작합니다.`
      :`선택한 ${selected.length.toLocaleString()}개 키워드 조회를 즉시 시작합니다.`;
    renderMetricReservationSelectionQueue();
    runMetricReservations(true);return;
  }
  if(event.target.closest('[data-metric-job-clear]')){metricManualJobSelection.clear();renderMetricReservationSelectionQueue();return}
  const scheduleButton=event.target.closest('[data-metric-job-schedule]');
  if(scheduleButton){
    const job=metricReservationJobs.find(item=>item.id===scheduleButton.dataset.metricJobSchedule);if(!job)return;
    const initial=job.scheduledAt?new Date(job.scheduledAt).toISOString().slice(0,16):'';
    const input=prompt('조회 예약일시를 입력해 주세요.\n예: 2026-07-28 14:30',initial.replace('T',' '));
    if(input===null)return;
    const date=new Date(input.trim().replace(' ','T'));
    if(Number.isNaN(date.getTime())||date.getTime()<=Date.now()){toast('현재보다 미래의 날짜와 시간을 입력해 주세요.');return}
    job.scheduledAt=date.toISOString();job.status='예약대기';metricManualJobSelection.delete(job.id);
    metricQueueStatus.textContent=`“${job.keyword}” 조회 예약일시를 ${metricScheduleLabel(job.scheduledAt)}로 설정했습니다.`;
    renderMetricReservationSelectionQueue();return;
  }
  const unscheduleButton=event.target.closest('[data-metric-job-unschedule]');
  if(unscheduleButton){const job=metricReservationJobs.find(item=>item.id===unscheduleButton.dataset.metricJobUnschedule);if(!job)return;job.scheduledAt='';job.status='예약대기';renderMetricReservationSelectionQueue();toast('조회 예약일시를 해제했습니다.')}
});
// 예약일시는 목록 관리용으로만 보관합니다. 조회는 사용자가 체크 후 직접 시작할 때만 실행합니다.
renderMetricReservationSelectionQueue();

/* --------------------------------------------------------------------------
 * 윙렌즈 안정 실행 계층
 * - 같은 브라우저의 중복 실행과 확장프로그램의 동시 실행을 차단합니다.
 * - 접근 제한은 브라우저 재시작 후에도 유지되는 회로 차단기로 즉시 멈춥니다.
 * - 상품별 체크포인트와 단계별 캐시로 완료 상품을 다시 요청하지 않습니다.
 * -------------------------------------------------------------------------- */
const wingCircuitStorageKey='wing-lens-circuit-breaker-v2';
const wingExecutionLeaseKey='wing-lens-execution-lease-v2';
const wingExecutionLockName='wing-lens-global-execution-v2';
const wingExecutionOwnerId=sessionStorage.getItem('wing-lens-execution-owner-v2')||crypto.randomUUID();
sessionStorage.setItem('wing-lens-execution-owner-v2',wingExecutionOwnerId);
const wingRuntimeDbName='wing-lens-runtime-v2';
const wingRuntimeStoreName='entries';
const wingCacheTtl={search:12*60*60*1000,shipping:7*24*60*60*1000,metric:24*60*60*1000,metricEmpty:6*60*60*1000};
const wingRemoteProductDelayMs=10000;
let wingActiveExtensionOwnerToken='';
let wingExecutionLeaseLost=false;

function wingFailureText(value){
  if(value===null||value===undefined)return '';
  if(typeof value==='string')return value;
  if(value instanceof Error)return `${value.name||''} ${value.message||''}`;
  try{return JSON.stringify(value)}catch{return String(value)}
}
function classifyWingFailure(value){
  const text=wingFailureText(value);
  const code=String(value&&typeof value==='object'?(value.code||value.error?.code||''):'').toLowerCase();
  const status=Number(value&&typeof value==='object'?(value.status||value.error?.status||0):0);
  const retryAt=Number(value&&typeof value==='object'?(value.retryAt||value.error?.retryAt||0):0);
  if(!text)return {kind:'none',critical:false,cooldownMs:0,reason:'',text};
  if(/PV\s*또는\s*판매량\s*필드가\s*없|응답에\s*PV|데이터가\s*없/i.test(text))return {kind:'data_empty',critical:false,cooldownMs:0,reason:'지표 데이터 없음',text};
  if(status===429||code==='rate_limited'||code==='too_many_requests'||/HTTP\s*429|\b429\b|too\s*many|rate\s*limit|요청\s*(횟수|속도|량)?.*제한/i.test(text))return {kind:'rate_429',critical:true,cooldownMs:60*60*1000,retryAt,reason:'쿠팡 요청량 제한(429)',text};
  if(status===403||code==='access_denied'||code==='forbidden'||/HTTP\s*403|\b403\b|access[_\s-]*denied|permission\s*to\s*access|errors\.edgesuite\.net|사용권한이\s*없|접근.*(차단|거부|제한)|요청하신\s*페이지/i.test(text))return {kind:'blocked_403',critical:true,cooldownMs:30*60*1000,retryAt,reason:'쿠팡 접근 제한(403/Access Denied)',text};
  if(status===401||code==='unauthorized'||code==='auth_required'||/HTTP\s*401|\b401\b|unauthorized|login\.coupang\.com|로그인\s*(페이지|화면|필요|만료)|세션.*(만료|없)|재로그인|JSON\s*형식으로\s*응답하지\s*않/i.test(text))return {kind:'auth_401',critical:true,cooldownMs:5*60*1000,retryAt,reason:'쿠팡윙 로그인 세션 확인 필요',text};
  if(/extension\s*context\s*invalidated|확장프로그램.*(연결|컨텍스트)|receiving\s*end\s*does\s*not\s*exist/i.test(text))return {kind:'extension',critical:false,cooldownMs:0,reason:'윙렌즈 확장프로그램 연결 오류',text};
  if(/run_locked|run_lease_lost|실행권.*(만료|변경)|다른\s*화면.*실행\s*중/i.test(text))return {kind:'locked',critical:false,cooldownMs:0,reason:'다른 윙렌즈 화면에서 조회 중',text};
  if(/failed\s*to\s*fetch|network|timeout|timed\s*out|abort|응답이\s*없|요청\s*실패/i.test(text))return {kind:'transient',critical:false,cooldownMs:0,reason:'일시적인 네트워크 오류',text};
  return {kind:'other',critical:false,cooldownMs:0,reason:text.slice(0,120)||'조회 실패',text};
}
function readWingCircuit(){
  try{
    const value=JSON.parse(localStorage.getItem(wingCircuitStorageKey)||'null');
    if(!value||!['open','half-open'].includes(value.state))return {state:'closed',nextAllowedAt:0,reason:'',kind:''};
    return value;
  }catch{return {state:'closed',nextAllowedAt:0,reason:'',kind:''}}
}
function writeWingCircuit(value){
  if(!value||value.state==='closed'){localStorage.removeItem(wingCircuitStorageKey);return}
  localStorage.setItem(wingCircuitStorageKey,JSON.stringify(value));
}
function wingCircuitTime(value){
  return new Date(Number(value)||Date.now()).toLocaleString('ko-KR',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
}
function openWingCircuit(failure,context='판매지표 조회'){
  const now=Date.now(),current=readWingCircuit(),reportedRetryAt=Number(failure.retryAt)||0;
  const candidateRetryAt=reportedRetryAt>now?reportedRetryAt:now+(failure.cooldownMs||30*60*1000);
  const nextAllowedAt=Math.max(Number(current.nextAllowedAt)||0,candidateRetryAt);
  const circuit={state:'open',kind:failure.kind,reason:failure.reason,detail:failure.text.slice(0,500),context,openedAt:now,nextAllowedAt};
  writeWingCircuit(circuit);
  wingRunToken++;
  metricReservationPaused=true;
  metricReservationJobs.forEach(job=>{if(job.status==='조회중')job.status='재개대기'});
  metricReservationRunning=false;
  $('#metricQueueCancel').disabled=true;
  wingRunButton.disabled=false;wingStopButton.disabled=true;wingLedgerStopButton.disabled=true;
  const message=`${failure.reason} 감지 · ${wingCircuitTime(nextAllowedAt)} 이후 한 상품 시험 조회가 가능합니다.`;
  wingStatus.textContent=message;
  metricQueueStatus.textContent=message;
  renderWingQueueDashboard();
  toast('접근 제한을 감지해 모든 쿠팡 조회를 즉시 중단했습니다.');
  return circuit;
}
function wingCircuitPermission(){
  const circuit=readWingCircuit(),now=Date.now();
  if(circuit.state==='closed')return {allowed:true,state:'closed'};
  if(circuit.state==='open'&&now<Number(circuit.nextAllowedAt||0)){
    return {allowed:false,state:'open',circuit,message:`${circuit.reason}으로 대기 중입니다. ${wingCircuitTime(circuit.nextAllowedAt)} 이후 다시 확인해 주세요.`};
  }
  if(circuit.state==='open'){
    const halfOpen={...circuit,state:'half-open',probeStartedAt:now};
    writeWingCircuit(halfOpen);
    return {allowed:true,state:'half-open',circuit:halfOpen,message:'대기시간이 끝나 한 상품만 시험 조회합니다.'};
  }
  return {allowed:true,state:'half-open',circuit};
}
function closeWingCircuit(){
  const previous=readWingCircuit();
  if(previous.state==='closed')return;
  writeWingCircuit({state:'closed'});
  wingStatus.textContent='시험 상품 조회가 정상 완료되어 판매지표 조회를 재개합니다.';
  toast('접근 제한 시험 조회가 성공해 회로 차단을 해제했습니다.');
}
function showWingCircuitBlock(gate){
  const message=gate?.message||'쿠팡 접근 제한 대기 중입니다.';
  wingStatus.textContent=message;metricQueueStatus.textContent=message;toast(message);
}
function unlockWingCircuitForManualRetry(){
  const circuit=readWingCircuit();
  if(circuit.state==='closed')return false;
  writeWingCircuit({state:'closed'});
  wingStatus.textContent='사용자가 직접 재시도를 선택해 조회 대기를 해제했습니다.';
  return true;
}

function openWingRuntimeDb(){
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(wingRuntimeDbName,1);
    request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(wingRuntimeStoreName))request.result.createObjectStore(wingRuntimeStoreName,{keyPath:'key'})};
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
}
async function wingRuntimeGet(key){
  const db=await openWingRuntimeDb();
  return new Promise((resolve,reject)=>{
    const transaction=db.transaction(wingRuntimeStoreName,'readonly'),request=transaction.objectStore(wingRuntimeStoreName).get(key);
    request.onsuccess=()=>{db.close();resolve(request.result||null)};
    request.onerror=()=>{db.close();reject(request.error)};
  });
}
async function wingRuntimePut(key,value,expiresAt=0){
  const db=await openWingRuntimeDb();
  return new Promise((resolve,reject)=>{
    const transaction=db.transaction(wingRuntimeStoreName,'readwrite');
    transaction.objectStore(wingRuntimeStoreName).put({key,value,expiresAt:Number(expiresAt)||0,updatedAt:Date.now()});
    transaction.oncomplete=()=>{db.close();resolve()};
    transaction.onerror=()=>{db.close();reject(transaction.error)};
  });
}
async function wingRuntimeDelete(key){
  const db=await openWingRuntimeDb();
  return new Promise((resolve,reject)=>{
    const transaction=db.transaction(wingRuntimeStoreName,'readwrite');
    transaction.objectStore(wingRuntimeStoreName).delete(key);
    transaction.oncomplete=()=>{db.close();resolve()};
    transaction.onerror=()=>{db.close();reject(transaction.error)};
  });
}
async function readWingCache(key){
  try{
    const entry=await wingRuntimeGet(`cache:${key}`);
    if(!entry)return null;
    if(entry.expiresAt&&entry.expiresAt<=Date.now()){wingRuntimeDelete(`cache:${key}`).catch(()=>{});return null}
    return entry.value;
  }catch(error){console.warn('윙렌즈 캐시를 읽지 못했습니다.',error);return null}
}
function writeWingCache(key,value,ttl){
  return wingRuntimePut(`cache:${key}`,value,Date.now()+ttl).catch(error=>console.warn('윙렌즈 캐시를 저장하지 못했습니다.',error));
}
function wingProductKey(product,index=0){
  const productId=String(product?.productId||'').trim();
  if(productId)return productId;
  const url=String(product?.url||'').trim(),urlId=url.match(/\/vp\/products\/(\d+)/)?.[1];
  return urlId||url||`${String(product?.name||'상품').trim()}#${index}`;
}
function dedupeWingProducts(products){
  const seen=new Set();
  return (Array.isArray(products)?products:[]).filter((product,index)=>{const key=wingProductKey(product,index);if(seen.has(key))return false;seen.add(key);return true});
}
function wingSearchCacheKey(keyword,startPage,endPage){
  return `search:${startPage}:${endPage}:${String(keyword||'').trim().toLocaleLowerCase('ko-KR')}`;
}
function wingCheckpointKey(jobId){return `checkpoint:${jobId}`}
function wingFilterSignature(){
  return JSON.stringify({delivery:selectedWingDeliveryTypes().slice().sort(),review:selectedWingReviewFilter()});
}
function wingJobPages(job){
  const startPage=Math.max(1,Number(job?.startPage)||wingStartPage),endPage=Math.max(startPage,Number(job?.endPage)||wingEndPage);
  return {startPage,endPage};
}
function blankWingCheckpoint(job){
  const {startPage,endPage}=wingJobPages(job);
  return {version:2,jobId:job.id,keyword:job.keyword,startPage,endPage,filterSignature:wingFilterSignature(),products:[],completedIds:[],results:{},nextIndex:0,updatedAt:Date.now()};
}
async function readWingCheckpoint(job){
  try{
    const entry=await wingRuntimeGet(wingCheckpointKey(job.id)),checkpoint=entry?.value;
    const {startPage,endPage}=wingJobPages(job);
    if(!checkpoint||checkpoint.keyword!==job.keyword||checkpoint.startPage!==startPage||checkpoint.endPage!==endPage)return blankWingCheckpoint(job);
    if(checkpoint.filterSignature!==wingFilterSignature())return {...blankWingCheckpoint(job),products:dedupeWingProducts(checkpoint.products)};
    checkpoint.completedIds=Array.isArray(checkpoint.completedIds)?checkpoint.completedIds:[];
    checkpoint.results=checkpoint.results&&typeof checkpoint.results==='object'?checkpoint.results:{};
    checkpoint.products=dedupeWingProducts(checkpoint.products);
    return checkpoint;
  }catch(error){console.warn('상품별 체크포인트를 읽지 못했습니다.',error);return blankWingCheckpoint(job)}
}
async function writeWingCheckpoint(checkpoint){
  checkpoint.updatedAt=Date.now();
  try{await wingRuntimePut(wingCheckpointKey(checkpoint.jobId),checkpoint)}catch(error){console.warn('상품별 체크포인트를 저장하지 못했습니다.',error)}
}
function applyWingProductResult(row,result){
  if(!row||!result)return;
  const deliveryMethod=result.deliveryMethod||'-',deliveryType=normalizeWingDeliveryType(deliveryMethod);
  row.children[4].textContent=deliveryMethod;
  row.children[4].classList.toggle('wing-delivery-overseas',deliveryType==='해외');
  row.children[4].classList.toggle('wing-delivery-rocket',deliveryType==='로켓');
  row.children[5].textContent=result.pv??'-';
  row.children[6].textContent=result.sales??'-';
  row.children[7].textContent=result.revenue??'-';
  row.children[8].textContent=result.conversion??'-';
}
function restoreWingCheckpointRows(products,checkpoint){
  products.forEach((product,index)=>applyWingProductResult(wingResultBody.querySelector(`[data-wing-index="${index}"]`),checkpoint.results?.[wingProductKey(product,index)]));
  updateWingSummary();
}
async function completeWingCheckpointProduct({checkpoint,job,product,index,result}){
  const key=wingProductKey(product,index),completed=new Set(checkpoint.completedIds||[]);
  completed.add(key);checkpoint.completedIds=[...completed];checkpoint.results[key]=result;
  checkpoint.nextIndex=checkpoint.products.findIndex((item,itemIndex)=>!completed.has(wingProductKey(item,itemIndex)));
  if(checkpoint.nextIndex<0)checkpoint.nextIndex=checkpoint.products.length;
  job.processedCount=completed.size;job.productCount=checkpoint.products.length;
  applyWingProductResult(wingResultBody.querySelector(`[data-wing-index="${index}"]`),result);
  if(!checkpoint.transient)await writeWingCheckpoint(checkpoint);
  renderWingQueueDashboard();updateWingSummary();
}

function readWingLocalLease(){
  try{return JSON.parse(localStorage.getItem(wingExecutionLeaseKey)||'null')}catch{return null}
}
function acquireWingLocalLease(ownerToken){
  const now=Date.now(),current=readWingLocalLease();
  if(current&&current.ownerToken!==ownerToken&&Number(current.expiresAt)>now)return false;
  localStorage.setItem(wingExecutionLeaseKey,JSON.stringify({ownerToken,ownerId:wingExecutionOwnerId,expiresAt:now+30000,updatedAt:now}));
  return readWingLocalLease()?.ownerToken===ownerToken;
}
function refreshWingLocalLease(ownerToken){
  const current=readWingLocalLease();
  if(current?.ownerToken!==ownerToken)return false;
  localStorage.setItem(wingExecutionLeaseKey,JSON.stringify({...current,expiresAt:Date.now()+30000,updatedAt:Date.now()}));
  return true;
}
function releaseWingLocalLease(ownerToken){
  if(readWingLocalLease()?.ownerToken===ownerToken)localStorage.removeItem(wingExecutionLeaseKey);
}
async function beginWingExtensionLease(ownerToken,source){
  const result=await wingMessage({kind:'WL_EXTERNAL_BEGIN_RUN',ownerToken,source,ttlMs:120000});
  if(result?.ok)return {ok:true,supported:true};
  if(/지원하지 않는 요청|not supported|unknown/i.test(String(result?.error||'')))return {ok:true,supported:false};
  return {ok:false,supported:true,error:result?.error||'다른 윙렌즈 화면에서 이미 조회 중입니다.'};
}
async function endWingExtensionLease(ownerToken,supported){
  if(!supported)return;
  try{await wingMessage({kind:'WL_EXTERNAL_END_RUN',ownerToken})}catch{}
}
async function withWingExecutionLock(source,task){
  const ownerToken=`${wingExecutionOwnerId}:${crypto.randomUUID()}`;
  const execute=async()=>{
    const extensionLease=await beginWingExtensionLease(ownerToken,source);
    if(!extensionLease.ok){toast(extensionLease.error);metricQueueStatus.textContent=extensionLease.error;return {status:'busy'}}
    wingActiveExtensionOwnerToken=ownerToken;
    wingExecutionLeaseLost=false;
    let heartbeatActive=true;
    const heartbeat=extensionLease.supported?setInterval(async()=>{
      const result=await wingMessage({kind:'WL_EXTERNAL_HEARTBEAT_RUN',ownerToken,ttlMs:120000});
      if(!heartbeatActive||result?.ok||wingExecutionLeaseLost)return;
      wingExecutionLeaseLost=true;wingRunToken++;
      metricReservationJobs.forEach(job=>{if(job.status==='조회중')job.status='재개대기'});
      metricReservationPaused=true;
      const message=result?.error||'판매지표 분석 실행권이 만료되었습니다.';
      wingStatus.textContent=message;metricQueueStatus.textContent=message;renderWingQueueDashboard();toast(message);
    },20000):0;
    try{return await task(ownerToken)}
    finally{heartbeatActive=false;if(heartbeat)clearInterval(heartbeat);wingActiveExtensionOwnerToken='';await endWingExtensionLease(ownerToken,extensionLease.supported)}
  };
  if(navigator.locks?.request){
    return navigator.locks.request(wingExecutionLockName,{ifAvailable:true},async lock=>{
      if(!lock){toast('다른 창에서 판매지표 조회가 이미 실행 중입니다.');return {status:'busy'}}
      return execute();
    });
  }
  if(!acquireWingLocalLease(ownerToken)){toast('다른 창에서 판매지표 조회가 이미 실행 중입니다.');return {status:'busy'}}
  const keepAlive=setInterval(()=>refreshWingLocalLease(ownerToken),10000);
  try{return await execute()}finally{clearInterval(keepAlive);releaseWingLocalLease(ownerToken)}
}
function wingExecutionMessage(payload){
  return wingMessage(wingActiveExtensionOwnerToken?{...payload,ownerToken:wingActiveExtensionOwnerToken}:payload);
}

checkWingConnection=async function(){
  const result=await wingMessage({kind:'WL_EXTERNAL_STATUS'});
  const tabCount=Number(result?.tabCount??result?.wingTabCount??0);
  if(result?.code==='multiple_wing_tabs'||tabCount>1){
    wingConnection.textContent='쿠팡윙 탭 정리 필요';
    wingConnection.className='problem';
    wingStatus.textContent=`시크릿 쿠팡윙 탭이 ${tabCount}개 열려 있습니다. 1개만 남긴 뒤 로그인 완료 확인을 눌러 주세요.`;
    return false;
  }
  if(result?.loggedIn){
    wingConnection.textContent='윙렌즈 연결됨 · 쿠팡윙 로그인 확인';
    wingConnection.className='connected';
    wingStatus.textContent='쿠팡윙 로그인 상태를 한 번 확인했습니다.';
    const circuit=readWingCircuit();
    if(circuit.state==='open'&&circuit.kind==='auth_401')writeWingCircuit({...circuit,state:'half-open',nextAllowedAt:Date.now()});
    return true;
  }
  const failure=classifyWingFailure(result);
  if(failure.critical&&failure.kind!=='auth_401')openWingCircuit(failure,'로그인 상태 확인');
  wingConnection.textContent='윙렌즈 로그인 필요';
  wingConnection.className='problem';
  wingStatus.textContent=result?.error||'윙렌즈 확장프로그램을 설치하고 시크릿 쿠팡윙 로그인을 완료해 주세요.';
  return false;
};

async function loadWingSearchProducts(keyword,checkpoint=null,job=null){
  const {startPage,endPage}=wingJobPages(job);
  if(checkpoint?.products?.length)return {ok:true,products:checkpoint.products,from:'checkpoint'};
  const cacheKey=wingSearchCacheKey(keyword,startPage,endPage),cached=await readWingCache(cacheKey);
  if(Array.isArray(cached?.products)&&cached.products.length)return {ok:true,products:dedupeWingProducts(cached.products),from:'cache'};
  const result=await wingExecutionMessage({kind:'WL_EXTERNAL_SEARCH',keyword,startPage,endPage});
  if(!result?.ok||!Array.isArray(result.products)||!result.products.length)return {ok:false,error:result?.error||'쿠팡 검색 결과가 없습니다.',failure:classifyWingFailure(result)};
  const products=dedupeWingProducts(result.products);
  await writeWingCache(cacheKey,{products},wingCacheTtl.search);
  return {ok:true,products,from:'remote'};
}

runWingMetrics=async function(products,token,options={}){
  const selectedTypes=selectedWingDeliveryTypes(),reviewFilter=selectedWingReviewFilter(),filterDescription=selectedTypes.length?selectedTypes.join(' · '):'전체';
  const job=options.job||{id:`manual:${Date.now()}`,keyword:wingKeywordInput.value.trim(),productCount:products.length,processedCount:0};
  const checkpoint=options.checkpoint||{...blankWingCheckpoint(job),products,transient:true};
  checkpoint.products=dedupeWingProducts(products);
  const completed=new Set(checkpoint.completedIds||[]);
  restoreWingCheckpointRows(checkpoint.products,checkpoint);
  job.productCount=checkpoint.products.length;job.processedCount=completed.size;renderWingQueueDashboard();
  for(let index=0;index<checkpoint.products.length;index++){
    if(token!==wingRunToken||metricReservationCancelled||job.stopRequested)return {status:'cancelled',checkpoint};
    const product=checkpoint.products[index],productKey=wingProductKey(product,index);
    if(completed.has(productKey))continue;
    const gate=wingCircuitPermission();
    if(!gate.allowed){showWingCircuitBlock(gate);return {status:'blocked',checkpoint}}
    const halfOpenProbe=gate.state==='half-open';
    let madeRemoteRequest=false;
    if(!matchesWingReviewFilter(product)){
      const label=reviewFilter?`리뷰 ${reviewFilter.operator==='gte'?'이상':'이하'} ${wingNumber(reviewFilter.value)}건 제외`:'리뷰 조건 제외';
      const result={status:'review_excluded',deliveryMethod:'리뷰 조건 제외',pv:label,sales:'-',revenue:'-',conversion:'-'};
      wingStatus.textContent=`${index+1} / ${checkpoint.products.length} · ${label} · 상세 조회 없이 다음 상품으로 이동합니다.`;
      await completeWingCheckpointProduct({checkpoint,job,product,index,result});completed.add(productKey);continue;
    }
    wingStatus.textContent=`${index+1} / ${checkpoint.products.length} · 배송유형 확인 후 ${filterDescription} 판매지표를 조회 중입니다.`;
    const shippingCacheKey=`shipping:${productKey}`;
    let shipping=await readWingCache(shippingCacheKey);
    if(!shipping){
      shipping=await wingExecutionMessage({kind:'WL_EXTERNAL_SHIPPING',productUrl:product.url,productId:product.productId});
      madeRemoteRequest=true;
      if(!shipping?.ok){
        const failure=classifyWingFailure(shipping);
        checkpoint.nextIndex=index;if(!checkpoint.transient)await writeWingCheckpoint(checkpoint);
        if(failure.critical){openWingCircuit(failure,`${job.keyword} · 배송정보`);return {status:'blocked',failure,checkpoint}}
        wingStatus.textContent=`배송정보 조회를 일시정지했습니다. ${failure.reason}`;
        return {status:'paused',failure,checkpoint};
      }
      await writeWingCache(shippingCacheKey,shipping,wingCacheTtl.shipping);
    }
    const deliveryMethod=shipping.shippingMethod||'-',deliveryType=normalizeWingDeliveryType(deliveryMethod);
    if(selectedTypes.length&&!selectedTypes.includes(deliveryType)){
      const result={status:'delivery_excluded',deliveryMethod,pv:'유형 제외',sales:'-',revenue:'-',conversion:'-'};
      await completeWingCheckpointProduct({checkpoint,job,product,index,result});completed.add(productKey);
      if(halfOpenProbe&&madeRemoteRequest)closeWingCircuit();
      if(madeRemoteRequest&&index<checkpoint.products.length-1)await new Promise(resolve=>setTimeout(resolve,wingRemoteProductDelayMs));
      continue;
    }
    const metricCacheKey=`metric:${productKey}`;
    let metric=await readWingCache(metricCacheKey);
    if(!metric){
      metric=await wingExecutionMessage({kind:'WL_EXTERNAL_METRIC',productId:product.productId});
      madeRemoteRequest=true;
      if(!metric?.ok||!metric.item){
        const failure=classifyWingFailure(metric);
        checkpoint.nextIndex=index;if(!checkpoint.transient)await writeWingCheckpoint(checkpoint);
        if(failure.kind==='data_empty'){
          const result={status:'data_empty',deliveryMethod,pv:'데이터 없음',sales:'-',revenue:'-',conversion:'-'};
          await writeWingCache(metricCacheKey,{ok:true,dataEmpty:true},wingCacheTtl.metricEmpty);
          await completeWingCheckpointProduct({checkpoint,job,product,index,result});completed.add(productKey);
          if(halfOpenProbe&&madeRemoteRequest)closeWingCircuit();
          if(madeRemoteRequest&&index<checkpoint.products.length-1)await new Promise(resolve=>setTimeout(resolve,wingRemoteProductDelayMs));
          continue;
        }
        if(failure.critical){openWingCircuit(failure,`${job.keyword} · 쿠팡윙 지표`);return {status:'blocked',failure,checkpoint}}
        wingStatus.textContent=`판매지표 조회를 일시정지했습니다. ${failure.reason}`;
        return {status:'paused',failure,checkpoint};
      }
      await writeWingCache(metricCacheKey,metric,wingCacheTtl.metric);
    }
    const item=metric.item;
    const result=metric.dataEmpty
      ?{status:'data_empty',deliveryMethod,pv:'데이터 없음',sales:'-',revenue:'-',conversion:'-'}
      :{status:'complete',deliveryMethod,pv:wingNumber(item?.pvLast28Day),sales:wingNumber(item?.salesLast28d),revenue:wingRevenue(item?.salesLast28d,item?.salePrice||shipping.price),conversion:wingConversion(item?.salesLast28d,item?.pvLast28Day)};
    await completeWingCheckpointProduct({checkpoint,job,product,index,result});completed.add(productKey);
    if(halfOpenProbe&&madeRemoteRequest)closeWingCircuit();
    if(madeRemoteRequest&&index<checkpoint.products.length-1)await new Promise(resolve=>setTimeout(resolve,wingRemoteProductDelayMs));
  }
  if(token===wingRunToken)wingStatus.textContent=`${checkpoint.products.length}개 상품의 ${filterDescription} 판매지표 조회가 완료되었습니다.`;
  return {status:'complete',checkpoint};
};

async function pauseWingReservation(job,outcome,message){
  job.status='재개대기';job.pausedAt=Date.now();job.pauseKind=String(outcome?.failure?.kind||'');job.pauseReason=String(outcome?.failure?.reason||message||'조회 오류');
  metricReservationPaused=true;metricReservationRunning=false;$('#metricQueueCancel').disabled=true;
  metricQueueStatus.textContent=`“${job.keyword}” ${message}`;
  renderWingQueueDashboard();
  if(outcome?.failure?.kind==='extension')toast('확장프로그램을 다시 로드한 뒤 쿠팡 페이지와 이 화면을 새로고침해 주세요.');
  else toast('현재 상품에서 조회를 멈췄습니다. 완료된 상품은 재개할 때 건너뜁니다.');
}
async function runMetricReservationsCore(resume=false){
  if(metricReservationRunning)return {status:'busy'};
  const gate=wingCircuitPermission();
  if(!gate.allowed){showWingCircuitBlock(gate);return {status:'blocked'}}
  const emailSettings=readMetricEmailSettings();
  if((emailSettings.perKeyword||emailSettings.allComplete)&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailSettings.to)){toast('이메일 발송을 선택한 경우 올바른 수신 이메일을 입력하고 설정저장을 눌러 주세요.');return {status:'invalid_email'}}
  if(!resume){
    const keywords=[...metricQueueSelection];
    if(!keywords.length)return {status:'empty'};
    metricReservationJobs=keywords.map(keyword=>({id:crypto.randomUUID(),keyword,status:'대기',productCount:0,processedCount:0,startPage:wingStartPage,endPage:wingEndPage,stopRequested:false}));
  }
  if(!metricReservationJobs.some(job=>job.status==='대기'||job.status==='재개대기'))return {status:'empty'};
  const connected=await checkWingConnection();
  if(!connected)return {status:'login_required'};
  metricReservationRunning=true;metricReservationCancelled=false;metricReservationPaused=false;
  $('#metricQueueRun').disabled=true;$('#metricQueueCancel').disabled=false;renderWingQueueDashboard();
  let completedInBatch=0;
  const completedRecords=[];
  try{
    for(const job of metricReservationJobs){
      if(metricReservationCancelled)break;
      if(wingExecutionLeaseLost){await pauseWingReservation(job,{failure:{kind:'locked'}},'다른 화면의 조회가 끝난 뒤 재개해 주세요.');return {status:'busy'}}
      if(metricManualRunIds&&!metricManualRunIds.has(job.id))continue;
      if(job.status!=='대기'&&job.status!=='재개대기')continue;
      job.status='조회중';job.stopRequested=false;job.pausedAt=0;job.pauseKind='';job.pauseReason='';wingKeywordInput.value=job.keyword;
      metricQueueStatus.textContent=`“${job.keyword}” 저장된 진행상태 확인 중`;renderWingQueueDashboard();
      const checkpoint=await readWingCheckpoint(job);
      const search=await loadWingSearchProducts(job.keyword,checkpoint,job);
      if(metricReservationCancelled)break;
      if(job.stopRequested){job.status='중단';renderWingQueueDashboard();continue}
      if(!search.ok){
        if(search.failure?.critical)openWingCircuit(search.failure,`${job.keyword} · 상품 검색`);
        await pauseWingReservation(job,{failure:search.failure},'검색 조회가 일시정지되었습니다. 상태 확인 후 재개해 주세요.');
        return {status:search.failure?.critical?'blocked':'paused'};
      }
      const pages=wingJobPages(job);
      checkpoint.products=search.products;checkpoint.startPage=pages.startPage;checkpoint.endPage=pages.endPage;
      job.productCount=search.products.length;job.processedCount=new Set(checkpoint.completedIds||[]).size;
      await writeWingCheckpoint(checkpoint);
      const token=++wingRunToken;
      wingRenderRows(search.products);restoreWingCheckpointRows(search.products,checkpoint);
      wingResultTitle.textContent=`“${job.keyword}” · ${search.products.length}개 상품 분석 중`;
      renderWingQueueDashboard();
      const outcome=await runWingMetrics(search.products,token,{job,checkpoint});
      if(metricReservationCancelled)break;
      if(wingExecutionLeaseLost){await pauseWingReservation(job,{failure:{kind:'locked'}},'다른 화면의 조회가 끝난 뒤 재개해 주세요.');return {status:'busy'}}
      if(outcome?.status==='blocked'||outcome?.status==='paused'){
        await pauseWingReservation(job,outcome,'현재 상품부터 안전하게 재개 대기합니다.');
        return outcome;
      }
      if(job.stopRequested||outcome?.status==='cancelled'){job.status='중단';renderWingQueueDashboard();continue}
      const record={id:crypto.randomUUID(),keyword:job.keyword,completedAt:new Date().toLocaleString('ko-KR'),products:captureWingProducts()};
      try{writeMetricHistory([record,...readMetricHistory()]);renderMetricHistory()}catch{
        job.status='중단';toast('분석 결과 저장 공간이 부족합니다. 목록을 정리한 뒤 다시 시도해 주세요.');renderWingQueueDashboard();break;
      }
      job.status='완료';job.processedCount=job.productCount;completedRecords.push(record);completedInBatch+=1;
      metricQueueSelection.delete(job.keyword);metricManualJobSelection.delete(job.id);updateMetricQueueSelection();renderWingQueueDashboard();
      wingRuntimeDelete(wingCheckpointKey(job.id)).catch(()=>{});
      if(emailSettings.perKeyword){try{await emailMetricHistory([record],`${job.keyword}_완료`);toast(`“${job.keyword}” 완료 결과를 이메일로 발송했습니다.`)}catch(error){toast(error.message||'완료 결과 이메일을 발송하지 못했습니다.')}}
      const hasNext=metricReservationJobs.some(item=>item.status==='대기'||item.status==='재개대기');
      if(hasNext){
        metricQueueStatus.textContent='다음 선택 키워드 조회를 즉시 시작합니다.';
        renderWingQueueDashboard();
        if(metricReservationCancelled)break;
        if(wingExecutionLeaseLost)return {status:'busy'};
      }
    }
    const completed=metricReservationJobs.filter(job=>job.status==='완료').length,stopped=metricReservationJobs.filter(job=>job.status==='중단').length;
    if(emailSettings.allComplete&&completed===metricReservationJobs.length&&completedRecords.length){
      metricQueueStatus.textContent='예약목록 전체 완료 · 이메일 발송 중';
      try{await emailMetricHistory(completedRecords,'예약목록_전체완료');toast('예약목록 전체 완료 결과를 이메일로 발송했습니다.')}catch(error){toast(error.message||'전체 완료 결과 이메일을 발송하지 못했습니다.')}
    }
    metricQueueStatus.textContent=`지표분석 예약 ${metricReservationCancelled?'중단':'완료'} · 완료 ${completed}개 · 중단 ${stopped}개`;
    return {status:metricReservationCancelled?'cancelled':'complete'};
  }finally{
    metricManualRunIds=null;
    metricReservationRunning=false;$('#metricQueueCancel').disabled=true;$('#metricQueueRun').disabled=!metricQueueSelection.size;
    renderWingQueueDashboard();renderMetricHistory();
  }
}
runMetricReservations=async function(resume=false){
  const gate=wingCircuitPermission();
  if(!gate.allowed){showWingCircuitBlock(gate);return {status:'blocked'}}
  return withWingExecutionLock('판매지표 분석예약',()=>runMetricReservationsCore(resume));
};

wingSearchForm.onsubmit=async event=>{
  event.preventDefault();
  const keyword=wingKeywordInput.value.trim();
  if(!keyword)return;
  const gate=wingCircuitPermission();
  if(!gate.allowed){showWingCircuitBlock(gate);return}
  await withWingExecutionLock('판매지표 직접 조회',async()=>{
    metricReservationCancelled=false;
    wingRunButton.disabled=true;wingStopButton.disabled=false;wingLedgerStopButton.disabled=false;wingExportButton.disabled=true;
    const token=++wingRunToken;
    try{
      wingSetResultView({title:`“${keyword}” · ${wingStartPage}~${wingEndPage}페이지 상품 수집 중`,stateMessage:`쿠팡 검색 결과 ${wingStartPage}~${wingEndPage}페이지 확인 중`});
      if(!await checkWingConnection())return;
      const search=await loadWingSearchProducts(keyword);
      if(token!==wingRunToken)return;
      if(!search.ok){
        if(search.failure?.critical)openWingCircuit(search.failure,`${keyword} · 상품 검색`);
        wingRenderEmpty(search.error||'검색 결과가 없습니다.');return;
      }
      const products=search.products;
      wingRenderRows(products);wingResultTitle.textContent=`“${keyword}” · ${products.length}개 상품 분석 중`;wingExportButton.disabled=false;
      const outcome=await runWingMetrics(products,token);
      if(outcome?.status==='complete'&&token===wingRunToken)wingResultTitle.textContent=`“${keyword}” · 판매지표 분석 완료`;
      else if(outcome?.status==='paused')wingResultTitle.textContent=`“${keyword}” · 현재 상품에서 일시정지`;
    }finally{
      wingRunButton.disabled=false;wingStopButton.disabled=true;wingLedgerStopButton.disabled=true;
    }
  });
};

analyzeWingReviews=async function(button){
  const row=button.closest('tr');
  if(!row)return;
  const productUrl=row.dataset.wingUrl,productId=row.dataset.wingProductId,reviewCount=Number(row.dataset.wingReviewCount)||0;
  if(!productUrl||!productId||!reviewCount){toast('리뷰 분석에 필요한 상품 정보를 찾지 못했습니다.');return}
  const gate=wingCircuitPermission();
  if(!gate.allowed){showWingCircuitBlock(gate);return}
  await withWingExecutionLock('상품 리뷰 분석',async()=>{
    button.disabled=true;button.textContent='분석 중';wingReviewPanel.hidden=false;
    wingReviewPanel.textContent='윙렌즈가 공개 리뷰를 수집하고 있습니다. 잠시 기다려 주세요.';
    try{
      const result=await wingExecutionMessage({kind:'WL_EXTERNAL_REVIEWS',productUrl,productId,reviewCount});
      if(!result?.ok||!Array.isArray(result.reviews)){
        const failure=classifyWingFailure(result);
        if(failure.critical)openWingCircuit(failure,'상품 리뷰 분석');
        wingReviewPanel.textContent=result?.error||'공개 리뷰를 수집하지 못했습니다. 쿠팡 상품 페이지 접속 상태를 확인한 뒤 다시 시도해 주세요.';
        return;
      }
      const reviews=result.reviews,ratings=reviews.map(review=>Number(review.rating)).filter(Number.isFinite);
      const average=ratings.length?(ratings.reduce((sum,value)=>sum+value,0)/ratings.length).toFixed(1):'-',fiveStars=ratings.filter(value=>value===5).length;
      wingReviewPanel.innerHTML=`<strong>${clean(row.dataset.wingName||'상품')} · 리뷰 분석 완료</strong><span>공개 리뷰 ${reviews.length.toLocaleString()}건 · 평균 평점 ${average}점 · 5점 리뷰 ${fiveStars.toLocaleString()}건</span>`;
    }finally{button.disabled=false;button.textContent='리뷰 분석'}
  });
};

const clearMetricReservationByUserBeforeResilience=clearMetricReservationByUser;
clearMetricReservationByUser=function(){
  const checkpointIds=metricReservationJobs.map(job=>job.id);
  clearMetricReservationByUserBeforeResilience();
  checkpointIds.forEach(id=>wingRuntimeDelete(wingCheckpointKey(id)).catch(()=>{}));
};
wingStopButton.onclick=clearMetricReservationByUser;
wingLedgerStopButton.onclick=clearMetricReservationByUser;
$('#metricQueueCancel').onclick=clearMetricReservationByUser;

window.addEventListener('storage',event=>{
  if(event.key===wingCircuitStorageKey){
    const gate=wingCircuitPermission();
    if(!gate.allowed){wingRunToken++;showWingCircuitBlock(gate)}
  }
});
setTimeout(()=>{
  const gate=wingCircuitPermission();
  if(!gate.allowed)showWingCircuitBlock(gate);
},300);

window.__wingResilience={
  classifyFailure:classifyWingFailure,
  readCircuit:readWingCircuit,
  circuitPermission:wingCircuitPermission,
  productKey:wingProductKey,
  dedupeProducts:dedupeWingProducts,
  readCheckpoint:readWingCheckpoint,
  readCache:readWingCache
};

/* --------------------------------------------------------------------------
 * 접근 제한 자동 재시도 제어
 * - 자동 재시도는 기본적으로 사용하지 않습니다.
 * - 이전 버전에서 저장된 자동 재시도 예약도 실행하지 않고 삭제합니다.
 * - 조회 재개는 사용자가 직접 선택합니다.
 * -------------------------------------------------------------------------- */
const wingAutoRetryStorageKey='wing-lens-access-auto-retry-v1';
const wingAutoRetryClaimKey='wing-lens-access-auto-retry-claim-v1';
const wingAutoRetryCancelKey='wing-lens-access-auto-retry-cancel-v1';
const wingAutoRetryEnabled=false;
const wingAutoRetryDelayMs=30*60*1000;
const wingAutoRetryBusyDelayMs=60*1000;
let wingAutoRetryTimer=0;
let wingAutoRetryRunning=false;
let wingAutoRetryClaimToken='';
let wingAutoRetryLastNoticeKey='';
let wingAutoRetryLastCancelId='';

function readWingAutoRetry(){
  try{
    const value=JSON.parse(localStorage.getItem(wingAutoRetryStorageKey)||'null');
    return value&&Number(value.retryAt)>0?value:null;
  }catch{return null}
}
function writeWingAutoRetry(value){
  if(!value){localStorage.removeItem(wingAutoRetryStorageKey);return}
  localStorage.setItem(wingAutoRetryStorageKey,JSON.stringify(value));
}
function clearWingAutoRetry(){
  if(wingAutoRetryTimer){clearTimeout(wingAutoRetryTimer);wingAutoRetryTimer=0}
  writeWingAutoRetry(null);
  const claim=readWingAutoRetryClaim();
  if(claim?.claimToken&&claim.claimToken===wingAutoRetryClaimToken)localStorage.removeItem(wingAutoRetryClaimKey);
  wingAutoRetryClaimToken='';
}
if(!wingAutoRetryEnabled)clearWingAutoRetry();
function readWingAutoRetryClaim(){
  try{return JSON.parse(localStorage.getItem(wingAutoRetryClaimKey)||'null')}catch{return null}
}
function claimWingAutoRetry(){
  const now=Date.now(),current=readWingAutoRetryClaim();
  if(current&&Number(current.expiresAt)>now)return false;
  const claimToken=`${wingExecutionOwnerId}:${crypto.randomUUID()}`;
  const claim={ownerId:wingExecutionOwnerId,claimToken,expiresAt:now+2*60*1000};
  localStorage.setItem(wingAutoRetryClaimKey,JSON.stringify(claim));
  const acquired=readWingAutoRetryClaim()?.claimToken===claimToken;
  wingAutoRetryClaimToken=acquired?claimToken:'';
  return acquired;
}
function releaseWingAutoRetryClaim(){
  if(wingAutoRetryClaimToken&&readWingAutoRetryClaim()?.claimToken===wingAutoRetryClaimToken)localStorage.removeItem(wingAutoRetryClaimKey);
  wingAutoRetryClaimToken='';
}
function wingAutoRetryTime(value){
  return new Date(Number(value)||Date.now()).toLocaleString('ko-KR',{
    month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'
  });
}
function wingAutoRetryKeyword(){
  return metricReservationJobs.find(job=>job.status==='조회중'||job.status==='재개대기')?.keyword
    ||wingKeywordInput?.value?.trim()
    ||'현재 키워드';
}
function updateWingAutoRetryStatus(retry){
  if(!retry)return;
  const remainingMs=Math.max(0,Number(retry.retryAt)-Date.now());
  const remainingMinutes=Math.max(1,Math.ceil(remainingMs/60000));
  const message=`${retry.reason||'쿠팡 접근 제한'} · ${wingAutoRetryTime(retry.retryAt)} 자동 재시도 예정 (${remainingMinutes}분 남음)`;
  wingStatus.textContent=message;
  metricQueueStatus.textContent=message;
}
function scheduleWingAutoRetry({retryAt,context='',keyword='',reason='쿠팡 접근 제한',notify=true}={}){
  if(!wingAutoRetryEnabled){clearWingAutoRetry();return null}
  const dueAt=Math.max(Date.now(),Number(retryAt)||Date.now()+wingAutoRetryDelayMs);
  const previous=readWingAutoRetry();
  const retained=previous&&Number(previous.retryAt)===dueAt?previous:{};
  const retry={
    ...retained,
    retryAt:dueAt,
    context:String(context||'배송정보 조회'),
    keyword:String(keyword||wingAutoRetryKeyword()),
    reason:String(reason||'조회 오류'),
    createdAt:Number(retained.createdAt)||Date.now()
  };
  writeWingAutoRetry(retry);
  armWingAutoRetry();
  updateWingAutoRetryStatus(retry);
  const noticeKey=`${retry.retryAt}|${retry.keyword}`;
  if(notify&&wingAutoRetryLastNoticeKey!==noticeKey){
    wingAutoRetryLastNoticeKey=noticeKey;
    showAppNotice(
      `${retry.reason} · 자동 재시도 예약`,
      `“${retry.keyword}” 조회 중 오류가 감지되었습니다. 요청을 즉시 멈췄으며 ${wingAutoRetryTime(dueAt)}에 실패한 상품부터 자동으로 다시 시도합니다. 중단 버튼을 누르면 자동 재시도 예약도 취소됩니다.`
    );
  }
  return retry;
}
function deferWingAutoRetry(retry,delayMs=wingAutoRetryBusyDelayMs){
  if(!wingAutoRetryEnabled){clearWingAutoRetry();return null}
  const next={...retry,retryAt:Date.now()+delayMs};
  writeWingAutoRetry(next);armWingAutoRetry();updateWingAutoRetryStatus(next);
  return next;
}
async function runWingAutoRetry(){
  if(!wingAutoRetryEnabled){clearWingAutoRetry();return}
  if(wingAutoRetryRunning)return;
  const retry=readWingAutoRetry();
  if(!retry)return;
  if(Date.now()<Number(retry.retryAt)){armWingAutoRetry();return}
  if(metricReservationRunning){deferWingAutoRetry(retry);return}
  if(!claimWingAutoRetry()){deferWingAutoRetry(retry);return}
  wingAutoRetryRunning=true;
  try{
    const saved=readActiveMetricReservationQueue();
    if(saved?.jobs?.length)restoreActiveMetricReservationQueue();
    if(!metricReservationJobs.some(job=>job.status==='재개대기'||job.status==='대기')){
      clearWingAutoRetry();
      return;
    }
    metricQueueStatus.textContent=`“${retry.keyword}” 30분 대기 완료 · 자동 시험 조회를 시작합니다.`;
    const outcome=await runMetricReservations(true);
    if(outcome?.status==='blocked'){
      const circuit=readWingCircuit();
      const scheduled=readWingAutoRetry();
      if(scheduled&&Number(scheduled.retryAt)>Date.now())armWingAutoRetry();
      else if(circuit.state==='open')scheduleWingAutoRetry({
        retryAt:circuit.nextAllowedAt,
        context:circuit.context||retry.context,
        keyword:retry.keyword,
        reason:circuit.reason||retry.reason,
        notify:true
      });
      return;
    }
    if(outcome?.status==='busy'||outcome?.status==='login_required'){
      const next=deferWingAutoRetry(retry);
      if(outcome.status==='login_required'&&!retry.loginNoticeShown){
        next.loginNoticeShown=true;writeWingAutoRetry(next);
        showAppNotice(
          '자동 재시도 대기',
          '쿠팡윙 로그인 상태를 확인하지 못해 자동 조회를 잠시 보류했습니다. 쿠팡윙에 로그인하면 1분 후 다시 확인합니다.'
        );
      }
      return;
    }
    if(outcome?.status==='paused'){
      const scheduled=readWingAutoRetry();
      if(scheduled&&Number(scheduled.retryAt)>Date.now()){armWingAutoRetry();return}
      const next={...retry,retryAt:Date.now()+wingAutoRetryDelayMs};
      writeWingAutoRetry(next);armWingAutoRetry();updateWingAutoRetryStatus(next);
      const circuit=readWingCircuit();
      if(circuit.state==='half-open')writeWingCircuit({...circuit,state:'open',nextAllowedAt:next.retryAt});
      showAppNotice(
        '조회 오류 · 자동 재시도 재예약',
        `시험 조회 중 일시 오류가 발생했습니다. 요청을 멈추고 ${wingAutoRetryTime(next.retryAt)}에 실패한 상품부터 다시 시도합니다.`
      );
      return;
    }
    if(outcome?.status==='invalid_email'){
      const next=deferWingAutoRetry(retry);
      if(!retry.invalidEmailNoticeShown){
        next.invalidEmailNoticeShown=true;writeWingAutoRetry(next);
        showAppNotice('자동 재시도 보류','이메일 설정을 확인해야 합니다. 설정을 저장하면 1분 후 다시 확인합니다.');
      }
      return;
    }
    if(outcome?.status==='empty'||outcome?.status==='cancelled'||outcome?.status==='complete'||readWingCircuit().state==='closed'){
      clearWingAutoRetry();
    }
  }finally{
    wingAutoRetryRunning=false;
    releaseWingAutoRetryClaim();
  }
}
function armWingAutoRetry(){
  if(!wingAutoRetryEnabled){clearWingAutoRetry();return}
  if(wingAutoRetryTimer){clearTimeout(wingAutoRetryTimer);wingAutoRetryTimer=0}
  const retry=readWingAutoRetry();
  if(!retry)return;
  const delay=Math.max(250,Number(retry.retryAt)-Date.now());
  wingAutoRetryTimer=setTimeout(()=>{wingAutoRetryTimer=0;runWingAutoRetry().catch(error=>{
    console.warn('쿠팡 접근 제한 자동 재시도 실패',error);
    const current=readWingAutoRetry();
    if(current)deferWingAutoRetry(current);
  })},Math.min(delay,2147483647));
}

const runMetricReservationsBeforeAutoRetry=runMetricReservations;
runMetricReservations=async function(resume=false){
  const outcome=await runMetricReservationsBeforeAutoRetry(resume);
  if(outcome?.status==='paused'){
    const failure=outcome.failure||{kind:'transient',reason:'조회 오류',text:'판매지표 조회가 일시정지되었습니다.'};
    const retryAt=Date.now()+wingAutoRetryDelayMs;
    const currentCircuit=readWingCircuit();
    writeWingCircuit({
      state:'open',
      kind:failure.kind||'transient',
      reason:failure.reason||'조회 오류',
      detail:String(failure.text||'').slice(0,500),
      context:`${wingAutoRetryKeyword()} · 일시정지`,
      openedAt:Date.now(),
      nextAllowedAt:Math.max(Number(currentCircuit.nextAllowedAt)||0,retryAt)
    });
    scheduleWingAutoRetry({
      retryAt,
      context:`${wingAutoRetryKeyword()} · 일시정지`,
      keyword:wingAutoRetryKeyword(),
      reason:failure.reason||'조회 오류',
      notify:true
    });
  }
  return outcome;
};

const openWingCircuitBeforeAutoRetry=openWingCircuit;
openWingCircuit=function(failure,context='판매지표 조회'){
  const hadActiveReservation=metricReservationJobs.some(job=>job.status==='조회중');
  const circuit=openWingCircuitBeforeAutoRetry(failure,context);
  if(failure?.kind==='blocked_403'&&hadActiveReservation){
    scheduleWingAutoRetry({
      retryAt:circuit.nextAllowedAt,
      context,
      keyword:wingAutoRetryKeyword(),
      reason:failure.reason,
      notify:true
    });
  }
  return circuit;
};
const closeWingCircuitBeforeAutoRetry=closeWingCircuit;
closeWingCircuit=function(){
  const retry=wingAutoRetryRunning?readWingAutoRetry():null;
  closeWingCircuitBeforeAutoRetry();
  clearWingAutoRetry();
  if(retry){
    showAppNotice(
      '자동 재시도 성공',
      `“${retry.keyword}”의 첫 시험 요청이 정상 응답했습니다. 실패한 상품부터 남은 판매지표 분석을 계속 진행합니다.`
    );
  }
};
const clearMetricReservationByUserBeforeAutoRetry=clearMetricReservationByUser;
clearMetricReservationByUser=function(){
  wingAutoRetryLastCancelId=crypto.randomUUID();
  localStorage.setItem(wingAutoRetryCancelKey,JSON.stringify({id:wingAutoRetryLastCancelId,cancelledAt:Date.now()}));
  clearWingAutoRetry();
  clearMetricReservationByUserBeforeAutoRetry();
};
wingStopButton.onclick=clearMetricReservationByUser;
wingLedgerStopButton.onclick=clearMetricReservationByUser;
$('#metricQueueCancel').onclick=clearMetricReservationByUser;

window.addEventListener('storage',event=>{
  if(event.key===wingAutoRetryStorageKey)armWingAutoRetry();
  if(event.key===wingAutoRetryCancelKey&&event.newValue){
    try{
      const cancel=JSON.parse(event.newValue);
      if(cancel?.id===wingAutoRetryLastCancelId)return;
    }catch{}
    metricReservationCancelled=true;wingRunToken++;
    clearWingAutoRetry();clearActiveMetricReservationQueue();
    metricReservationJobs=[];metricReservationPaused=false;
    metricQueueStatus.textContent='다른 화면에서 중단되어 자동 재시도와 예약 목록을 삭제했습니다.';
    renderWingQueueDashboard();
  }
});
setTimeout(async()=>{
  try{
    const status=await wingMessage({kind:'WL_EXTERNAL_STATUS'});
    const remote=status?.remoteCircuit;
    if(remote&&remote.state!=='closed'&&Number(remote.nextAllowedAt)>0){
      const mappedKind=remote.kind==='access_denied'?'blocked_403':remote.kind==='rate_limited'?'rate_429':String(remote.kind||'blocked_403');
      writeWingCircuit({
        state:'open',kind:mappedKind,reason:String(remote.reason||'쿠팡 접근 제한'),
        detail:String(remote.detail||''),context:'확장프로그램 차단 상태 복원',
        openedAt:Number(remote.openedAt)||Date.now(),nextAllowedAt:Number(remote.nextAllowedAt)
      });
    }
  }catch{}
  const circuit=readWingCircuit();
  const existing=readWingAutoRetry();
  const pausedJob=metricReservationJobs.find(job=>job.status==='재개대기');
  const hasPausedReservation=Boolean(pausedJob);
  const hasStoredIntent=Boolean(existing)&&metricReservationJobs.some(job=>job.status==='재개대기'||job.status==='대기');
  if(circuit.state==='open'&&((circuit.kind==='blocked_403'&&hasPausedReservation)||hasStoredIntent)){
    scheduleWingAutoRetry({
      retryAt:Number(existing?.retryAt)||Number(circuit.nextAllowedAt)||Date.now()+wingAutoRetryDelayMs,
      context:existing?.context||circuit.context||'배송정보 조회',
      keyword:existing?.keyword||wingAutoRetryKeyword(),
      reason:existing?.reason||circuit.reason||'쿠팡 접근 제한',
      notify:true
    });
  }else if(circuit.state==='closed'&&hasPausedReservation){
    const saved=readActiveMetricReservationQueue();
    const errorAt=Number(pausedJob.pausedAt)||Number(saved?.savedAt)||Date.now();
    const retryAt=Number(existing?.retryAt)||Math.max(Date.now()+250,errorAt+wingAutoRetryDelayMs);
    const reason=existing?.reason||pausedJob.pauseReason||'이전 조회 오류';
    writeWingCircuit({
      state:'open',kind:pausedJob.pauseKind||'transient',reason,detail:'저장된 재개대기 작업',
      context:`${pausedJob.keyword} · 재개대기`,openedAt:errorAt,nextAllowedAt:retryAt
    });
    scheduleWingAutoRetry({
      retryAt,
      context:existing?.context||`${pausedJob.keyword} · 재개대기`,
      keyword:existing?.keyword||pausedJob.keyword,
      reason,
      notify:true
    });
  }else{
    armWingAutoRetry();
  }
},500);

Object.assign(window.__wingResilience,{
  readAutoRetry:readWingAutoRetry,
  scheduleAutoRetry:scheduleWingAutoRetry,
  runAutoRetry:runWingAutoRetry,
  clearAutoRetry:clearWingAutoRetry
});

/* UI 시안 v0.1: 제목 옆의 접기·펼치기와 엑셀 안내 동작을 같은 방식으로 표시합니다. */
(()=>{
  const collapseState=window.sourcingJudgeCollapseState;

  const upload=$('.upload');
  if(upload&&guideButton){
    const guideRow=document.createElement('div');
    guideRow.className='upload-guide-row';
    guideRow.append(guideButton);
    upload.append(guideRow);
  }

  const filterHead=$('.filter-head');
  if(filterHead&&filterToggle){
    const title=$('.filter-head h2');
    const titleRow=document.createElement('div');
    titleRow.className='filter-title-row';
    title.before(titleRow);
    titleRow.append(title,filterToggle);
    const setFilterCollapsedV01=collapsed=>{
      $('.filters').classList.toggle('is-collapsed',collapsed);
      filterToggle.textContent=collapsed?'펼치기':'접기';
      filterToggle.setAttribute('aria-expanded',String(!collapsed));
      collapseState.set('filter',collapsed);
    };
    setFilterCollapsedV01($('.filters').classList.contains('is-collapsed'));
    filterToggle.onclick=()=>setFilterCollapsedV01(!$('.filters').classList.contains('is-collapsed'));
  }

  if(judgeRunToggle){
    const setJudgeRunCollapsedV01=collapsed=>{
      const runCard=$('.run'),judgeResults=$('.results');
      runCard.classList.toggle('is-collapsed',collapsed);
      judgeResults.classList.toggle('is-collapsed',collapsed);
      judgeRunToggle.textContent=collapsed?'펼치기':'접기';
      judgeRunToggle.setAttribute('aria-expanded',String(!collapsed));
      collapseState.set('judgeRun',collapsed);
    };
    setJudgeRunCollapsedV01($('.run').classList.contains('is-collapsed'));
    judgeRunToggle.onclick=()=>setJudgeRunCollapsedV01(!$('.run').classList.contains('is-collapsed'));
  }
})();
