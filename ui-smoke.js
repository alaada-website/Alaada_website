(function(){
  if((location.hostname==='127.0.0.1'||location.hostname==='localhost')&&new URLSearchParams(location.search).get('ui_test')==='1')return;
  const style=document.createElement('style');
  style.textContent=`
    #ffOverlay{position:fixed;inset:0;z-index:99999;background:rgba(5,6,15,.85);
      backdrop-filter:blur(10px);display:flex;align-items:center;justify-content:center;
      animation:ffIn .22s ease}
    @keyframes ffIn{from{opacity:0}to{opacity:1}}
    #ffBox{background:#13141d;border:1px solid rgba(61,143,255,.2);border-radius:18px;
      width:400px;max-width:92vw;padding:36px 28px 28px;text-align:center;
      font-family:'Plus Jakarta Sans',sans-serif;position:relative;overflow:hidden;
      animation:ffUp .28s cubic-bezier(.2,.8,.2,1)}
    #ffBox::before{content:'';position:absolute;top:-60px;left:50%;transform:translateX(-50%);
      width:200px;height:200px;border-radius:50%;
      background:radial-gradient(circle,rgba(61,143,255,.15) 0%,transparent 70%);
      pointer-events:none}
    @keyframes ffUp{from{transform:translateY(16px);opacity:0}to{transform:none;opacity:1}}
    #ffGem{width:52px;height:52px;border-radius:14px;
      background:linear-gradient(135deg,#f0a500,#e09000);
      display:flex;align-items:center;justify-content:center;margin:0 auto 16px;
      box-shadow:0 4px 20px rgba(240,165,0,.4)}
    #ffTitle{font-size:19px;font-weight:800;color:#f0f2ff;margin-bottom:8px;letter-spacing:-.3px}
    #ffTitle b{color:#f0a500}
    #ffSub{font-size:13px;color:#8892b0;line-height:1.65;margin-bottom:26px}
    #ffFeatures{display:flex;justify-content:center;gap:16px;margin-bottom:22px;flex-wrap:wrap}
    .ff-feat{font-size:11px;color:#5a6080;display:flex;align-items:center;gap:4px}
    .ff-feat span{color:#00d4a0}
    #ffBtns{display:flex;gap:10px}
    #ffYes{flex:1;height:44px;border-radius:10px;
      background:linear-gradient(135deg,#f0a500,#e09000);border:none;
      color:#1a0f00;font-family:inherit;font-size:14px;font-weight:800;
      cursor:pointer;transition:all .18s;box-shadow:0 3px 12px rgba(240,165,0,.35)}
    #ffYes:hover{transform:translateY(-2px);box-shadow:0 6px 20px rgba(240,165,0,.5)}
    #ffYes:active{transform:scale(.96)}
    #ffNo{flex:1;height:44px;border-radius:10px;background:transparent;
      border:1px solid rgba(255,255,255,.1);color:#5a6080;
      font-family:inherit;font-size:14px;font-weight:600;cursor:pointer;transition:all .18s}
    #ffNo:hover{border-color:rgba(255,77,106,.4);color:#ff7090;background:rgba(255,77,106,.06)}
    #ffNo:active{transform:scale(.96)}
    #ffExit{display:none;font-size:13px;color:#5a6080;line-height:1.8;padding-top:4px}
    #ffExit a{color:#f0a500;font-weight:700;cursor:pointer;text-decoration:none}
    #ffExit a:hover{text-decoration:underline}
  `;
  document.head.appendChild(style);

  const modal=document.createElement('div');
  modal.id='ffOverlay';
  modal.innerHTML=`
    <div id="ffBox">
      <div id="ffGem">
        <svg width="26" height="26" viewBox="0 0 14 14" fill="rgba(255,255,255,.95)">
          <rect x="1" y="1" width="5" height="5" rx="1"/>
          <rect x="8" y="1" width="5" height="5" rx="1"/>
          <rect x="1" y="8" width="5" height="5" rx="1"/>
          <rect x="8" y="8" width="5" height="5" rx="1"/>
        </svg>
      </div>
      <div id="ffTitle">Welcome to Alaada <b>Sheets</b></div>
      <div id="ffSub">
        A full-featured AI spreadsheet — formulas, charts,<br>voice commands, and Tally export.
      </div>
      <div id="ffFeatures">
        <div class="ff-feat"><span>✓</span> Excel formulas</div>
        <div class="ff-feat"><span>✓</span> Orbit AI</div>
        <div class="ff-feat"><span>✓</span> Charts</div>
        <div class="ff-feat"><span>✓</span> Tally export</div>
      </div>
      <div id="ffBtns">
        <button id="ffYes">✓ Yes, open Sheets</button>
        <button id="ffNo">✕ No thanks</button>
      </div>
      <div id="ffExit">
        No problem — come back any time.<br>
        <a id="ffBack">Changed your mind? Click here →</a>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  function dismiss(){
    modal.style.transition='opacity .22s';
    modal.style.opacity='0';
    setTimeout(()=>{
      modal.remove();
      document.getElementById('gscroll')?.focus({preventScroll:true});
    },230);
  }

  async function recordFootfall(){
    try{
      await fetch(API+'/api/footfall',{method:'POST',headers:{'Content-Type':'application/json'}});
    }catch(_){}
  }

  document.getElementById('ffYes').addEventListener('click',async()=>{
    dismiss();
    await recordFootfall();
  });

  document.getElementById('ffNo').addEventListener('click',()=>{
    document.getElementById('ffBtns').style.display='none';
    document.getElementById('ffSub').style.display='none';
    document.getElementById('ffFeatures').style.display='none';
    document.getElementById('ffExit').style.display='block';
    const app=document.getElementById('app');
    app.style.filter='brightness(.35) blur(1px)';
    app.style.pointerEvents='none';
  });

  document.getElementById('ffBack').addEventListener('click',async()=>{
    const app=document.getElementById('app');
    app.style.filter='';
    app.style.pointerEvents='';
    dismiss();
    await recordFootfall();
  });
})();
