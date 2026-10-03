// Detail-page observer. Runs inside the page as a function of the DETAIL_POLICY subset.
// Returns only observed, bounded facts; classification happens elsewhere.
// - identity candidates live in the primary header region before the first technical block
// - controls get fresh data-jc-detail-control ids per read; callers must re-observe before clicks
// - every extracted row/label/value is checked for ancestor visibility itself
// - never collects input values, cookies, credentials or page HTML
(opts) => {
  const P = opts ?? {};
  const MAX_IDENTITY_CANDIDATES = P.maxIdentityCandidates ?? 12;
  const MAX_CONTROLS = P.maxControls ?? 24;
  const MAX_BLOCKS = P.maxBlocks ?? 40;
  const MAX_ROWS = P.maxRowsPerBlock ?? 150;
  const MAX_LINKS = P.maxLinksPerBlock ?? 150;
  const MAX_TEXT = P.maxText ?? 240;
  const MAX_VALUE = P.maxValue ?? 600;
  const MAX_PAGE_TEXT = P.maxPageText ?? 4000;
  const MAX_HEADING_CANDIDATES = P.maxHeadingCandidates ?? 4;
  const MAX_CONTEXT_HEADINGS = P.maxContextHeadings ?? 12;
  const MAX_CONTEXT_DEPTH = P.maxContextDepth ?? 6;
  const MAX_CLASSES_PER_NODE = P.maxClassesPerNode ?? 8;
  const MIN_PEER_ROWS = P.minPeerRows ?? 2;
  const MIN_PEER_COVERAGE = P.minPeerCoverage ?? 0.6;
  const MIN_FLAT_PAIRS = P.minFlatGridPairs ?? 3;
  const MIN_SCOPE_TEXT = P.minScopeText ?? 250;

  const strip = (t) => String(t ?? '').normalize('NFC').replace(/[\u00ad\u200b\u200c\u200d\ufeff]/g, '');
  const truncated = new Set();
  // kind marks where data was clipped: candidate/label/value/control mean real evidence loss;
  // text is summary-only clipping and handled separately by the caller.
  const clip = (t, max, kind) => {
    const s = strip(t).replace(/\s+/g, ' ').trim();
    if (s.length > max && kind) truncated.add(kind);
    return s.slice(0, max);
  };
  const clean = (t, max = MAX_TEXT) => clip(t, max, null);
  const cleanValue = (t) => {
    const s = strip(t).split('\n').map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
    if (s.length > MAX_VALUE) truncated.add('value');
    return s.slice(0, MAX_VALUE);
  };
  const out = { candidates: [], controls: [], blocks: [], truncated: [], unsupported_frames: 0, text: '', fingerprint: '', scope: 'none', title: document.title ?? '' };

  // ---------- DOM traversal ----------
  const deepChildren = (root, bag = []) => {
    for (const c of root.querySelectorAll('*')) {
      bag.push(c);
      if (c.shadowRoot) deepChildren(c.shadowRoot, bag);
    }
    return bag;
  };
  const all = deepChildren(document);
  const parentOf = (e) => e.parentElement ?? e.getRootNode().host ?? null;
  const closestDeep = (e, sel) => {
    for (let n = e; n; n = parentOf(n)) {
      if (n.nodeType !== 1) break;
      if (n.matches?.(sel)) return n;
    }
    return null;
  };
  const prevSibling = (e) => {
    let s = e.previousElementSibling;
    if (s) return s;
    const p = parentOf(e);
    if (!p) return null;
    const kids = [...p.children];
    const i = kids.indexOf(e);
    return i > 0 ? kids[i - 1] : null;
  };
  const byId = (id) => all.find((e) => e.id === id) ?? null;
  // Any ancestor whose computed style hides this element, walking shadow boundaries.
  const hiddenAncestor = (e) => {
    for (let n = parentOf(e); n && n !== document.documentElement; n = parentOf(n)) {
      if (n.nodeType !== 1) continue;
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse' || cs.opacity === '0') return true;
    }
    return false;
  };
  // An element's own rendering. display:contents has no box but still renders text, so it is
  // allowed through when it has rendered children or text, after hidden ancestors are checked.
  const visible = (e) => {
    if (!e || !e.isConnected) return false;
    if (closestDeep(e, '[aria-hidden="true"],[inert]')) return false;
    if (hiddenAncestor(e)) return false;
    const cs = getComputedStyle(e);
    if (cs.display === 'contents') {
      for (const n of e.childNodes) if (n.nodeType === 3 && strip(n.textContent).trim()) return true;
      return [...e.children].some(visible);
    }
    try {
      if (!e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    } catch {
      return false;
    }
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const before = (a, b) => !!(a.compareDocumentPosition(b) & 4); // b follows a
  // Rendered text under an element, skipping controls, forms, script/style and invisible spans.
  // Parent block boundaries become line breaks so units on separate lines stay readable.
  const textOf = (el) => {
    const parts = [];
    let last = null;
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let t = w.nextNode(); t; t = w.nextNode()) {
      const p = t.parentElement;
      if (!p || closestDeep(p, 'button,[role="button"],select,input,script,style,noscript,template,form,[aria-hidden="true"],[inert]')) continue;
      if (!visible(p)) continue;
      const d = getComputedStyle(p).display;
      const blocky = /^(block|list-item|grid|flex|table|table-row|table-cell|table-row-group)$/u.test(d);
      if (last && p !== last && blocky) parts.push('\n');
      parts.push(t.textContent);
      last = p;
    }
    return parts.join(' ');
  };
  const headingsIn = (el) => {
    const outH = [];
    const descend = (n) => {
      for (const c of n.children) {
        if (/^H[1-6]$/.test(c.tagName)) outH.push(c);
        if (c.shadowRoot) descend(c.shadowRoot);
        descend(c);
      }
    };
    descend(el);
    return outH.filter(visible);
  };

  // ---------- Product scope ----------
  // main/[role=main] when present, else the smallest substantial ancestor of the primary h1.
  const landmarks = all.filter((e) => (e.tagName === 'MAIN' || e.getAttribute('role') === 'main') && visible(e));
  let scope = landmarks[0] ?? null;
  let scopeKind = scope ? 'main' : 'none';
  if (!scope) {
    const h1 = all.find((e) => e.tagName === 'H1' && visible(e) && !closestDeep(e, 'header,nav,footer,[role="banner"],[role="navigation"],[role="contentinfo"]'));
    for (let n = parentOf(h1 ?? document.body); n && n !== document.body && n !== document.documentElement; n = parentOf(n)) {
      if ((n.innerText || '').trim().length > MIN_SCOPE_TEXT) { scope = n; scopeKind = 'product'; break; }
      if (!scope) scope = n;
    }
    scopeKind = scope ? scopeKind === 'none' ? 'product' : scopeKind : 'none';
  }
  const inScope = (e) => !scope || e === scope || scope.contains(e) || e.getRootNode() !== document && [...document.querySelectorAll('*')].some((h) => h.shadowRoot === e.getRootNode() && scope.contains(h));
  const inGlobalChrome = (e) => {
    if (!e) return false;
    if (e.matches('header,nav,footer,aside') && e !== scope && !scope?.contains(e)) return true;
    return !!closestDeep(e, 'header,nav,footer,aside,[role="banner"],[role="navigation"],[role="contentinfo"]')
      && !closestDeep(e, 'main,[role="main"],article,[role="article"]');
  };
  const excluded = (e) => !!closestDeep(e, 'form,[data-cart],[data-basket],[class*="cart"],[class*="basket"],[class*="related"],[class*="accessor"],[class*="compare"]');

  // ---------- Sections ----------
  // Heading ancestry only: a details' own summary, a table's caption, an aria-labelledby target,
  // an accordion header wired to this region, then the last visible heading before el.
  const ACC_HEAD = /header|title|trigger|toggle|expander|collapser/i;
  const ACC_BODY = /content|body|panel|region|collapse|inner|detail/i;
  const ownHeading = (n) => {
    const found = [];
    // The primary product h1 is never a section heading, whichever source it came from.
    const push = (el, via) => {
      if (!el || (scopeFirstH1 && (el === scopeFirstH1 || el.contains(scopeFirstH1)))) return;
      const t = clean(el.innerText, 80);
      if (t) found.push({ el, via, text: t });
    };
    if (n.tagName === 'DETAILS') push([...n.children].find((c) => c.tagName === 'SUMMARY'), 'summary');
    if (n.tagName === 'TABLE') push([...n.children].find((c) => c.tagName === 'CAPTION' && visible(c)), 'caption');
    const by = n.getAttribute && n.getAttribute('aria-labelledby');
    if (by) for (const id of by.split(/\s+/)) push(byId(id), 'aria_labelledby');
    const prev = prevSibling(n);
    // A previous sibling only contributes as a genuine local accordion pair: n carries the body
    // class, prev carries the header class, lives in the product scope outside global chrome,
    // is visible, and is not the product h1 (checked by push). Classes like site-header or
    // product-title-header match ACC_HEAD but fail these checks.
    if (prev && ACC_BODY.test(typeof n.className === 'string' ? n.className : '')
      && ACC_HEAD.test(typeof prev.className === 'string' ? prev.className : '')
      && inScope(prev) && visible(prev) && !inGlobalChrome(prev)) {
      push(prev, 'accordion_header');
    }
    return found;
  };
  // A heading inside ancestor n qualifies the element only when it is a direct child of n or
  // inside the subtree that contains el, so a sibling section's heading is never borrowed.
  const scopeFirstH1 = scope ? headingsIn(scope).find((h) => h.tagName === 'H1') : null;
  const sectionOf = (el) => {
    const parts = [];
    for (const h of ownHeading(el)) if (h.text && !parts.includes(h.text)) parts.unshift(h.text);
    for (let n = parentOf(el); n && n !== document.body; n = parentOf(n)) {
      const texts = ownHeading(n);
      let onPath = el;
      while (parentOf(onPath) && parentOf(onPath) !== n) onPath = parentOf(onPath);
      const topOf = (x) => { let c = x; while (parentOf(c) && parentOf(c) !== n) c = parentOf(c); return c; };
      const hs = headingsIn(n).filter((x) => {
        if (x === el || el.contains(x) || x === scopeFirstH1 || !before(x, el) || !visible(x)) return false;
        const cx = topOf(x);
        return cx === onPath || cx === x;
      });
      const last = hs[hs.length - 1];
      if (last) texts.push({ el: last, via: 'heading', text: clean(last.innerText, 80) });
      for (const h of texts) if (h.text && !parts.includes(h.text)) parts.unshift(h.text);
      if (n === scope) break;
    }
    return parts;
  };
  const headingIds = new Map();
  const evidenceTruncated = new Set();
  const clipEvidence = (bag, kind) => {
    bag.add(kind);
    evidenceTruncated.add(kind);
  };
  const headingId = (el) => {
    const had = headingIds.get(el);
    if (had) return had;
    const id = 'h' + (headingIds.size + 1);
    headingIds.set(el, id);
    return id;
  };
  const headingTrail = (el, bag) => {
    const trail = [];
    const seen = new Set();
    const note = (x, via, relation, depth) => {
      if (!x || seen.has(x) || !visible(x)) return;
      if (trail.length >= MAX_CONTEXT_HEADINGS) { clipEvidence(bag, 'headings'); return; }
      const t = clean(x.innerText, 80);
      if (!t) return;
      seen.add(x);
      trail.push({ id: headingId(x), text: t, tag: x.tagName.toLowerCase(), via, itemprop: x.getAttribute('itemprop') ?? '', relation, depth });
    };
    for (const h of ownHeading(el)) note(h.el, h.via, 'own', 0);
    let depth = 0;
    for (let n = parentOf(el); n && n !== document.body; n = parentOf(n)) {
      depth++;
      for (const h of ownHeading(n)) note(h.el, h.via, 'ancestor', depth);
      let onPath = el;
      while (parentOf(onPath) && parentOf(onPath) !== n) onPath = parentOf(onPath);
      const topOf = (x) => { let c = x; while (parentOf(c) && parentOf(c) !== n) c = parentOf(c); return c; };
      const hs = headingsIn(n).filter((x) => {
        if (x === el || el.contains(x) || x === scopeFirstH1 || !before(x, el) || !visible(x)) return false;
        const cx = topOf(x);
        return cx === onPath || cx === x;
      });
      const last = hs[hs.length - 1];
      if (last) note(last, 'heading', 'ancestor', depth);
      if (n === scope) break;
    }
    return trail;
  };
  const nodePath = (el, bag) => {
    const chain = [];
    for (let n = el; n && n.nodeType === 1 && n !== document.body; n = parentOf(n)) {
      const cls = typeof n.className === 'string' ? n.className.split(/\s+/).filter(Boolean) : [];
      const classes = cls.slice(0, MAX_CLASSES_PER_NODE);
      if (cls.length > MAX_CLASSES_PER_NODE) clipEvidence(bag, 'context');
      chain.unshift({ tag: n.tagName.toLowerCase(), role: n.getAttribute('role') ?? '', itemprop: n.getAttribute('itemprop') ?? '', classes });
      if (n === scope) break;
    }
    if (chain.length > MAX_CONTEXT_DEPTH) {
      clipEvidence(bag, 'context');
      return [chain[0], ...chain.slice(-(MAX_CONTEXT_DEPTH - 1))];
    }
    return chain;
  };
  const containsDeep = (host, el) => {
    for (let n = el; n; n = parentOf(n)) if (n === host) return true;
    return false;
  };

  const cells = (r) => [...r.children].filter((c) => /^(TD|TH)$/.test(c.tagName));
  let rowSeq = 0;
  const rowOf = (labelEl, valueEl, kind) => ({
    label: clip(textOf(labelEl), 120, 'label'), value: cleanValue(textOf(valueEl)),
    evidence: { id: 'r' + (++rowSeq), kind, label_tag: labelEl.tagName.toLowerCase(), value_tag: valueEl.tagName.toLowerCase() },
  });
  const tableRowKind = (r, cs) => {
    if (closestDeep(r, 'thead')) return 'table_header';
    if (cs.some((c) => c.getAttribute('role') === 'columnheader')) return 'table_header';
    if (cs.every((c) => c.tagName === 'TH')) return 'table_header';
    return 'table_row';
  };
  const okLabel = (s) => s && s.length <= 80 && !/^(compare|share|print|download|add to|cart|login|sign in)$/i.test(s)
    && !/^\d+$/.test(s) && !/(<|>)/.test(s);
  const leafLabelText = (x) => (x && visible(x) && !x.querySelector('*') ? clean(x.innerText, 80) : '');
  const docTitle = (a) => {
    const prev = leafLabelText(a.previousElementSibling);
    if (prev) return prev;
    const pp = a.parentElement?.previousElementSibling;
    return pp ? leafLabelText(pp) : '';
  };
  let linkSeq = 0;
  const safeHref = (href) => {
    try { const u = new URL(href); return !u.username && !u.password; } catch { return false; }
  };
  const linksOf = (root) => {
    const links = [];
    for (const a of root.querySelectorAll('a[href]')) {
      if (links.length >= MAX_LINKS) { truncated.add('links'); break; }
      if (!visible(a) || !/^https?:/i.test(a.href ?? '') || !safeHref(a.href)) continue;
      if (!P.includeDocumentLinks) {
        const label = clip(a.innerText, 80, 'label');
        if (label) links.push({ label, url: a.href });
        continue;
      }
      const title = docTitle(a);
      const label = clip(a.innerText, 80, 'label')
        || clean(a.getAttribute('aria-label') ?? '', 80)
        || clean(a.getAttribute('title') ?? '', 80)
        || title;
      if (label) {
        links.push({
          id: 'l' + (++linkSeq), label, url: a.href,
          ...(title ? { document_title: title } : {}),
          download_attribute: a.getAttribute('download') ?? '',
          ...(a.hasAttribute('download') ? { has_download: true } : {}),
        });
      }
    }
    return links;
  };

  // ---------- Blocks ----------
  // Only clearly labelled shapes: two-cell tables, adjacent dt/dd pairs, signature-bound peer
  // rows, real CSS-grid flat pairs and colon-labelled lines. Links are collected per block.
  const blocks = [];
  const blockEls = new Set();
  const addBlock = (el, kind, rows, links, rowCount) => {
    if (blocks.length >= MAX_BLOCKS) { truncated.add('blocks'); return; }
    blockEls.add(el);
    const section = sectionOf(el);
    // A rowless link block often wraps its own single heading; adopt it as the section. Zero or
    // several headings inside are never guessed.
    let adopted = null;
    if (!rows.length && links.length) {
      const hs = headingsIn(el).filter((h) => h.tagName !== 'H1' && visible(h) && h !== scopeFirstH1);
      if (hs.length === 1) {
        const t = clean(hs[0].innerText, 80);
        if (t && !section.includes(t)) section.push(t);
        adopted = hs[0];
      }
    }
    const bag = new Set();
    const evidence = { headings: headingTrail(el, bag), path: nodePath(el, bag), excluded: excluded(el) };
    if (adopted && !evidence.headings.some((h) => h.id === headingIds.get(adopted))) {
      if (evidence.headings.length >= MAX_CONTEXT_HEADINGS) clipEvidence(bag, 'headings');
      else {
        const t = clean(adopted.innerText, 80);
        if (t) evidence.headings.push({ id: headingId(adopted), text: t, tag: adopted.tagName.toLowerCase(), via: 'heading', itemprop: adopted.getAttribute('itemprop') ?? '', relation: 'own', depth: 0 });
      }
    }
    if (bag.size) evidence.truncated = [...bag];
    blocks.push({ id: 'b' + (blocks.length + 1), el, section, kind, rows, links, total_rows: rowCount ?? rows.length, evidence });
  };
  const inBlock = (el) => { for (const b of blockEls) if (b.contains(el)) return true; return false; };
  const wrapsBlock = (el) => { for (const b of blockEls) if (el.contains(b)) return true; return false; };

  if (scope) {
    // Tables: rows of exactly two cells. Multi-column tables are variant or comparison tables.
    for (const t of all) {
      if (t.tagName !== 'TABLE' || !inScope(t) || !visible(t) || inGlobalChrome(t)) continue;
      const trs = [...t.querySelectorAll('tr')].filter((r) => visible(r) && cells(r).length === 2 && !inBlock(r));
      const hdr = cells(trs[0] ?? t);
      if (hdr.length && !okLabel(clean(hdr[0].innerText, 120))) continue; // variant table with a real header row
      const rows = [];
      for (const r of trs) {
        if (blocks.length >= MAX_BLOCKS || rows.length >= MAX_ROWS) { truncated.add('rows'); break; }
        const [k, v] = cells(r);
        if (!visible(k) || !visible(v)) continue;
        const row = rowOf(k, v, tableRowKind(r, cells(r)));
        if (row.label && row.value && okLabel(row.label)) rows.push(row);
      }
      const links = linksOf(t);
      if (rows.length || links.length) addBlock(t, 'table', rows, links, trs.length);
    }
    // Definition lists: only immediately adjacent dt+dd pairs; a stray dt is never rebound.
    for (const d of all) {
      if (d.tagName !== 'DL' || !inScope(d) || !visible(d) || inGlobalChrome(d) || inBlock(d)) continue;
      const rows = [];
      for (const c of d.children) {
        if (blocks.length >= MAX_BLOCKS || rows.length >= MAX_ROWS) { truncated.add('rows'); break; }
        if (c.tagName !== 'DT' || !visible(c)) continue;
        const v = c.nextElementSibling;
        if (!v || v.tagName !== 'DD' || !visible(v)) continue;
        const row = rowOf(c, v, 'definition_pair');
        if (row.label && row.value && okLabel(row.label)) rows.push(row);
      }
      const links = linksOf(d);
      if (rows.length || links.length) addBlock(d, 'dl', rows, links);
    }
    // Peer two-cell rows, flat CSS grids and colon-labelled lines.
    for (const c of all) {
      if (!c.matches('div,ul,ol,section,article,fieldset') || !inScope(c) || !visible(c) || inGlobalChrome(c)) continue;
      if (blockEls.has(c) || inBlock(c) || wrapsBlock(c)) continue;
      const kids = [...c.children].filter(visible);
      const links = linksOf(c);
      if (kids.length < 2 && !links.length) continue;
      const rows = [];
      const sig = (e) => `${e.tagName}|${typeof e.className === 'string' ? e.className : ''}`;
      // Peer rows: children with exactly two element children each, all sharing one signature,
      // none carrying headings, disclosure controls, links, forms or a nested table row.
      const badKid = (k) => !!k.querySelector('h1,h2,h3,h4,h5,h6,button,a,input,select,summary,tr,td,table,[role="tab"],[aria-expanded],[aria-controls]');
      const pairs = kids.filter((k) => k.childElementCount === 2 && !badKid(k));
      if (pairs.length >= MIN_PEER_ROWS && pairs.length / kids.length >= MIN_PEER_COVERAGE
        && new Set(pairs.map(sig)).size === 1) {
        for (const k of pairs) {
          if (rows.length >= MAX_ROWS) { truncated.add('rows'); break; }
          const [l, v] = k.children;
          if (!visible(l) || !visible(v)) continue;
          const row = rowOf(l, v, 'peer_row');
          if (row.label && row.value && okLabel(row.label)) rows.push(row);
        }
      } else if (kids.length >= MIN_FLAT_PAIRS * 2 && kids.length % 2 === 0) {
        // Flat grid: computed display grid, one element signature, alternating label and value.
        const cs = getComputedStyle(c);
        if (/(^|\s|inline-)grid$/.test(cs.display) && new Set(kids.map(sig)).size === 1 && kids.every((k) => !badKid(k) && !k.childElementCount)) {
          for (let i = 0; i + 1 < kids.length && rows.length < MAX_ROWS; i += 2) {
            if (!visible(kids[i]) || !visible(kids[i + 1])) continue;
            const row = rowOf(kids[i], kids[i + 1], 'grid_pair');
            if (row.label && row.value && okLabel(row.label)) rows.push(row);
          }
          if (!rows.length) links.length = 0;
        }
      }
      if (!rows.length) {
        // Visible colon-labelled lines, e.g. plain `li` items of the form "Label: value".
        const colon = kids.filter((k) => /^[^:]{1,60}:\s*\S/.test(k.innerText ?? '') && !badKid(k) && !k.childElementCount);
        if (colon.length >= MIN_PEER_ROWS && colon.length / kids.length >= MIN_PEER_COVERAGE) {
          for (const k of colon) {
            if (rows.length >= MAX_ROWS) { truncated.add('rows'); break; }
            const [label, ...rest] = String(textOf(k)).split(':');
            const row = { label: clip(label, 120, 'label'), value: cleanValue(rest.join(':')),
              evidence: { id: 'r' + (++rowSeq), kind: 'colon_pair', label_tag: k.tagName.toLowerCase(), value_tag: k.tagName.toLowerCase() } };
            if (row.label && row.value && okLabel(row.label)) rows.push(row);
          }
        }
      }
      // A link-only section is allowed, but a lone link only counts inside a real list.
      const listish = /^(UL|OL)$/.test(c.tagName);
      if (rows.length || links.length >= 2 || (links.length === 1 && listish)) addBlock(c, 'rows', rows, links);
    }
  }

  // ---------- Identity candidates ----------
  // Only the primary header region: elements before the first technical block, never inside a
  // related/accessory/compare section and never derived from the URL.
  const RELATED_SECTION = /accessor|related|similar|spare|recommend|compare|compatible|alternative/i;
  // Only blocks with real label/value rows bound the header region; a link-only nav row does not.
  const blockList = blocks.filter((b) => b.rows.length > 0).map((b) => b.el);
  blockList.sort((a, b) => (a.compareDocumentPosition(b) & 4 ? -1 : 1));
  const firstBlockEl = blockList[0] ?? null;
  const inHeaderRegion = (e) => !firstBlockEl || before(e, firstBlockEl);
  const inRelatedSection = (e) => sectionOf(e).some((s) => RELATED_SECTION.test(s));
  const candidateOk = (e) => inScope(e) && !inGlobalChrome(e) && !excluded(e) && inHeaderRegion(e) && !inRelatedSection(e);
  const pushCandidate = (source, via, el, value) => {
    if (out.candidates.length >= MAX_IDENTITY_CANDIDATES) { truncated.add('candidates'); return; }
    const v = clip(value, 80, 'candidate');
    if (!v) return;
    out.candidates.push({ id: 'c' + (out.candidates.length + 1), source, via, value: v, context: clean((el.innerText ?? el.textContent ?? ''), 120), section: sectionOf(el) });
  };
  if (scope) {
    const META_KEYS = /^(sku|mpn|model|productID|productId|gtin|gtin8|gtin12|gtin13|gtin14|isbn|itemCondition)$/i;
    const LABELS = /^(item|article|part|order|ordering|catalog|catalogue|model|product|sku|code|drawing|type|material|mat\.?)\s*(no\.?|number|#|code)?\s*:?$/i;
    for (const e of all) {
      if (!inScope(e) || !visible(e) || inGlobalChrome(e) || excluded(e)) continue;
      const key = e.getAttribute('itemprop') ?? e.getAttribute('data-product-id-attr') ?? '';
      if (META_KEYS.test(key) && candidateOk(e)) pushCandidate('metadata', key, e, e.textContent);
    }
    const seenPair = new Set();
    for (const e of all) {
      if (!inScope(e) || !visible(e) || inGlobalChrome(e) || excluded(e) || !candidateOk(e)) continue;
      if (e.children.length > 4) continue;
      const own = clean([...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' '), 60) || clean(e.innerText, 60);
      if (!LABELS.test(own)) continue;
      let v = null;
      if (e.tagName === 'DT') {
        // Only the immediately adjacent dd ever binds to a dt.
        const n = e.nextElementSibling;
        if (n && n.tagName === 'DD' && visible(n)) v = n;
      } else {
        // Prefer the inline value. For sibling values, skip non-rendered metadata.
        const kids = [...e.children].filter(visible);
        if (kids.length === 1) {
          v = kids[0];
        } else {
          let sib = e.nextElementSibling;
          while (sib && (!visible(sib) || /^(META|LINK|SCRIPT|STYLE|TEMPLATE)$/.test(sib.tagName))) sib = sib.nextElementSibling;
          if (sib) v = sib;
        }
      }
      const val = v && visible(v) && candidateOk(v) ? clip(textOf(v), 80, 'candidate') : '';
      if (!val || seenPair.has(val)) continue;
      seenPair.add(val);
      pushCandidate('labelled', own.replace(/:$/, ''), e, val);
    }
    // h1/h2 tokens: code-like token inside a primary heading, with the heading as context.
    const CODE_TOKEN = /^(?=.{3,32}$)[A-Z0-9][A-Z0-9-._/]*[A-Z0-9]$/;
    const hs = all.filter((e) => /^H[12]$/.test(e.tagName) && visible(e) && inScope(e) && candidateOk(e)).slice(0, MAX_HEADING_CANDIDATES);
    for (const h of hs) {
      const words = clean(h.innerText, 120).split(' ');
      // A complete heading code needs a digit plus a letter or a separator, so a Deublin-style
      // "1005-000-001" qualifies while a lone "73" does not.
      const hits = words.filter((w) => CODE_TOKEN.test(w) && /\d/.test(w) && (/[A-Z]/i.test(w) || /[-._/]/.test(w)));
      for (const w of hits.slice(0, 2)) pushCandidate('heading', h.tagName.toLowerCase(), h, w);
    }
  }

  // ---------- Disclosure controls ----------
  // Fresh ids per read: clear every tag from a previous observation first, including tags left
  // on now-hidden controls, so a stale id can never collide with a newly offered one.
  for (const e of all) e.removeAttribute('data-jc-detail-control');
  // Proof of disclosure only: wired tabs, buttons with a local panel, details summaries, and
  // accordion headers with a sibling content region. No submit buttons, no external links.
  const controls = [];
  const seenCtl = new Set();
  const panelHeading = (p) => {
    if (!p || p.tagName === 'DETAILS') return '';
    const h = headingsIn(p).find(visible);
    if (h) return clean(h.innerText, 80);
    const al = p.getAttribute('aria-label');
    if (al) return clean(al, 80);
    const by = p.getAttribute('aria-labelledby');
    if (by) {
      const t = byId(by.split(/\s+/)[0]);
      if (t) return clean(t.innerText, 80);
    }
    return '';
  };
  const addControl = (e, kind, panel) => {
    if (seenCtl.has(e)) return;
    seenCtl.add(e);
    if (controls.length >= MAX_CONTROLS) { truncated.add('controls'); return; }
    const label = clip(e.getAttribute('aria-label') ?? e.innerText, 80, 'control');
    if (!label) return;
    let expanded = false;
    if (kind === 'summary') expanded = e.parentElement?.open === true;
    else {
      const ae = e.getAttribute('aria-expanded');
      const as = e.getAttribute('aria-selected');
      if (ae !== null) expanded = ae === 'true';
      else if (as !== null && kind === 'tab') expanded = as === 'true';
      else if (panel) expanded = visible(panel) && !!strip(textOf(panel)).trim();
    }
    const bag = new Set();
    controls.push({
      id: 'd' + (controls.length + 1), label, kind,
      panel_heading: panelHeading(panel), expanded,
      section: sectionOf(e),
      evidence: { headings: headingTrail(e, bag), path: nodePath(e, bag), excluded: excluded(e) },
      _panel: panel ?? null,
    });
    if (bag.size) controls[controls.length - 1].evidence.truncated = [...bag];
    e.setAttribute('data-jc-detail-control', controls[controls.length - 1].id);
  };
  for (const e of all) {
    if (!inScope(e) || !visible(e) || inGlobalChrome(e)) continue;
    if (e.matches('[role="tab"]')) {
      const id = e.getAttribute('aria-controls') ?? '';
      const panel = id ? byId(id) : null;
      addControl(e, 'tab', panel && inScope(panel) ? panel : null);
      continue;
    }
    if (e.tagName === 'SUMMARY') { addControl(e, 'summary', e.parentElement); continue; }
    if (e.matches('button,[role="button"],a[href^="#"]') && !e.matches('input[type="submit"],button[type="submit"]')) {
      const ac = e.getAttribute('aria-controls') ?? e.getAttribute('data-bs-target')?.replace(/^#/, '') ?? '';
      const href = e.tagName === 'A' ? (e.getAttribute('href') ?? '').slice(1) : '';
      const panel = (ac ? byId(ac) : null) ?? (href ? byId(href) : null);
      if (panel && inScope(panel)) addControl(e, e.matches('[role="tab"]') ? 'tab' : 'accordion', panel);
      continue;
    }
    // Sibling accordion: header next to a body/content/region element (e.g. WAGO tabs).
    const sib = e.nextElementSibling;
    if (sib && ACC_HEAD.test(typeof e.className === 'string' ? e.className : '')
      && ACC_BODY.test(typeof sib.className === 'string' ? sib.className : '')) {
      addControl(e, 'accordion', sib);
    }
  }

  // ---------- Page text and fingerprint ----------
  const leafText = (root) => {
    const parts = [];
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let t = w.nextNode(); t; t = w.nextNode()) {
      const p = t.parentElement;
      if (!p || closestDeep(p, 'script,style,noscript,template,[aria-hidden="true"],[inert]')) continue;
      if (!visible(p)) continue;
      parts.push(t.textContent.trim());
    }
    return parts.filter(Boolean);
  };
  if (scope) {
    const parts = leafText(scope);
    let text = '';
    for (const p of parts) {
      if (text.length + p.length > MAX_PAGE_TEXT) { truncated.add('text'); break; }
      text += (text ? '\n' : '') + p;
    }
    out.text = text;
  }
  out.blocks = blocks;
  out.controls = controls;
  // Content fingerprint: control/expanded state plus bounded labels, values and link urls, so an
  // in-place value swap or a state flip counts as a real change.
  let fp = '';
  for (const c of controls) fp += `${c.kind}:${c.label}:${c.expanded};`;
  for (const b of blocks) {
    fp += `${b.kind}|`;
    for (const r of b.rows) fp += `${r.label}=${r.value.slice(0, 80)},`;
    for (const l of b.links) fp += `${l.label}->${l.url},`;
    fp += ';';
    if (fp.length > MAX_PAGE_TEXT) break;
  }
  let h = 5381;
  for (const c of fp.slice(0, MAX_PAGE_TEXT)) h = ((h << 5) + h + c.charCodeAt(0)) | 0;
  out.fingerprint = String(h >>> 0);
  // Content-bearing iframes are not read. A large visible frame whose document is unreachable
  // (cross-origin or sandboxed) counts as unsupported; hidden or tiny ones are ignored.
  for (const f of document.querySelectorAll('iframe,frame')) {
    const r = f.getBoundingClientRect();
    if (!visible(f) || r.width < 200 || r.height < 150) continue;
    try {
      const d = f.contentDocument;
      if (!d || (d.body?.innerText ?? '').trim().length > 200) out.unsupported_frames++;
    } catch {
      out.unsupported_frames++;
    }
  }
  if (P.includeDocumentLinks) {
    const seenPanels = new Set();
    for (const c of controls) {
      const p = c._panel;
      if (!p || seenPanels.has(p) || blockEls.has(p)) continue;
      seenPanels.add(p);
      if (!inScope(p) || inGlobalChrome(p) || excluded(p)) continue;
      const links = linksOf(p);
      if (!links.length) continue;
      addBlock(p, 'rows', [], links, 0);
    }
  }
  out.scope = scopeKind;
  const panelIds = new Map();
  for (const b of blocks) {
    let best = null;
    for (const c of controls) {
      const p = c._panel;
      if (!p || !containsDeep(p, b.el)) continue;
      if (!best || containsDeep(best.panel, p)) best = { panel: p, control: c };
    }
    if (!best) continue;
    let pid = panelIds.get(best.panel);
    if (!pid) { pid = 'p' + (panelIds.size + 1); panelIds.set(best.panel, pid); }
    let ph = null;
    for (const h of ownHeading(best.panel)) {
      if (visible(h.el) && h.el !== b.el && !b.el.contains(h.el)) { ph = h.el; break; }
    }
    if (!ph) {
      ph = [...best.panel.children].find((x) => /^H[1-6]$/.test(x.tagName) && visible(x) && x !== b.el && !b.el.contains(x)) ?? null;
    }
    const ariaTitle = clean(best.panel.getAttribute('aria-label') ?? '', 80);
    b.evidence.panel = { id: pid, label: ph ? clean(ph.innerText, 80) : ariaTitle || best.control.label, control_id: best.control.id };
    if (ph && ph !== scopeFirstH1 && !b.evidence.headings.some((h) => h.id === headingIds.get(ph))) {
      const t = clean(ph.innerText, 80);
      if (t) {
        if (b.evidence.headings.length >= MAX_CONTEXT_HEADINGS) {
          (b.evidence.truncated ??= []).push('headings');
          evidenceTruncated.add('headings');
        } else {
          let depth = 0;
          for (let n = parentOf(b.el); n && n !== best.panel; n = parentOf(n)) depth++;
          b.evidence.headings.push({ id: headingId(ph), text: t, tag: ph.tagName.toLowerCase(), via: 'panel_label', itemprop: ph.getAttribute('itemprop') ?? '', relation: 'ancestor', depth });
        }
      }
    }
  }
  for (const b of blocks) delete b.el;
  for (const c of controls) delete c._panel;
  out.truncated = [...truncated];
  if (evidenceTruncated.size) out.evidence_truncated = [...evidenceTruncated];
  return out;
}
