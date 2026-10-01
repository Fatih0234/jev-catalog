// Runs inside the page. Reads the items of a list as ordered text leaves, plus count phrases.
// opts.group: id of a group tagged by snapshot.js ("g3"), or
// opts.itemSignature + opts.containerSignature: read every list on the page built from that template.
(opts) => {
  const MAX_ITEMS = opts?.maxItems ?? 600;
  const clean = (s, n) => (s || '').replace(/[\u00ad\u200b\u200c\u200d\ufeff]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
  const signature = (e) => e.tagName + '.' + [...e.classList].filter((c) => !/active|selected|current|hover|focus|open|first|last|odd|even|\d/.test(c)).sort().join('.');
  const shown = (e) => e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });

  // Items: the tagged group, or every element with the template's signature.
  let items;
  let itemSignature = opts?.itemSignature, containerSignature = opts?.containerSignature;
  if (opts?.group) {
    items = [...document.querySelectorAll(`[data-jc-item^="${opts.group}:"]`)];
    if (items.length) { itemSignature = signature(items[0]); containerSignature = signature(items[0].parentElement); }
  } else {
    const tag = itemSignature.split('.')[0];
    items = [...document.querySelectorAll(tag)].filter((e) => signature(e) === itemSignature && e.parentElement && signature(e.parentElement) === containerSignature);
  }
  items = items.filter((e) => shown(e) && clean(e.innerText, 2).length >= 2);
  items = items.filter((e) => !items.some((o) => o !== e && o.contains(e))).slice(0, MAX_ITEMS);

  // Column labels for table rows. DataTables keeps the header in a separate table next to the body.
  const headerCache = new Map();
  const headerLabels = (row) => {
    const table = row.closest('table');
    if (!table) return null;
    const n = row.cells.length;
    const key = table;
    if (headerCache.has(key)) return headerCache.get(key);
    // The header row with text and no inputs: DataTables adds a filter row whose dropdowns list every value.
    const fromTable = (t) => {
      const rows = [...(t.tHead?.rows ?? [])].filter((r) => !r.querySelector('select,input'));
      for (const r of rows.reverse()) {
        const cells = [...r.cells];
        if (cells.length !== n) continue;
        const labels = cells.map((c) => clean(c.innerText || c.textContent, 60));
        if (labels.some(Boolean)) return labels;
      }
      return null;
    };
    let labels = fromTable(table);
    for (let anc = table.parentElement, i = 0; !labels && anc && i < 4; anc = anc.parentElement, i++) {
      for (const t of anc.querySelectorAll('table')) { if (t !== table && (labels = fromTable(t))) break; }
    }
    if (!labels) {
      const first = table.rows[0];
      if (first && first !== row && first.cells.length === n && [...first.cells].every((c) => c.tagName === 'TH')) labels = [...first.cells].map((c) => clean(c.innerText, 60));
    }
    if (labels) {
      const seen = {};
      labels = labels.map((l) => { if (!l) return l; seen[l] = (seen[l] || 0) + 1; return seen[l] > 1 ? `${l} (${seen[l]})` : l; });
    }
    headerCache.set(key, labels);
    return labels;
  };

  // Visible text of an element without its buttons ("ACS-360-1 Compare" -> "ACS-360-1").
  const textWithoutControls = (el) => {
    const parts = [];
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let t = w.nextNode(); t; t = w.nextNode()) {
      const p = t.parentElement;
      if (!p || p.closest('button,[role="button"],select,script,style,noscript,template') || !shown(p)) continue;
      parts.push(t.textContent);
    }
    return clean(parts.join(' '), 300);
  };

  const pathOf = (el, item) => {
    const parts = [];
    for (let n = el; n && n !== item; n = n.parentElement) {
      const s = signature(n);
      const idx = n.parentElement ? [...n.parentElement.children].filter((k) => signature(k) === s).indexOf(n) : 0;
      parts.push(`${s}:${idx}`);
    }
    return parts.reverse().join('/') || '.';
  };
  // Column headers for div tables: texts just above the first item whose horizontal centre falls in
  // exactly one of its leaves. Stacked cards have overlapping leaves, so they never qualify.
  const itemSet = new Set(items);
  const inItem = (el) => { for (let n = el; n; n = n.parentElement) if (itemSet.has(n)) return true; return false; };
  const geometryLabels = (first, leaves) => {
    const top = first.getBoundingClientRect().top;
    const boxes = leaves.map((l) => l.el.getBoundingClientRect());
    const scope = first.parentElement?.parentElement || document.body;
    const heads = [];
    const w = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    for (let t = w.nextNode(); t; t = w.nextNode()) {
      const el = t.parentElement;
      const v = clean(t.textContent, 60);
      if (!v || !el || inItem(el) || el.closest('script,style,select,option')) continue;
      const r = el.getBoundingClientRect();
      if (r.bottom > top + 2 || r.bottom < top - 150 || !shown(el)) continue;
      heads.push({ v, x: (r.left + r.right) / 2, bottom: r.bottom });
    }
    const byLeaf = new Map();
    for (const h of heads) {
      const hits = boxes.map((b, i) => (h.x >= b.left && h.x <= b.right ? i : -1)).filter((i) => i >= 0);
      if (hits.length > 1) return null; // ambiguous: leaves stacked, not columns
      if (hits.length === 1) {
        const prev = byLeaf.get(hits[0]);
        if (!prev || h.bottom > prev.bottom) byLeaf.set(hits[0], h);
      }
    }
    const labels = new Set([...byLeaf.values()].map((h) => h.v));
    if (byLeaf.size < 3 || labels.size < byLeaf.size) return null;
    const out = {};
    for (const [i, h] of byLeaf) out[leaves[i].path] = h.v;
    return out;
  };
  const containerHeaders = new Map();

  const INLINE_LABEL = /^([\p{L}][^:]{1,40}):\s+(.+)$/u;

  const readItem = (item) => {
    const leaves = [];
    if (item.tagName === 'TR') {
      const labels = headerLabels(item);
      [...item.cells].forEach((cell, i) => {
        if (!shown(cell)) return;
        const value = textWithoutControls(cell);
        if (!value) return;
        const label = labels?.[i];
        leaves.push({ path: `td:${i}`, parent: '.', value, ...(label ? { label } : {}) });
      });
    } else {
      const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT);
      const seen = new Set();
      let pending = null;
      for (let t = walker.nextNode(); t; t = walker.nextNode()) {
        const el = t.parentElement;
        if (!el || seen.has(el) || el.closest('script,style,noscript,template,select,option,button,[role="button"]')) continue;
        seen.add(el);
        const value = clean([...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' '), 300);
        if (!value || !shown(el)) continue;
        const parent = el.parentElement === item ? '.' : pathOf(el.parentElement, item);
        // Explicit labels: <dt>, <th> inside a card, or text ending in ":". They name the next value.
        if (el.tagName === 'DT' || el.tagName === 'TH' || (/:$/.test(value) && value.length <= 41)) {
          pending = value.replace(/:$/, '').trim();
          continue;
        }
        const inline = INLINE_LABEL.exec(value);
        if (pending) { leaves.push({ el, path: pathOf(el, item), parent, value, label: pending }); pending = null; }
        else if (inline && !/^https?$/i.test(inline[1])) leaves.push({ el, path: pathOf(el, item), parent, value: inline[2], label: inline[1].trim() });
        else leaves.push({ el, path: pathOf(el, item), parent, value });
      }
      const container = item.parentElement;
      if (!containerHeaders.has(container)) containerHeaders.set(container, geometryLabels(item, leaves));
      const heads = containerHeaders.get(container);
      if (heads) for (const l of leaves) if (!l.label && heads[l.path]) l.label = heads[l.path];
      for (const l of leaves) delete l.el;
    }
    // The item's own link: the first anchor whose URL is not shared by every item is decided in Node;
    // here we return all anchors in order.
    const links = [...(item.matches('a[href]') ? [item] : []), ...item.querySelectorAll('a[href]')]
      .map((a) => a.href).filter((h) => h && !h.startsWith('javascript:'));
    // The product picture is the largest image in the item, not the first (often a cart or flag icon).
    let img = null, best = 0;
    for (const i of item.querySelectorAll('img')) {
      const r = i.getBoundingClientRect();
      if (r.width * r.height > best && r.width >= 32 && r.height >= 32) { best = r.width * r.height; img = i; }
    }
    const image = img ? (img.currentSrc || img.src || img.getAttribute('data-src') || '') : '';
    return { leaves, links, ...(image && !image.startsWith('data:') ? { image } : {}) };
  };

  // Count phrases anywhere on the page: "3,823 results", "1–50 von 212", "Products (31)", "Page 1 of 34".
  // Take the smallest element that has both a word and a number, so a tab bar ("All results 49
  // Products 31 Downloads 10") yields one candidate per tab.
  const COUNT = /(\d[\d.,\u202f\u00a0 ]*\s*(results?|products?|items?|articles?|matches|hits|models|variants|pages?|Treffer|Produkte?n?|Artikel|Ergebnisse?|Einträge|Varianten|Seiten?|résultats|produits|articoli|prodotti|risultati|resultados|productos|ürün|sonuç)\b)|(\b(of|von|de|di|aus|sur)\s+\d)|(\d\s*\/\s*\d{2,})|((results?|Treffer|Ergebnisse|products?|Produkte|Artikel|Seite|page)\s*:?\s*\(?\d)|(\p{L}{3,}[^\d()]{0,25}\(\s*\d[\d.,\u202f\u00a0]*\s*\))|(^\s*\d[\d.,\u202f\u00a0]*\s+(found|gefunden|trouvés?|trovati|encontrados|bulundu|Stück|pcs)\s*$)/iu;
  const counts = [];
  const seenCount = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let t = walker.nextNode(); t && counts.length < 15; t = walker.nextNode()) {
    let el = t.parentElement;
    if (!el || !/\d/.test(t.textContent) || el.closest('script,style,noscript,template,nav,footer,select,option')) continue;
    if (inItem(el)) continue;
    // Facet option counts ("Abgekündigte Produkte 2766") live in filter panels; they are never the total.
    // A facet option is a small row holding a checkbox or radio next to the text.
    let facet = !!el.closest('label,[role="checkbox"],[role="option"],[role="radio"]');
    for (let n = el.parentElement, i = 0; !facet && n && i < 2 && clean(n.innerText, 100).length <= 80; n = n.parentElement, i++) {
      if (n.querySelector('input[type="checkbox"],input[type="radio"]')) facet = true;
    }
    if (facet) continue;
    let text = '';
    for (let i = 0; i < 4 && el; i++, el = el.parentElement) {
      const t = clean(el.innerText, 120);
      if (t.length > 60) break;
      if (COUNT.test(t)) { text = t; break; }
    }
    if (!text || seenCount.has(text) || (text.match(/\d+/g) || []).length > 3 || !shown(el)) continue;
    seenCount.add(text);
    counts.push(text);
  }

  return {
    url: location.href,
    item_signature: itemSignature,
    container_signature: containerSignature,
    containers: new Set(items.map((i) => i.parentElement)).size,
    items: items.map(readItem),
    count_texts: counts,
  };
}
