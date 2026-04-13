
// Dashboard menu (stile iPhone) che sostituisce il select #quickNav
(function(){
  function createEl(tag, attrs={}, children=[]) {
    const el=document.createElement(tag);
    for (const [k,v] of Object.entries(attrs)) {
      if (k==="class") el.className=v;
      else if (k==="html") el.innerHTML=v;
      else el.setAttribute(k,v);
    }
    for (const c of children) el.appendChild(c);
    return el;
  }

  function iconSVG(seed){
    // Icona "originale" semplice: quadrato arrotondato + simbolo
    const colors = ["#2563eb","#16a34a","#f59e0b","#ef4444","#7c3aed","#0ea5e9","#db2777","#059669","#f97316"];
    const c = colors[seed % colors.length];
    const g = ["▦","€","📦","👤","🗓","📊","🧾","🛠","💡"][seed % 9];
    return `<span class="dashnav-ico" style="background:${c}">${g}</span>`;
  }

  function build(){
    let sel = document.getElementById("quickNav");
    if (!sel) {
      const html = `<select id="quickNav" class="quick-nav" style="display:none"><option value="">Vai a…</option><option value="index.html">HOME</option><option value="clients.html">CLIENTI</option><option value="suppliers.html">FORNITORI</option><option value="scadenze.html">SCADENZE</option><option value="incassi.html">INCASSI</option><option value="spese.html">SPESE</option><option value="listini.html">LISTINI</option><option value="statistiche.html">STATISTICHE</option><option value="search.html">CERCA</option><option value="agenda.html">AGENDA</option><option value="ordini-clienti.html">ORDINI CLIENTI</option><option value="admin-portale.html">ADMIN PORTALE</option></select>`;
      const host = document.querySelector('.top-bar,.topbar,.top-actions,.topbar-actions,header') || document.body;
      host.insertAdjacentHTML('beforeend', html);
      sel = document.getElementById("quickNav");
    }
    if (!sel) return;

    sel.style.display="none";
    const optionData = [...sel.querySelectorAll("option")].filter(o=>o.value && o.value.trim() && !o.disabled).map(o=>({value:o.value,text:o.textContent.trim()}));

    const btn = createEl("button",{type:"button",class:"dashnav-btn",title:"Apri dashboard"});
    btn.innerHTML = '<span class="dashnav-btn-ico">⌘</span><span class="dashnav-btn-txt">Dashboard</span>';

    const overlay = createEl("div",{class:"dashnav-overlay", "aria-hidden":"true"});
    const panel = createEl("div",{class:"dashnav-panel"});
    const head = createEl("div",{class:"dashnav-head", html:`<div class="dashnav-title">Vai a…</div>`});
    const close = createEl("button",{type:"button",class:"dashnav-close",title:"Chiudi"},[]);
    close.textContent="×";
    head.appendChild(close);

    const grid = createEl("div",{class:"dashnav-grid"});
    const opts = optionData;
    opts.forEach((o,i)=>{
      const item = createEl("button",{type:"button",class:"dashnav-item",title:o.text});
      const iconSpan = document.createElement('span');
      iconSpan.innerHTML = iconSVG(i);
      const txtDiv = document.createElement('div');
      txtDiv.className = 'dashnav-item-txt';
      txtDiv.textContent = o.text;
      item.appendChild(iconSpan);
      item.appendChild(txtDiv);
      item.addEventListener("click", ()=>{
        const url=o.value;
        if (url) window.location.href=url;
      });
      grid.appendChild(item);
    });

    panel.appendChild(head);
    panel.appendChild(grid);
    overlay.appendChild(panel);

    function open(){ overlay.classList.add("open"); overlay.setAttribute("aria-hidden","false"); }
    function shut(){ overlay.classList.remove("open"); overlay.setAttribute("aria-hidden","true"); }

    btn.addEventListener("click", open);
    close.addEventListener("click", shut);
    overlay.addEventListener("click", (e)=>{ if (e.target===overlay) shut(); });
    document.addEventListener("keydown",(e)=>{ if(e.key==="Escape") shut(); });

    const host = sel.parentElement;
    try{ sel.remove(); }catch(e){}
    host.appendChild(btn);
    try{ btn.style.marginLeft = "auto"; }catch(e){}
    document.body.appendChild(overlay);
  }

  if (document.readyState==="loading") document.addEventListener("DOMContentLoaded", build);
  else build();
})();
