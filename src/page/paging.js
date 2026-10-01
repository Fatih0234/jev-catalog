// Runs inside the page. Collects controls that might page through a list: numbered pages, next and
// previous arrows, "load more", rel=next, and page-size selects. Tags each with data-jc-page.
// opts.itemSignature + opts.containerSignature locate the list items (same template as items.js).
(opts) => {
  const MAX = opts?.max ?? 30;
  const clean = (s, n) => (s || '').replace(/[\u00ad\u200b\u200c\u200d\ufeff]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
  const signature = (e) => e.tagName + '.' + [...e.classList].filter((c) => !/active|selected|current|hover|focus|open|first|last|odd|even|\d/.test(c)).sort().join('.');
  const shown = (e) => e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && e.getBoundingClientRect().width > 0;

  for (const e of document.querySelectorAll('[data-jc-page]')) e.removeAttribute('data-jc-page');

  const tag = opts.itemSignature.split('.')[0];
  const items = [...document.querySelectorAll(tag)].filter((e) => signature(e) === opts.itemSignature && e.parentElement && signature(e.parentElement) === opts.containerSignature && shown(e));
  const itemSet = new Set(items);
  const inItem = (el) => { for (let n = el; n; n = n.parentElement) if (itemSet.has(n)) return true; return false; };
  const top = Math.min(...items.map((i) => i.getBoundingClientRect().top + scrollY));
  const bottom = Math.max(...items.map((i) => i.getBoundingClientRect().bottom + scrollY));

  const PAGER = '[class*="pagination" i],[class*="pager" i],[class*="paging" i],[class*="pagenav" i],[aria-label*="pagination" i],[aria-label*="seiten" i],[aria-label*="page" i][role="navigation"]';
  const WORD = /^(next|previous|prev|first|last|weiter|zurück|nächste|vorherige|erste|letzte|vor|suivant|précédent|siguiente|anterior|avanti|indietro|sonraki|önceki|load more|show more|more|view more|see more|mehr|mehr laden|mehr anzeigen|weitere|weitere laden|weitere anzeigen|alle anzeigen|show all|view all|daha fazla|›|»|‹|«|>|<|→|←|>>|<<|\.\.\.|…|\d{1,4})$/i;
  const HINT = /next|prev|weiter|zurück|nächst|vorher|more|mehr|page|seite|pagin|chevron|arrow|load/i;

  const DISABLED = /^(is-)?disabled$|[-_]disabled$/i;
  const CURRENT = /^(is-)?(active|current|selected)$|[-_](active|current|selected)$/i;
  const hasToken = (e, re) => !!e && [...(e.classList || [])].some((c) => re.test(c));
  const labelOf = (e) => clean(e.innerText || e.getAttribute('value') || '', 60);
  const hintOf = (e) => clean([e.getAttribute('aria-label'), e.getAttribute('title'), e.getAttribute('rel'), typeof e.className === 'string' ? e.className : '',
    e.querySelector('svg,i,span[class]')?.getAttribute('class') || '', e.querySelector('use')?.getAttribute('href') || ''].filter(Boolean).join(' '), 120);

  const candidates = [];
  const seen = new Set();
  for (const e of document.querySelectorAll('a[href],button,[role="button"],[role="link"],input[type="button"],input[type="submit"],li[onclick],span[onclick]')) {
    if (candidates.length >= MAX) break;
    if (seen.has(e) || inItem(e) || !shown(e) || e.closest('header,footer,[role="banner"],[role="contentinfo"]')) continue;
    const label = labelOf(e);
    const hint = hintOf(e);
    const inPager = !!e.closest(PAGER);
    if (!(inPager || WORD.test(label) || (!label && HINT.test(hint)) || (label.length <= 30 && /more|mehr|weitere|next|weiter/i.test(label)))) continue;
    const r = e.getBoundingClientRect();
    const y = r.top + scrollY;
    const position = y >= top - 2 && y <= bottom + 2 ? 'beside' : y < top ? (top - y <= 500 ? 'above' : 'far') : (y - bottom <= 700 ? 'below' : 'far');
    if (position === 'far' && !inPager) continue;
    seen.add(e);
    const id = 'p' + (candidates.length + 1);
    e.setAttribute('data-jc-page', id);
    const href = e.getAttribute('href');
    const cls = typeof e.className === 'string' ? e.className : '';
    candidates.push({
      id,
      label,
      ...(hint ? { hint } : {}),
      ...(href && !href.startsWith('javascript:') && href !== '#' ? { href: new URL(href, location.href).href } : {}),
      position,
      in_pager: inPager,
      // Whole class tokens only: Tailwind's "disabled:bg-grey-200" styles a state, it does not set it.
      disabled: e.matches(':disabled,[aria-disabled="true"]') || hasToken(e, DISABLED) || hasToken(e.parentElement, DISABLED),
      current: e.matches('[aria-current]:not([aria-current="false"])') || hasToken(e, CURRENT) || hasToken(e.parentElement, CURRENT) || !!e.parentElement?.matches('[aria-current="page"]'),
    });
  }

  // Page-size selects near the list: every option is a number or "all".
  const selects = [];
  for (const s of document.querySelectorAll('select')) {
    if (!shown(s) || inItem(s)) continue;
    const options = [...s.options].map((o) => clean(o.textContent, 20));
    if (options.length < 2 || !options.every((o) => /^\d{1,4}$|^(all|alle|tous|todos|tutti|tümü)$/i.test(o.replace(/\s*(pro seite|per page|items|produkte|products|stück)\s*$/i, '')))) continue;
    const id = 'p' + (candidates.length + selects.length + 1);
    s.setAttribute('data-jc-page', id);
    selects.push({ id, options, selected: clean(s.options[s.selectedIndex]?.textContent, 20) });
  }

  const relNext = document.querySelector('link[rel="next"],a[rel="next"]')?.href || null;
  return { url: location.href, item_count: items.length, candidates, selects, rel_next: relNext, scroll_height: document.documentElement.scrollHeight };
}
