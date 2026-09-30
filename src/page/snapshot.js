// Runs inside the page. Plain JS on purpose: page.evaluate receives this source as a string.
// Returns bounded, text-only evidence and tags elements so a Jev choice maps back to a real node.
(opts) => {
  const MAX_TEXT = opts?.maxText ?? 3000;
  const MAX_CONTROLS = opts?.maxControls ?? 120;
  const MAX_GROUPS = opts?.maxGroups ?? 8;
  const SAMPLES = opts?.samples ?? 3;

  const clean = (s, n) => (s || '').replace(/[\u00ad\u200b\u200c\u200d\ufeff]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
  const visible = (e) => {
    if (!e || !e.isConnected) return false;
    if (closestDeep(e, '[aria-hidden="true"],[inert]')) return false;
    if (!e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const area = (e) => { const r = e.getBoundingClientRect(); return Math.max(0, r.width) * Math.max(0, r.height); };
  const vw = innerWidth, vh = innerHeight;

  // Walk the light DOM and every open shadow root (consent tools such as Usercentrics live in one).
  const all = [];
  const walk = (root) => {
    for (const e of root.querySelectorAll('*')) {
      all.push(e);
      if (e.shadowRoot) walk(e.shadowRoot);
    }
  };
  if (document.body) walk(document.body);
  const parentOf = (n) => n.parentElement || (n.getRootNode() instanceof ShadowRoot ? n.getRootNode().host : null);
  const closestDeep = (e, sel) => {
    for (let n = e; n; n = parentOf(n)) if (n.matches?.(sel)) return n;
    return null;
  };

  // Clear tags from a previous snapshot so ids never point at stale nodes.
  for (const e of all) {
    if (e.hasAttribute('data-jc-id') || e.hasAttribute('data-jc-group') || e.hasAttribute('data-jc-item') || e.hasAttribute('data-jc-overlay')) {
      e.removeAttribute('data-jc-id'); e.removeAttribute('data-jc-group'); e.removeAttribute('data-jc-item'); e.removeAttribute('data-jc-overlay');
    }
  }

  const overlayRoot = (e) => {
    for (let n = e; n && n !== document.body; n = parentOf(n)) {
      if (n.matches('dialog[open],[role="dialog"],[role="alertdialog"],[aria-modal="true"]')) return n;
      const pos = getComputedStyle(n).position;
      if ((pos === 'fixed' || pos === 'sticky') && area(n) >= 0.04 * vw * vh) return n;
    }
    return null;
  };
  const region = (e) => {
    const r = closestDeep(e, 'nav,header,footer,aside,main,[role="navigation"],[role="banner"],[role="contentinfo"],[role="complementary"],[role="main"]');
    if (!r) return 'none';
    const role = r.getAttribute('role');
    return ({ navigation: 'nav', banner: 'header', contentinfo: 'footer', complementary: 'aside', main: 'main' })[role] || r.tagName.toLowerCase();
  };
  const name = (e) => clean(
    e.getAttribute('aria-label') || e.innerText || e.getAttribute('value') || e.getAttribute('title') ||
    e.querySelector('img[alt]')?.getAttribute('alt') || '', 80);

  // Overlays: dialogs and large fixed layers, reported with their text.
  const overlays = [];
  const seenOverlay = new Set();
  for (const e of all) {
    if (overlays.length >= 6) break;
    const root = overlayRoot(e);
    if (!root || seenOverlay.has(root) || !visible(root)) continue;
    seenOverlay.add(root);
    const text = clean(root.innerText, 500);
    if (!text) continue;
    root.setAttribute('data-jc-overlay', String(overlays.length + 1));
    overlays.push({ id: 'o' + (overlays.length + 1), text, area_pct: Math.round((100 * area(root)) / (vw * vh)) });
  }

  // Controls: visible clickable elements; overlay controls first.
  const clickable = all.filter((e) => e.matches('a[href],button,[role="button"],[role="link"],[role="tab"],input[type="submit"],input[type="button"],summary'))
    .filter((e) => visible(e) && !e.matches(':disabled') && name(e));
  clickable.sort((a, b) => (overlayRoot(b) ? 1 : 0) - (overlayRoot(a) ? 1 : 0));
  const controls = clickable.slice(0, MAX_CONTROLS).map((e, i) => {
    const id = 'c' + (i + 1);
    e.setAttribute('data-jc-id', id);
    const c = { id, label: name(e), role: e.tagName === 'A' ? 'link' : 'button', region: region(e) };
    if (overlayRoot(e)) c.in_overlay = true;
    const href = e.getAttribute('href');
    if (href && !href.startsWith('javascript:')) {
      try { const u = new URL(href, location.href); c.href = u.origin === location.origin ? u.pathname + u.search : u.href; } catch {}
    }
    return c;
  });

  // Repeated sibling groups: candidate lists of products, families, categories, menus.
  const signature = (e) => e.tagName + '.' + [...e.classList].filter((c) => !/active|selected|current|hover|focus|open|first|last|odd|even|\d/.test(c)).sort().join('.');
  const raw = [];
  for (const container of all) {
    if (container.childElementCount < 3) continue;
    const buckets = new Map();
    for (const kid of container.children) {
      if (!visible(kid) || clean(kid.innerText, 2).length < 2) continue;
      const s = signature(kid);
      if (!buckets.has(s)) buckets.set(s, []);
      buckets.get(s).push(kid);
    }
    let items = [];
    for (const b of buckets.values()) if (b.length > items.length) items = b;
    if (items.length < 3) continue;
    raw.push({ container, items, score: items.reduce((sum, e) => sum + area(e), 0) });
  }
  raw.sort((a, b) => b.score - a.score);
  // List items (rows, cards) are built alike; page layout sections are not. Drop groups whose largest
  // item has many elements while the smallest has almost none, e.g. header / content / newsletter
  // sections around a variant table. Such a group would otherwise hide every list nested inside it.
  const top = raw.slice(0, 300);
  const isLayout = (g) => {
    const sizes = g.items.map((it) => it.getElementsByTagName('*').length + 1);
    const max = Math.max(...sizes), min = Math.min(...sizes);
    return max > 50 && min / max < 0.15;
  };
  const listCandidates = top.filter((g) => !isLayout(g));
  const chosen = [];
  for (const g of listCandidates) {
    if (chosen.length >= MAX_GROUPS) break;
    // Skip groups nested inside an item of a chosen group when they are not richer (spec lines inside
    // a card) or are an item's own children (cells of a table row). A richer nested list, such as a
    // variant table inside a content block, is kept.
    if (chosen.some((c) => c.items.some((it) => it.contains(g.container)) &&
      (g.items.length <= c.items.length || c.items.includes(g.container)))) continue;
    // Skip wrappers that contain a larger group's container (same list seen from above).
    if (chosen.some((c) => g.items.some((it) => it.contains(c.container)))) continue;
    chosen.push(g);
  }
  const heading = (e) => {
    const h = document.evaluate('preceding::*[self::h1 or self::h2 or self::h3 or self::h4][1]', e, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
    return h ? clean(h.innerText, 100) : '';
  };
  const groups = chosen.map((g, gi) => {
    const id = 'g' + (gi + 1);
    g.container.setAttribute('data-jc-group', id);
    g.items.forEach((it, ii) => it.setAttribute('data-jc-item', id + ':' + ii));
    // The item's own link is the anchor position whose URL differs across items. A link every card
    // shares (a badge, "product lines", "compare") cannot be the card's own page.
    const anchors = g.items.map((it) => [...(it.matches('a[href]') ? [it] : []), ...it.querySelectorAll('a[href]')]
      .map((a) => a.href).filter((h) => h && !h.startsWith('javascript:')));
    let bestPos = 0, bestDistinct = -1;
    for (let pos = 0; pos < Math.max(0, ...anchors.map((a) => a.length)); pos++) {
      const distinct = new Set(anchors.map((a) => a[pos]).filter(Boolean)).size;
      if (distinct > bestDistinct) { bestDistinct = distinct; bestPos = pos; }
    }
    const ownLinks = anchors.map((a) => a[bestPos] || null);
    const withLink = ownLinks.filter(Boolean);
    const hrefs = new Set(withLink);
    const out = {
      id,
      item_count: g.items.length,
      region: region(g.container),
      heading: heading(g.container),
      items_with_link_pct: Math.round((100 * withLink.length) / g.items.length),
      distinct_links: hrefs.size,
      items_with_image_pct: Math.round((100 * g.items.filter((it) => it.querySelector('img,picture,svg')).length) / g.items.length),
      samples: g.items.slice(0, SAMPLES).map((it) => clean(it.innerText, 220)),
      // Code-only: absolute link of each item (first anchor), used to probe item pages.
      item_links: ownLinks.slice(0, 60),
    };
    if (overlayRoot(g.container)) out.in_overlay = true;
    return out;
  });

  const headings = [...document.querySelectorAll('h1,h2,h3')].filter(visible).slice(0, 20).map((h) => clean(h.innerText, 120)).filter(Boolean);
  const text = clean(document.body?.innerText, MAX_TEXT);
  const fingerprint = [location.href, document.title, overlays.map((o) => o.text).join('|'), controls.length, groups.map((g) => g.item_count).join(',')].join('#');

  return { url: location.href, title: document.title, lang: document.documentElement.lang || '', headings, text, overlays, controls, groups, fingerprint };
}
