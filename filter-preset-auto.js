/* 저장 필터를 선택하면 즉시 화면의 조건값을 복원합니다. */
(()=>{
  const slot=document.querySelector('#presetSlot');
  const name=document.querySelector('#presetName');
  if(!slot||!name)return;
  const toast=message=>{const element=document.querySelector('#toast');if(!element)return;element.textContent=message;element.classList.add('show');setTimeout(()=>element.classList.remove('show'),2600)};
  const setValue=(selector,value)=>{const input=document.querySelector(selector);if(input)input.value=value??''};
  const load=()=>{
    let presets={};try{presets=JSON.parse(localStorage.getItem('sourcing-judge-filter-presets-v1')||'{}')}catch{}
    const preset=presets[slot.value];
    if(!preset){name.value='';return}
    const data=preset.filters||{};
    name.value=preset.name||'';
    ['brand','shopping','peakMonth'].forEach(field=>document.querySelectorAll(`input[name="${field}"]`).forEach(input=>input.checked=(data[field]||[]).includes(input.value)));
    ['volume','lastYearVolume','deliveryRate','overseasReviews'].forEach(field=>{setValue(`[data-field="${field}"]`,data[field]?.operator||'gte');setValue(`[data-value="${field}"]`,data[field]?.value||'')});
    ['naverPrice','coupangPrice'].forEach(field=>{const saved=data[field]||{},legacy=saved.operator?saved:null;['min','max'].forEach(bound=>{const condition=saved[bound]||(bound==='min'?legacy:null)||{};setValue(`[data-range-field="${field}"][data-range-bound="${bound}"][data-range-part="operator"]`,condition.operator||(bound==='min'?'gte':'lte'));setValue(`[data-range-field="${field}"][data-range-bound="${bound}"][data-range-part="value"]`,condition.value||'')})});
    const info=document.querySelector('#filterInfo');if(info)info.textContent=`“${preset.name}” 필터 조건을 불러왔습니다. 전체 키워드 추출을 누르면 적용됩니다.`;
    toast(`“${preset.name}” 필터를 자동으로 적용했습니다.`);
  };
  slot.addEventListener('change',load);
})();
