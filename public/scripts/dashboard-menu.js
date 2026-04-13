
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

  // SVG path map per pagina (value → {color, svg})
  const PAGE_ICONS = {
    'index.html':         { c:'#1f4fd8', s:'<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>' },
    'clients.html':       { c:'#16a34a', s:'<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>' },
    'suppliers.html':     { c:'#ea580c', s:'<rect x="2" y="7" width="20" height="15" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/><line x1="12" y1="12" x2="12" y2="16"/><line x1="8" y1="12" x2="8" y2="16"/><line x1="16" y1="12" x2="16" y2="16"/>' },
    'scadenze.html':      { c:'#dc2626', s:'<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>' },
    'incassi.html':       { c:'#10b981', s:'<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>' },
    'spese.html':         { c:'#f97316', s:'<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>' },
    'listini.html':       { c:'#d97706', s:'<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>' },
    'statistiche.html':   { c:'#6366f1', s:'<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>' },
    'search.html':        { c:'#64748b', s:'<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>' },
    'agenda.html':        { c:'#06b6d4', s:'<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>' },
    'ordini-clienti.html':{ c:'#3b82f6', s:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>' },
    'admin-portale.html': { c:'#1f4fd8', s:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>' },
    'audit-log.html':     { c:'#7c3aed', s:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>' },
  };
  const FALLBACK_COLORS = ["#2563eb","#16a34a","#f59e0b","#ef4444","#7c3aed","#0ea5e9","#db2777","#059669","#f97316"];

  function iconSVG(seed, pageValue){
    const icon = PAGE_ICONS[pageValue];
    if (icon) {
      return `<span class="dashnav-ico" style="background:${icon.c}"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="22" height="22">${icon.s}</svg></span>`;
    }
    const c = FALLBACK_COLORS[seed % FALLBACK_COLORS.length];
    return `<span class="dashnav-ico" style="background:${c}"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="22" height="22"><rect x="4" y="4" width="16" height="16" rx="3"/></svg></span>`;
  }

  function build(){
    let sel = document.getElementById("quickNav");
    if (!sel) {
      const html = `<select id="quickNav" class="quick-nav" style="display:none"><option value="">Vai a…</option><option value="index.html">HOME</option><option value="clients.html">CLIENTI</option><option value="suppliers.html">FORNITORI</option><option value="scadenze.html">SCADENZE</option><option value="incassi.html">INCASSI</option><option value="spese.html">SPESE</option><option value="listini.html">LISTINI</option><option value="statistiche.html">STATISTICHE</option><option value="search.html">CERCA</option><option value="agenda.html">AGENDA</option><option value="ordini-clienti.html">ORDINI CLIENTI</option><option value="admin-portale.html">ADMIN PORTALE</option><option value="audit-log.html">AUDIT LOG</option></select>`;
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
      iconSpan.innerHTML = iconSVG(i, o.value);
      const txtDiv = document.createElement('div');
      txtDiv.className = 'dashnav-item-txt';
      txtDiv.textContent = o.text;
      item.appendChild(iconSpan);
      item.appendChild(txtDiv);
      item.addEventListener("click", ()=>{
        const url = o.value;
        // Only allow safe relative URLs: must start with a letter or single slash, not //
        if (url && /^[A-Za-z0-9._\-/?=#&%]+$/.test(url) && !url.startsWith('//')) window.location.href = url;
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
