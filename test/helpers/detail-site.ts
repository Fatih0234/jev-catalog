// Local fixture site for detail tests and manual browser inspection. Serves plain HTML over
// node:http (or through Playwright routes) with no external requests. Every page needs a reveal
// or collection behaviour the real sites taught us about: WAGO-style accordions, lazily mounted
// tabs, Elesa-style variant queries and error pages, Deublin lettered dimension rows.
import { createServer } from 'node:http';
import type { Route } from 'playwright';
import type { Judge } from '../../src/jev.js';
import type { DetailTarget } from '../../src/detail-policy.js';
import { CONTROL_ROLES } from '../../src/gate.js';

const shell = (code: string, title: string, body: string, extra = '') =>
  `<!doctype html><html><head><title>${title}</title></head><body>
<header><nav><a href="/a">Home</a><a href="/list">Catalogue</a></nav></header>
<main>${body}</main>
<footer><p>Contact support · Ordering help · © Fixture Parts</p></footer>
<script>
function activate(id) {
  document.querySelectorAll('[role="tab"]').forEach((t) => t.setAttribute('aria-selected', String(t.id === id)));
  document.querySelectorAll('[role="tabpanel"]').forEach((p) => { p.hidden = true; });
  const panel = document.getElementById(id.replace('tab-', 'panel-'));
  if (panel) panel.hidden = false;
  return panel;
}
</script>${extra}
</body></html>`;

const productHead = (code: string) =>
  `<div class="product-head"><h1>Rotary union, radial</h1><p class="sku"><span class="lbl">Item no.</span> <span class="code">${code}</span></p></div>`;
const specTable = (rows: [string, string][]) =>
  `<table><tbody>${rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</tbody></table>`;
const dimTable = (rows: [string, string][]) =>
  `<table>${rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table>`;
const docLinks = (code: string) =>
  `<ul class="docs"><li><a href="/files/${code}-datasheet.pdf">Datasheet ${code}</a></li><li><a href="/files/${code}.step">CAD STEP</a></li></ul>`;

const TAB_SCRIPT = (withAccordion = true) => `
document.getElementById('tab-spec').addEventListener('click', () => {
  const p = activate('tab-spec');
  if (p && !p.dataset.mounted) {
    p.dataset.mounted = '1';
    // The specification panel mounts lazily after the tab is selected.
    setTimeout(() => {
      p.innerHTML = '<h2>Specifications</h2>' +
        '<table><tbody><tr><td>Voltage</td><td>24 V</td></tr><tr><td>Pressure</td><td>10 bar</td></tr></tbody></table>' +
        ${withAccordion ? `'<div class="wg-accordion"><div class="wg-accordion__header">Electrical data</div>' +
        '<div class="wg-accordion__content" style="display:none"><dl><dt>Voltage</dt><dd>24 V DC</dd><dt>Current</dt><dd>2 A</dd></dl></div></div>' +
        '<div class="wg-accordion"><div class="wg-accordion__header">Variant selection</div>' +
        '<div class="wg-accordion__content" style="display:none"><dl><dt>Thread size</dt><dd>M12x1</dd></dl></div></div>'` : `''`};
      p.querySelectorAll('.wg-accordion__header').forEach((h) => h.addEventListener('click', (e) => {
        const body = e.target.nextElementSibling;
        body.style.display = body.style.display === 'none' ? '' : 'none';
      }));
    }, 30);
  }
});
document.getElementById('tab-docs').addEventListener('click', () => {
  const p = activate('tab-docs');
  if (p && !p.innerHTML) {
    setTimeout(() => { p.innerHTML = '<h2>Downloads</h2>' + p.dataset.links; }, 30);
  }
});
document.getElementById('tab-rel').addEventListener('click', () => {
  const p = activate('tab-rel');
  if (p && !p.innerHTML) p.innerHTML = '<h2>Related products</h2><p>Other rotary unions.</p>';
});
`;

const accordionBlock = (header: string, inner: string, hidden = true) =>
  `<div class="wg-accordion"><div class="wg-accordion__header">${header}</div>` +
  `<div class="wg-accordion__content" style="${hidden ? 'display:none' : ''}">${inner}</div></div>`;
const ACCORDION_SCRIPT = `
document.querySelectorAll('.wg-accordion__header').forEach((h) => h.addEventListener('click', (e) => {
  const body = e.target.nextElementSibling;
  body.style.display = body.style.display === 'none' ? '' : 'none';
}));
`;

// A: summary details + lazy tabs + nested accordions inside the lazy specifications panel.
const pageA = (code: string, extra = '', withAccordion = true) =>
  shell(
    code,
    `${code} rotary union`,
    `${productHead(code)}
<details class="dims"><summary>Dimensions</summary>${dimTable([
      ['A', '1/8"-27 NPT RH'],
      ['B', '73 mm'],
      ['D', '28.372 mm'],
      ['d', '12 mm'],
    ])}</details>${extra}
<div class="tablist" role="tablist">
  <button role="tab" id="tab-spec" aria-controls="panel-spec" aria-selected="false">Specifications</button>
  <button role="tab" id="tab-docs" aria-controls="panel-docs" aria-selected="false">Downloads</button>
  <button role="tab" id="tab-rel" aria-controls="panel-rel" aria-selected="false">Related products</button>
</div>
<div id="panel-spec" role="tabpanel" aria-labelledby="tab-spec" hidden></div>
<div id="panel-docs" role="tabpanel" aria-labelledby="tab-docs" hidden>${docLinks(code)}</div>
<div id="panel-rel" role="tabpanel" aria-labelledby="tab-rel" hidden></div>
<section class="accessories"><h2>Accessories</h2><table><tr><td>${code}-SEAL</td><td>Seal kit</td></tr><tr><td>${code}-BRG</td><td>Bearing kit</td></tr></table></section>`,
    `<script>${TAB_SCRIPT(withAccordion)}</script>`,
  );

// A2: identical initial control set to A but the nested accordion never mounts.
const pageA2 = (code: string) => pageA(code, '', false);

// B: reordered template, peer two-cell rows, a single-row Compliance table and a Documents summary.
const pageB = (code: string) =>
  shell(
    code,
    `${code} rotary union`,
    `${productHead(code)}
<details class="docs"><summary>Documents</summary>${docLinks(code)}</details>
<section class="tech"><h2>Technical data</h2><div class="specs">
  <div class="row"><div class="k">Voltage</div><div class="v">230 V</div></div>
  <div class="row"><div class="k">Pressure</div><div class="v">16 bar</div></div>
</div></section>
<section class="comp"><h2>Compliance</h2>${specTable([['Material', 'Stainless steel']])}</section>`,
  );

// C: sparse product, few specs, single visible block.
const pageC = (code: string) =>
  shell(
    code,
    `${code} rotary union`,
    `${productHead(code)}
<section class="tech"><h2>Technical data</h2>${specTable([['Weight', '0.4 kg']])}</section>
<section class="docs"><h2>Downloads</h2>${docLinks(code)}</section>`,
  );

// D: replay-only template of B's shape plus a novel field and a different accessories table.
const pageD = (code: string) =>
  shell(
    code,
    `${code} rotary union`,
    `${productHead(code)}
<details class="docs"><summary>Documents</summary>${docLinks(code)}</details>
<section class="tech"><h2>Technical data</h2><div class="specs">
  <div class="row"><div class="k">Voltage</div><div class="v">230 V</div></div>
  <div class="row"><div class="k">Coating</div><div class="v">Nickel plated</div></div>
</div></section>
<section class="acc-list"><h2>Accessories</h2><table><tr><td>Mounting flange</td><td>available</td></tr></table></section>`,
  );

// E: tab click swaps the product code at an unchanged URL.
const pageE = (code: string) =>
  shell(
    code,
    `${code} rotary union`,
    `${productHead(code)}
<div class="tablist" role="tablist"><button role="tab" id="tab-docs" aria-controls="panel-docs" aria-selected="false">Downloads</button></div>
<div id="panel-docs" role="tabpanel" aria-labelledby="tab-docs" hidden>${docLinks(code)}</div>`,
    `<script>
document.getElementById('tab-docs').addEventListener('click', () => {
  const p = activate('tab-docs');
  if (p) {
    // Variant switcher disguised as a disclosure tab: swaps the product in place.
    document.querySelector('.code').textContent = 'FIX-E999';
    document.querySelector('h1').textContent = 'Rotary union, axial';
  }
});
</script>`,
  );

// F: tab click triggers a delayed same-document query navigation.
const pageF = (code: string) =>
  shell(
    code,
    `${code} rotary union`,
    `${productHead(code)}
<div class="tablist" role="tablist"><button role="tab" id="tab-docs" aria-controls="panel-docs" aria-selected="false">Documents</button></div>
<div id="panel-docs" role="tabpanel" aria-labelledby="tab-docs" hidden>${docLinks(code)}</div>`,
    `<script>
document.getElementById('tab-docs').addEventListener('click', () => {
  const p = activate('tab-docs');
  if (p) setTimeout(() => { history.pushState({}, '', '/f?productId=FIX-F999'); }, 400);
});
</script>`,
  );

// G: error page whose footer repeats the code but has no product content.
const pageG = () =>
  `<!doctype html><html><head><title>Generic Error</title></head><body>
<main><div class="error-page"><h1>Generic Error</h1><p>The catalogue is temporarily unavailable.</p></div></main>
<footer><p>Request FIX-G707 failed. © Fixture Parts</p></footer>
</body></html>`;

// H: page A plus the Documents summary, so every compiled reveal exists on it.
const pageH = (code: string) => pageA(code, `<details class="docs"><summary>Documents</summary>${docLinks(code)}</details>`);

// I: a hidden table row must never be read.
const pageI = (code: string) =>
  shell(
    code,
    `${code} rotary union`,
    `${productHead(code)}
<section class="tech"><h2>Specifications</h2><table><tbody>
<tr><td>Voltage</td><td>230 V</td></tr>
<tr style="display:none"><td>Secret</td><td>999 psi</td></tr>
<tr><td aria-hidden="true">Hidden label</td><td>Hidden value</td></tr>
<tr><td>Pressure</td><td><span style="display:none">999 psi</span><span>16 bar</span></td></tr>
</tbody></table></section>`,
  );

// J: display:contents wrappers still render text; a nested hidden span is not collected.
const pageJ = (code: string) =>
  shell(
    code,
    `${code} rotary union`,
    `${productHead(code)}
<section class="tech"><h2>Specifications</h2><div class="specs">
  <div class="row"><div class="k" style="display:contents"><span>Pressure</span></div><div class="v"><span>69 bar / 1000 psi</span><span style="display:none">999 psi</span></div></div>
  <div class="row"><div class="k">Weight</div><div class="v">0.4 kg</div></div>
</div></section>`,
  );

// K: a stray dt is never rebound to the next dd.
const pageK = (code: string) =>
  shell(
    code,
    `${code} rotary union`,
    `${productHead(code)}
<section class="tech"><h2>Specifications</h2><dl>
<dt>Old</dt><dt>New</dt><dd>NewValue</dd><dt>Width</dt><dd>10 mm</dd>
</dl></section>`,
  );

// M: two sibling h2+table sections directly under main with the same label in both.
const pageM = (code: string) =>
  shell(
    code,
    `${code} rotary union`,
    `${productHead(code)}
<h2>Electrical</h2>${specTable([['Voltage', '24 V']])}
<h2>Mechanical</h2>${specTable([['Voltage', '5 V']])}
<div class="wrap">${specTable([['Weight', '1.2 kg']])}</div>`,
  );

// N: legitimate product page that mentions login pricing. Not an error page.
const pageN = (code: string) =>
  shell(
    code,
    `${code} rotary union`,
    `${productHead(code)}
<section class="tech"><h2>Technical data</h2><div class="specs">
  <div class="row"><div class="k">Voltage</div><div class="v">24 V</div></div>
  <div class="row"><div class="k">Your price</div><div class="v">please log in</div></div>
</div></section>`,
  );

// P: the code exists only inside a related-products section, never in the header region.
const pageP = () =>
  shell(
    'none',
    'Rotary union',
    `<div class="product-head"><h1>Rotary union, radial</h1><p class="sku">Catalogue listing</p></div>
<section class="tech"><h2>Technical data</h2>${specTable([['Voltage', '24 V']])}</section>
<section><h2>Related products</h2><p><span>Item no.</span> <span>FIX-P111</span></p>
${specTable([['Shaft', '8 mm'], ['Bore', '12 mm']])}</section>`,
  );

// X: a page shaped nothing like the compiled templates: one Documents tab, nothing else.
const pageX = (code: string) =>
  shell(
    code,
    `${code} rotary union`,
    `${productHead(code)}
<div class="tablist" role="tablist"><button role="tab" id="tab-docs" aria-controls="panel-docs" aria-selected="false">Documents</button></div>
<div id="panel-docs" role="tabpanel" aria-labelledby="tab-docs" hidden>${docLinks(code)}</div>
<section class="tech"><h2>Technical data</h2>${specTable([['Weight', '0.9 kg']])}</section>`,
    `<script>document.getElementById('tab-docs').addEventListener('click', () => activate('tab-docs'));</script>`,
  );

// MANY: seventeen disclosure controls, over the reveal cap.
const pageMany = (code: string) => {
  const acc = Array.from({ length: 17 }, (_, i) => accordionBlock(`Specifications ${i + 1}`, `<dl><dt>Property ${i + 1}</dt><dd>V${i + 1}</dd></dl>`)).join('');
  return shell(code, `${code} rotary union`, `${productHead(code)}${acc}`, `<script>${ACCORDION_SCRIPT}</script>`);
};

// T: clicking Dimensions remounts the tab list, detaching previously tagged controls.
const pageT = (code: string) =>
  shell(
    code,
    `${code} rotary union`,
    `${productHead(code)}
<details class="dims"><summary>Dimensions</summary>${dimTable([['D', '30 mm']])}</details>
<div class="tablist" role="tablist">
  <button role="tab" id="tab-spec" aria-controls="panel-spec" aria-selected="false">Specifications</button>
</div>
<div id="panel-spec" role="tabpanel" aria-labelledby="tab-spec" hidden></div>`,
    `<script>
function rebuildTabs() {
  const list = document.querySelector('.tablist');
  const clone = list.cloneNode(true);
  list.replaceWith(clone);
  clone.querySelector('#tab-spec').addEventListener('click', () => {
    const p = activate('tab-spec');
    if (p && !p.innerHTML) p.innerHTML = '<h2>Specifications</h2><table><tbody><tr><td>Voltage</td><td>24 V</td></tr></tbody></table>';
  });
}
rebuildTabs();
document.querySelector('.dims summary').addEventListener('click', rebuildTabs);
</script>`,
  );

// DUP: two identical accordions carrying the same label in the same section, so their stable
// keys collide and neither may be clicked safely.
const pageDup = (code: string) =>
  shell(
    code,
    `${code} rotary union`,
    `${productHead(code)}
<section class="tech"><h2>Technical data</h2>
<div class="cell">${accordionBlock('Electrical data', '<dl><dt>Current</dt><dd>2 A</dd></dl>')}</div>
<div class="cell">${accordionBlock('Electrical data', '<dl><dt>Current</dt><dd>4 A</dd></dl>')}</div>
</section>`,
    `<script>${ACCORDION_SCRIPT}</script>`,
  );

// R: an initial redirect to another origin mid-load.
const pageRedirect = () =>
  `<!doctype html><html><body><script>location.href = 'https://other.test/landing';</script></body></html>`;

// MIX: one section, two tables with different label shapes. The compatibility table must be
// judged and ignored on its own, never borrowing the accepted shape's role.
const pageMix = (code: string) =>
  shell(
    code,
    `${code} rotary union`,
    `${productHead(code)}
<section class="tech"><h2>Technical data</h2>
<table><tbody><tr><td>Compatible model</td><td>RX-2000</td></tr><tr><td>Order code</td><td>${code}-AC</td></tr></tbody></table>
<table><tbody><tr><td>Voltage</td><td>230 V</td></tr><tr><td>Pressure</td><td>16 bar</td></tr></tbody></table>
</section>`,
  );

// D2: same template as D but the Technical data rows carry unrelated accessories-style labels,
// disjoint from every accepted shape. Replay must flag them, not extract them.
const pageD2 = (code: string) =>
  shell(
    code,
    `${code} rotary union`,
    `${productHead(code)}
<details class="docs"><summary>Documents</summary>${docLinks(code)}</details>
<section class="tech"><h2>Technical data</h2><div class="specs">
<div class="row"><div class="k">Mounting flange</div><div class="v">included</div></div>
<div class="row"><div class="k">Bearing kit</div><div class="v">SKF 6204</div></div>
</div></section>`,
  );

// ERR: the Specifications tab swaps the whole main region for an error state and leaves the old
// SKU in a footer outside main. Nothing revealed may be trusted.
const pageErrReveal = (code: string) =>
  `<!doctype html><html><head><title>${code} rotary union</title></head><body>
<main>
${productHead(code)}
<div class="tablist" role="tablist"><button role="tab" id="tab-spec" aria-controls="panel-spec" aria-selected="false">Specifications</button></div>
<div id="panel-spec" role="tabpanel" aria-labelledby="tab-spec" hidden></div>
</main>
<script>
document.getElementById('tab-spec').addEventListener('click', () => {
  const code = document.querySelector('.product-head .sku').textContent;
  const m = document.querySelector('main');
  m.innerHTML = '<div class="error">Generic Error: something went wrong.</div>';
  const f = document.createElement('footer');
  f.innerHTML = '<p>Support line. Reference ' + code + '</p>';
  document.body.appendChild(f);
});
</script>
</body></html>`;

// F2: the control is disabled until 300 ms, then navigates 400 ms after the real click. The
// post-click watch must start when the click returns, not before it.
const pageLateNav = (code: string) =>
  shell(
    code,
    `${code} rotary union`,
    `${productHead(code)}${specTable([['Voltage', '24 V'], ['Pressure', '10 bar']])}
<button id="late" aria-controls="panel-docs" aria-expanded="false" disabled>Documents</button>
<div id="panel-docs" hidden>${docLinks(code)}</div>`,
    `<script>
const b = document.getElementById('late');
setTimeout(() => { b.disabled = false; }, 300);
b.addEventListener('click', () => {
  setTimeout(() => {
    history.pushState({}, '', '/f2?productId=FIX-Q001');
    document.querySelector('.code').textContent = 'FIX-Q001';
  }, 400);
});
</script>`,
  );

// FRAME: a normal product page plus one large cross-origin iframe with real content.
const pageFrame = (code: string) =>
  shell(
    code,
    `${code} rotary union`,
    `${productHead(code)}${specTable([['Voltage', '24 V'], ['Pressure', '10 bar']])}
<iframe src="https://other.test/framepage" width="600" height="400"></iframe>`,
  );

const FRAME_PAGE = `<!doctype html><html><body><p>${'cross-origin frame content. '.repeat(40)}</p></body></html>`;

// CAP: a table whose own caption names the section.
const pageCaption = (code: string) =>
  shell(
    code,
    `${code} rotary union`,
    `${productHead(code)}
<table><caption>Ordering data</caption><tbody><tr><td>Voltage</td><td>24 V</td></tr><tr><td>Pressure</td><td>10 bar</td></tr></tbody></table>`,
  );

// ONE: a downloads section with a single link in a real list.
const pageOneLink = (code: string) =>
  shell(
    code,
    `${code} rotary union`,
    `${productHead(code)}${specTable([['Voltage', '24 V'], ['Pressure', '10 bar']])}
<section class="docs"><h2>Downloads</h2><ul><li><a href="/files/${code}-datasheet.pdf">Datasheet ${code}</a></li></ul></section>`,
  );

// I2: display:contents inside a hidden ancestor must still be hidden, and a value made of
// hidden spans contributes nothing.
const pageHidden2 = (code: string) =>
  shell(
    code,
    `${code} rotary union`,
    `${productHead(code)}
<div style="display:none"><div style="display:contents"><table><tr><td>Secret</td><td>999 psi</td></tr></table></div></div>
${specTable([['Voltage', '24 V']])}
<section class="tech"><h2>Technical data</h2><div class="specs">
<div class="row"><div class="k">Pressure</div><div class="v"><span style="display:none">999 psi</span></div></div>
<div class="row"><div class="k">Weight</div><div class="v">0.5 kg</div></div>
</div></section>`,
  );

// CONSENT: a fixed overlay asks the visitor before the product can be judged. Compile answers it
// through the gate seam; replay expects the caller's context to be cleared already.
const pageConsent = (code: string) =>
  shell(
    code,
    `${code} rotary union`,
    `${productHead(code)}${specTable([['Voltage', '24 V'], ['Pressure', '10 bar']])}
<div id="consent" style="position:fixed;inset:0;background:rgba(250,250,250,.97);z-index:999;padding:3em">
<p>We use cookies to improve this catalogue. Choose an option to continue.</p>
<button onclick="document.getElementById('consent').remove()">Reject all</button>
<button onclick="document.getElementById('consent').remove()">Accept all</button>
<button>Manage preferences</button>
</div>`,
  );

// DEU: a Deublin-style page where the primary product code is the h2 heading itself and no
// labelled code span exists. Dimensions are lettered rows under a summary.
const pageDeu = (code: string) =>
  shell(
    code,
    `${code} rotary union`,
    `<div class="product-head"><h1>Rotary union</h1><h2>${code}</h2><p class="sku">Series 1005</p></div>
<details class="dims"><summary>Dimensions</summary>${dimTable([['A', '1/8"-27 NPT RH'], ['B', '73 mm'], ['D', '28.372 mm'], ['d', '12 mm']])}</details>`,
  );

// RC1-3: identical section, kind and labels on three pages. A scripted judge override decides
// contradictory roles per sample so the merge must tombstone the shape.
const pageRc = (code: string) =>
  shell(
    code,
    `${code} rotary union`,
    `${productHead(code)}
<section class="tech"><h2>Technical data</h2>${specTable([['Speed', '120 rpm'], ['Torque', '4 Nm']])}</section>`,
  );

// DUB: the Deublin header pattern. The product code is an h2 in a plain wrapper; its previous
// sibling is a product title header whose class happens to match the accordion-header regex, and
// the global menu sits in a site header outside main. Neither may leak into section paths.
const pageDub = (code: string, variant: string) =>
  `<!doctype html><html><head><title>${code} rotary union</title></head><body>
<header class="site-header"><nav><a href="/list">PRODUKTE</a><a href="/list">BRANCHEN</a><a href="/list">SERVICE</a></nav></header>
<main>
<div class="product-title-header"><h1>${variant}</h1></div>
<div><h2>${code}</h2></div>
<section><h3>Dimensions</h3>${specTable([['A', '1/8"-27 NPT RH'], ['B', '73 mm']])}</section>
<div><h3>Downloads</h3><div><a href="/files/${code}-datasheet.pdf">Datasheet</a> <a href="/files/${code}.step">CAD STEP</a></div></div>
</main>
</body></html>`;

// NAV: the Schmalz pattern. Three navigation anchors sit in a div inside main before the product
// h1 and the "Part no." paragraph, then a technical table and an accessories block with a
// different code. The link-only nav row must not end the identity header region. The accessories
// section precedes the technical table so its labelled code is inside the expanded header region
// and only the related-section guard may reject it.
const pageNav = (code: string) =>
  shell(
    code,
    `${code} flat suction cup`,
    `<div class="crumbs"><a href="/list">Back to product family</a><a href="/list">Product information</a><a href="/list">Ordering information</a></div>
<div class="product-head"><h1>Flat suction cup (round): SPF 10 ED-65 M5-AG</h1><p class="sku">Part no.: <span>${code}</span></p><p>Flat suction cup (round) for dynamic handling of cardboard and rigid packaging.</p></div>
<section class="acc-list"><h2>Accessories</h2><p>Part no.: <span>10.01.06.02802</span></p><div><a href="/list">Connection element</a> <a href="/list">Mounting flange</a></div></section>
<section class="tech"><h2>Technical data</h2>${specTable([['Voltage', '24 V']])}</section>`,
  );

// LU: the Leuze pattern. OL breadcrumbs before the h1, a descriptive h2 that differs per
// product, then Part no. as label span + non-rendered meta + itemprop=sku span. The descriptive
// h2 qualifies the candidate's section but must not be part of the stored replay locator.
const pageLu = (code: string, desc: string) =>
  `<!doctype html><html><head><title>${code} fiber optics</title></head><body>
<header><nav><a href="/list">Home</a><a href="/list">Catalogue</a></nav></header>
<main>
<ol class="breadcrumb"><li><a href="/a">Products</a></li><li><a href="/b">Accessories</a></li><li><a href="/c">Fiber optics</a></li></ol>
<h1>Fiber optics</h1>
<h2>${desc}</h2>
<p class="sku"><span>Part no.:</span><meta itemprop="productID" content="leuze.${code}"><span itemprop="sku">${code}</span></p>
<section class="tech"><h2>Technical data</h2>${specTable([['Voltage', '24 V'], ['Fiber length', '3,000 mm']])}</section>
</main></body></html>`;

const pageSchema = (code: string, desc: string) =>
  shell(
    code,
    desc,
    `<div class="product-head"><h1>Series S</h1><h2>${desc}</h2><p class="sku">Part no.: <span>${code}</span></p></div>
<section class="tech"><h3>Technical data</h3>
<details open><summary>Electrical data</summary>
<table><thead><tr><th>Attribute</th><th>Value</th></tr></thead>
<tbody><tr><th>Voltage</th><td>24 V</td></tr>
<tr><td>Pressure</td><td>10 bar</td></tr>
<tr style="display:none"><td>Stale</td><td>999</td></tr></tbody></table>
</details>
<table><tbody><tr><td>Attribute</td><td>Value</td></tr><tr><td>Weight</td><td>120 g</td></tr></tbody></table>
</section>
<section class="related"><h3>Related products</h3><table><tbody><tr><td>REL-9</td><td>companion</td></tr></tbody></table></section>`,
  );

const pageSchemaPath = (code: string, desc: string, rows: [string, string][] = [['Voltage', '24 V'], ['Pressure', '10 bar']]) =>
  shell(
    code,
    desc,
    `<div class="product-head"><h1>Series S</h1><p class="sku">Part no.: <span>${code}</span></p></div>
<div class="product-title-header"><h2>${desc}</h2></div><div class="product-content">
<section class="tech"><h3>Technical data</h3>
<details open><summary>Electrical data</summary>
<table><thead><tr><th>Attribute</th><th>Value</th></tr></thead>
<tbody><tr><th>Voltage</th><td>${rows[0]?.[1] ?? '24 V'}</td></tr>
${rows[1] ? `<tr><td>${rows[1][0]}</td><td>${rows[1][1]}</td></tr>` : ''}
<tr style="display:none"><td>Stale</td><td>999</td></tr></tbody></table>
</details>
</section>
<section class="related"><h3>Related products</h3><table><tbody><tr><td>REL-9</td><td>companion</td></tr></tbody></table></section>
</div>`,
  );

const vHead = (code: string) =>
  `<div class="product-head"><h1>Series V</h1><p class="sku">Part no.: <span>${code}</span></p></div>`;

const pageDupSources = (code: string, overview: string, detail: string) =>
  shell(code, `${code} dup`, `<h1>Product ${code}</h1><span>Part no.:</span><span>${code}</span>
<section class="tech"><h3>Technical data</h3>
<dl><dt>Material</dt><dd>${overview}</dd><dt>Voltage</dt><dd>24 V</dd></dl>
<table><tbody><tr><td>Material</td><td>${detail}</td></tr><tr><td>Voltage</td><td>24 V</td></tr></tbody></table>
</section>`);

const pageOpt = (code: string, extra: string) =>
  shell(code, `${code} opt`, `<h1>Product ${code}</h1><span>Part no.:</span><span>${code}</span>
<section class="tech"><h3>Technical data</h3><table><tbody>
<tr><td>Voltage</td><td>24 V</td></tr>${extra}</tbody></table></section>`);

const pageFailRev = (code: string, open: boolean, torque: string) =>
  shell(code, `${code} fr`, `<h1>Product ${code}</h1><span>Part no.:</span><span>${code}</span>
<section class="tech"><h3>Technical data</h3><table><tbody><tr><td>Voltage</td><td>24 V</td></tr></tbody></table></section>
${open
  ? `<details open><summary>Mechanical data</summary><table><tbody><tr><td>Torque</td><td>${torque}</td></tr></tbody></table></details>`
  : `<button disabled aria-expanded="false">Mechanical data</button><div hidden><table><tbody><tr><td>Torque</td><td>${torque}</td></tr></tbody></table></div>`}`);

const pageDim = (code: string) =>
  shell(code, `${code} dim`, `<h1>Product ${code}</h1><span>Part no.:</span><span>${code}</span>
<section><h3>Outer dimensions</h3><table><tbody><tr><td>D</td><td>40 mm</td></tr><tr><td>Voltage</td><td>230 V</td></tr></tbody></table></section>
<section><h3>Bore data</h3><table><tbody><tr><td>d</td><td>12 mm</td></tr><tr><td>Voltage</td><td>24 V</td></tr></tbody></table></section>`);

const pageAlias = (code: string, label: string) =>
  shell(code, `${code} al`, `<h1>Product ${code}</h1><span>Part no.:</span><span>${code}</span>
<section class="tech"><h3>Technical data</h3><table><tbody>
<tr><td>${label}</td><td>800 g</td></tr><tr><td>Voltage</td><td>24 V</td></tr></tbody></table></section>`);

const pageTwoSku = (code: string) =>
  shell(code, `${code} 2sku`, `<div class="product-head"><h1>Series T</h1>
<p><span class="lbl">Part no.</span> <span itemprop="sku">${code}</span></p></div>
<div class="alt-id"><p><span class="lbl">Spare article</span> <span itemprop="sku">${code.replace(/(\d)$/, '9')}</span></p></div>
<section class="tech"><h3>Technical data</h3><table><tbody><tr><td>Voltage</td><td>24 V</td></tr></tbody></table></section>`);

const pageModelSku = (code: string) =>
  shell(code, `${code} msku`, `<div class="product-head"><h1>Series T</h1>
<p><span class="lbl">Part no.</span> <span itemprop="sku">${code}</span></p></div>
<div class="alt-id"><p><span class="lbl">Model</span> <span itemprop="mpn">GF-ETB compact</span></p></div>
<section class="tech"><h3>Technical data</h3><table><tbody><tr><td>Voltage</td><td>24 V</td></tr></tbody></table></section>`);

const pageAux = (code: string, auxLabel: string, specCtl = true) =>
  shell(code, `${code} aux`, `${vHead(code)}
<section class="promo"><h3>Current offers</h3><table><tbody><tr><td>Discount</td><td>10 %</td></tr></tbody></table>
<details><summary>${auxLabel}</summary><p>Region and display preferences.</p></details></section>
<section class="tech"><h3>Technical data</h3><table><tbody><tr><td>Pressure</td><td>10 bar</td></tr></tbody></table>
${specCtl ? `<details><summary>Electrical data</summary><table><tbody><tr><td>Voltage</td><td>24 V</td></tr></tbody></table></details>` : ''}
</section>`);

const pageDocTabs = (code: string) =>
  shell(code, `${code} doc`, `<div class="wrap">
<nav class="crumbs"><a href="/products">Products</a><a href="/acc">Accessories</a><a href="/fib">Fiber optics</a><a href="/log">Log in</a></nav>
${vHead(code)}
<button aria-controls="panel-t" aria-expanded="false"
  onclick="document.getElementById('panel-t').hidden=false;this.setAttribute('aria-expanded','true')">Technical features</button>
<div id="panel-t" role="tabpanel" hidden><table><tbody><tr><td>Voltage</td><td>24 V</td></tr></tbody></table></div>
<button aria-controls="panel-d" aria-expanded="false"
  onclick="document.getElementById('panel-d').hidden=false;this.setAttribute('aria-expanded','true')">Downloads</button>
<div id="panel-d" role="tabpanel" hidden><div class="row"><div class="leaf">Data sheet - pdf</div>
<a href="https://files.test/ds-${code}-de.pdf">DE</a><a href="https://files.test/ds-${code}-en.pdf">EN</a>
<a href="https://detail.test/login">Log in</a></div></div>
</div>`);

const pageIconDoc = (code: string) =>
  shell(code, `${code} icon`, `${vHead(code)}
<section class="docs"><h3>Documents</h3>
<div class="card"><div class="t">Datasheet PDF</div><a href="https://files.test/icon-${code}.pdf" aria-label="Download datasheet"><svg width="16" height="16"></svg></a>
<a href="https://files.test/icon-${code}-manual.pdf" aria-label="Download manual"><svg width="16" height="16"></svg></a></div>
</section>`);

const pageOverview = (code: string, desc: string, material: string) =>
  shell(code, `${code} ov`, `<h1>Product ${code}</h1><span>Part no.:</span><span>${code}</span>
<div class="expandable-wrapper"><span class="toggle-label">${desc}</span>
<div class="facts"><div><span>Material</span><span>${material}</span></div>
<div><span>Min. stroke</span><span>20 mm</span></div></div></div>
<section class="tech"><h3>Technical data</h3><table><tbody>
<tr><td>Material</td><td>${material}</td></tr><tr><td>Voltage</td><td>24 V</td></tr></tbody></table></section>`);

const pageAliasSection = (code: string, section: string) =>
  shell(code, `${code} sa`, `<h1>Product ${code}</h1><span>Part no.:</span><span>${code}</span>
<section class="tech"><h3>${section}</h3><table><tbody>
<tr><td>Voltage</td><td>24 V</td></tr><tr><td>Stroke</td><td>20 mm</td></tr></tbody></table></section>`);

const pageExtraTable = (code: string) =>
  shell(code, `${code} xt`, `<h1>Product ${code}</h1><span>Part no.:</span><span>${code}</span>
<section class="tech"><h3>Technical data</h3>
<dl><dt>Material</dt><dd>NBR</dd><dt>Voltage</dt><dd>24 V</dd></dl>
<table><tbody><tr><td>Material</td><td>NBR</td></tr><tr><td>Voltage</td><td>24 V</td></tr></tbody></table>
<table class="compat"><tbody><tr><td>Material</td><td>FKM</td></tr><tr><td>Voltage</td><td>230 V</td></tr></tbody></table>
</section>`);

const pageSkuDup = (code: string) =>
  shell(code, `${code} skd`, `${vHead(code)}
<span itemprop="sku">${code}</span><span>SKU:</span><span>${code}</span>
<section class="tech"><h3>Technical data</h3><table><tbody><tr><td>Voltage</td><td>24 V</td></tr></tbody></table></section>`);

const pageIdReveal = (code: string, extras: string, model: string) =>
  shell(code, `${code} id`, `<h1>Product ${code}</h1>
<span itemprop="sku">${code}</span><span>Model:</span><span>${model}</span>${extras}
<button aria-controls="panel-t" aria-expanded="false"
  onclick="document.getElementById('panel-t').hidden=false;this.setAttribute('aria-expanded','true')">Technical data</button>
<div id="panel-t" role="tabpanel" hidden><table><tbody><tr><td>Voltage</td><td>24 V</td></tr></tbody></table></div>
<button aria-controls="panel-d" aria-expanded="false"
  onclick="document.getElementById('panel-d').hidden=false;this.setAttribute('aria-expanded','true')">Downloads</button>
<div id="panel-d" role="tabpanel" hidden><div class="card"><div class="t">Datasheet</div><a href="https://files.test/${code}.pdf">Download PDF</a></div></div>`);

const pageMissingField = (code: string, label = 'Part no.') =>
  shell(code, `${code} fm`, `<h1>Product ${code}</h1><span>${label}:</span><span>${code}</span>
<section class="tech"><h3>Technical data</h3><table><tbody><tr><td>Voltage</td><td>24 V</td></tr></tbody></table></section>`);

const pageSwappedSlot = (code: string, a: string, b: string) =>
  shell(code, `${code} sw`, `<h1>Product ${code}</h1><span>Part no.:</span><span>${code}</span>
<button aria-controls="panel-r" aria-expanded="false"
  onclick="document.getElementById('panel-r').hidden=false;this.setAttribute('aria-expanded','true')">Technical data</button>
<div id="panel-r" role="tabpanel" hidden><table><tbody><tr><td>Weight</td><td>${a}</td></tr></tbody></table></div>
<button aria-controls="panel-x" aria-expanded="false"
  onclick="document.getElementById('panel-x').hidden=false;this.setAttribute('aria-expanded','true');
    document.getElementById('panel-r').querySelector('td:last-child').textContent='${b}';">Extra data</button>
<div id="panel-x" role="tabpanel" hidden><table><tbody><tr><td>Depth</td><td>5 mm</td></tr></tbody></table></div>`);

const pageExcludedCtl = (code: string) =>
  shell(code, `${code} xc`, `<h1>Product ${code}</h1><span>Item no.:</span><span>${code}</span><span>Part no.:</span><span>${code}</span>
<section class="tech"><h3>Technical data</h3><table><tbody><tr><td>Pressure</td><td>10 bar</td></tr></tbody></table></section>
<div class="accessories"><div class="wg-accordion"><div class="wg-accordion__header">Electrical data</div>
<div class="wg-accordion__content" style="display:none"><p>Accessory wiring.</p></div></div></div>`);

const pageAmbiguousCtl = (code: string) =>
  shell(code, `${code} am`, `<h1>Product ${code}</h1><span>Item no.:</span><span>${code}</span><span>Part no.:</span><span>${code}</span>
<section class="tech"><h3>Technical data</h3><table><tbody><tr><td>Pressure</td><td>10 bar</td></tr></tbody></table>
<details><summary>Electrical data</summary><table><tbody><tr><td>Voltage</td><td>24 V</td></tr></tbody></table></details>
<details><summary>Electrical data</summary><table><tbody><tr><td>Current</td><td>2 A</td></tr></tbody></table></details>
</section>`);

const pageOpaqueLinks = (code: string, withLogin = false) =>
  shell(code, `${code} ok`, `<h1>Product ${code}</h1><span>Part no.:</span><span>${code}</span>
<button aria-controls="panel-d" aria-expanded="false"
  onclick="document.getElementById('panel-d').hidden=false;this.setAttribute('aria-expanded','true')">Downloads</button>
<div id="panel-d" role="tabpanel" hidden><div class="row"><div class="leaf">Datasheet</div>
<a href="https://detail.test/file?part=${code}">Datasheet</a>
<a href="https://detail.test/file?serial=${code}">Datasheet</a>
${withLogin ? '<a href="https://detail.test/login">Datasheet</a>' : ''}</div></div>`);

const pageCredentialLink = (code: string) =>
  shell(code, `${code} cr`, `<h1>Product ${code}</h1><span>Part no.:</span><span>${code}</span>
<button aria-controls="panel-docs" aria-expanded="false"
  onclick="document.getElementById('panel-docs').hidden=false;this.setAttribute('aria-expanded','true')">Documents</button>
<div id="panel-docs" role="tabpanel" hidden><div class="card">
<a href="https://user:p%40ssw0rd@files.test/secret-${code}.pdf">Internal datasheet</a>
<a href="https://files.test/pub-${code}.pdf">Public datasheet</a></div></div>`);

const pageLayout = (code: string, cls: string) =>
  shell(code, `${code} ly`, `<h1>Product ${code}</h1><span>Part no.:</span><span>${code}</span>
<section class="tech"><h3>Technical data</h3><div class="${cls}"><table><tbody>
<tr><td>Voltage</td><td>24 V</td></tr><tr><td>Pressure</td><td>10 bar</td></tr></tbody></table></div></section>`);

const pageTwoTables = (code: string, a: string, b: string) =>
  shell(code, `${code} tb`, `<h1>Product ${code}</h1><span>Part no.:</span><span>${code}</span>
<section class="tech"><h3>Technical data</h3>
<table class="spec-a"><tbody><tr><td>Voltage</td><td>${a}</td></tr></tbody></table>
<table class="spec-b"><tbody><tr><td>Voltage</td><td>${b}</td></tr></tbody></table></section>`);

const pageOverviewAlias = (code: string) =>
  shell(code, `${code} ove`, `<h1>Product ${code}</h1><span>Part no.:</span><span>${code}</span>
<div class="facts"><div><span>Overview Material</span><span>NBR</span></div><div><span>Min. stroke</span><span>20 mm</span></div></div>
<section class="tech"><h3>Technical data</h3><table><tbody>
<tr><td>Material</td><td>NBR</td></tr><tr><td>Voltage</td><td>24 V</td></tr></tbody></table></section>`);

const pageAncLayout = (code: string, cls: string) =>
  shell(code, `${code} al`, `<h1>Product ${code}</h1><span>Part no.:</span><span>${code}</span>
<div class="${cls}"><div><section class="tech"><h3>Technical data</h3>
<table><tbody><tr><td>Voltage</td><td>24 V</td></tr></tbody></table></section></div></div>`);

const pageTwoUnheaded = (code: string, hideB = false) =>
  shell(code, `${code} ua`, `<h1>Product ${code}</h1><span>Part no.:</span><span>${code}</span>
<div class="facts-a"><div><span>Material</span><span>NBR</span></div><div><span>Color</span><span>black</span></div></div>
${hideB ? '' : '<div class="facts-b"><div><span>Weight</span><span>800 g</span></div><div><span>Length</span><span>120 mm</span></div></div>'}
<section class="tech"><h3>Technical data</h3><table><tbody><tr><td>Voltage</td><td>24 V</td></tr></tbody></table></section>`);

const pageDeepAcc = (code: string) =>
  shell(code, `${code} ax`, `${vHead(code)}
<section class="tech"><h3>Technical data</h3><table><tbody><tr><td>Voltage</td><td>24 V</td></tr></tbody></table></section>
<div><div><div><div><div><div class="accessories"><section><div><div><div><h3>Technical data</h3>
<table><tbody><tr><td>Voltage</td><td>48 V</td></tr><tr><td>Accessory kit</td><td>AK-9</td></tr></tbody></table></div></div></div></section></div></div></div></div></div></div>`);

const pageLateDocs = (code: string) =>
  shell(code, `${code} late`, `${vHead(code)}
<button aria-controls="panel-l" aria-expanded="false"
  onclick="this.setAttribute('aria-expanded','true');setTimeout(()=>{const d=document.getElementById('panel-l');d.hidden=false;d.innerHTML='<a href=https://files.test/late-${code}.pdf>Datasheet</a>';},800)">Downloads</button>
<div id="panel-l" role="tabpanel" hidden></div>`);

const pageManyHeadings = (code: string) =>
  shell(
    code,
    `${code} many headings`,
    `<div class="product-head"><h1>Series H</h1><p class="sku">Part no.: <span>${code}</span></p></div>
${Array.from({ length: 14 }, (_, i) => `<section><h2>Section ${i + 1}</h2><table><tbody><tr><td>Spec ${i + 1}</td><td>${i + 1}</td></tr></tbody></table></section>`).join('\n')}`,
  );

const pageDeep = (code: string) =>
  shell(
    code,
    `${code} deep nesting`,
    `<div class="product-head"><h1>Series D</h1><p class="sku">Part no.: <span>${code}</span></p></div>
<div class="l1 a b c d e f g h i j k"><div class="l2"><div class="l3"><div class="l4"><div class="l5"><div class="l6"><div class="l7">
<table><tbody><tr><td>Depth</td><td>5 mm</td></tr></tbody></table>
</div></div></div></div></div></div></div>`,
  );

const pagePanel = (code: string) =>
  shell(
    code,
    `${code} panel wiring`,
    `<div class="product-head"><h1>Series P</h1><p class="sku">Part no.: <span>${code}</span></p></div>
<button aria-controls="pl" aria-expanded="true">Product links</button>
<div id="pl"><div><a href="https://detail.test/files/a.pdf">Datasheet</a><a href="https://detail.test/files/b.pdf">Manual</a></div></div>
<button aria-controls="pu" aria-expanded="true">Specs panel</button>
<div id="pu"><div class="side"><h4>Unrelated</h4></div><table><tbody><tr><td>Depth</td><td>5 mm</td></tr></tbody></table></div>
<button aria-controls="pw" aria-expanded="true">Shadow specs</button>
<div id="pw"><div id="host"></div></div>
<script>document.getElementById('host').attachShadow({ mode: 'open' }).innerHTML = '<table><tbody><tr><td>Shadow weight</td><td>9 g</td></tr></tbody></table>';</script>`,
  );

// NOMAIN: no main landmark; the smallest substantial ancestor of the product h1 scopes the page,
// so the related table outside that ancestor is never read.
const pageNoMain = (code: string) =>
  `<!doctype html><html><head><title>${code} rotary union</title></head><body>
<div class="wrap">
<div class="prod">
${productHead(code)}
<p class="desc">Radial rotary union for compressed air and vacuum applications. Single passage,
carbon bearing, NPT thread, rated for continuous duty in packaging and conveying equipment.</p>
${specTable([['Voltage', '24 V'], ['Pressure', '10 bar'], ['Weight', '0.9 kg'], ['Speed', '120 rpm']])}
</div>
<table class="related"><tbody><tr><td>Compatible with</td><td>FIX-Z999</td></tr><tr><td>Similar item</td><td>FIX-Z998</td></tr></tbody></table>
</div>
</body></html>`;

const pageList = () =>
  `<!doctype html><html><head><title>Fixture list</title></head><body><main><h1>Rotary unions</h1>
<div class="grid"><a href="/a">FIX-A101</a><a href="/b">FIX-B202</a><a href="/c">FIX-C303</a></div></main></body></html>`;

const OTHER_LANDING = `<!doctype html><html><head><title>Other site</title></head><body><main><h1>Rotary union</h1><p>Item no. FIX-R111</p></main></body></html>`;

const PAGES: Record<string, (code: string) => string> = {
  '/a': pageA,
  '/a2': pageA2,
  '/b': pageB,
  '/c': pageC,
  '/d': pageD,
  '/e': pageE,
  '/f': pageF,
  '/g': pageG,
  '/h': pageH,
  '/i': pageI,
  '/j': pageJ,
  '/k': pageK,
  '/m': pageM,
  '/n': pageN,
  '/p': pageP,
  '/x': pageX,
  '/many': pageMany,
  '/t': pageT,
  '/dup': pageDup,
  '/redir': pageRedirect,
  '/list': pageList,
  '/mix': pageMix,
  '/d2': pageD2,
  '/err': pageErrReveal,
  '/f2': pageLateNav,
  '/frame': pageFrame,
  '/cap': pageCaption,
  '/one': pageOneLink,
  '/i2': pageHidden2,
  '/nomain': pageNoMain,
  '/consent': pageConsent,
  '/deu': pageDeu,
  '/rc1': pageRc,
  '/rc2': pageRc,
  '/rc3': pageRc,
  '/dub1': (code) => pageDub(code, 'Union, 1/8" Radial Female NPT RH, In-Shaft'),
  '/dub2': (code) => pageDub(code, 'Union, 3/8" Radial Female NPT RH, In-Shaft'),
  '/n1': pageNav,
  '/lu1': (code) => pageLu(code, 'GF-ETB-SS-630-SM · glass fiber, through-beam'),
  '/lu2': (code) => pageLu(code, 'GF-ETB-SS-610-SM · glass fiber, through-beam'),
  '/lu3': (code) => pageLu(code, 'GF-ETB-SS-605-SM · glass fiber, through-beam'),
  '/lu4': (code) => pageLu(code, 'GF-LB-SS-430-SM · glass fiber, diffuse'),
  '/s1': (code) => pageSchema(code, 'Compact series, brushed housing'),
  '/s2': (code) => pageSchema(code, 'Compact series, polished housing'),
  '/s3': (code) => pageSchema(code, 'Compact series, matte housing'),
  '/s4': (code) => pageSchema(code, 'Long-range series, different description'),
  '/sp1': (code) => pageSchemaPath(code, 'Compact series, brushed housing'),
  '/sp2': (code) => pageSchemaPath(code, 'Compact series, polished housing'),
  '/sp3': (code) => pageSchemaPath(code, 'Compact series, matte housing'),
  '/sp4': (code) => pageSchemaPath(code, 'Long-range series, different description', [['Voltage', '48 V'], ['Pressure', '12 bar']]),
  '/sh': pageManyHeadings,
  '/deep': pageDeep,
  '/pan': pagePanel,
  '/v1': (code) => pageDupSources(code, 'NBR', 'NBR'),
  '/v2': (code) => pageDupSources(code, 'NBR', 'NBR'),
  '/v3': (code) => pageDupSources(code, 'NBR', 'NBR'),
  '/vx': (code) => pageDupSources(code, 'Silicone', 'NBR'),
  '/o1': (code) => pageOpt(code, '<tr><td>Optional torque</td><td>5 Nm</td></tr>'),
  '/o2': (code) => pageOpt(code, ''),
  '/o3': (code) => pageOpt(code, ''),
  '/of1': (code) => pageFailRev(code, true, '8 Nm'),
  '/of2': (code) => pageFailRev(code, false, '8 Nm'),
  '/of3': (code) => pageFailRev(code, true, '8 Nm'),
  '/dd1': pageDim,
  '/dd2': pageDim,
  '/dd3': pageDim,
  '/al1': (code) => pageAlias(code, 'Weight'),
  '/al2': (code) => pageAlias(code, 'Mass'),
  '/al3': (code) => pageAlias(code, 'Weight'),
  '/al4': (code) => pageAlias(code, 'Gewicht'),
  '/sku1': pageModelSku,
  '/sku2': pageTwoSku,
  '/aux1': (code) => pageAux(code, 'Settings'),
  '/aux2': (code) => pageAux(code, 'Settings'),
  '/aux3': (code) => pageAux(code, 'Settings'),
  '/aux4': (code) => pageAux(code, 'Preferences'),
  '/auxm': (code) => pageAux(code, 'Settings', false),
  '/dl1': pageDocTabs,
  '/dl2': pageDocTabs,
  '/dl3': pageDocTabs,
  '/dl4': pageDocTabs,
  '/icon': pageIconDoc,
  '/late': pageLateDocs,
  '/ax1': pageDeepAcc,
  '/ax2': pageDeepAcc,
  '/ax3': pageDeepAcc,
  '/ax4': pageDeepAcc,
  '/ov1': (code) => pageOverview(code, 'Show more details', 'NBR'),
  '/ov2': (code) => pageOverview(code, 'Expand product facts', 'NBR'),
  '/ov3': (code) => pageOverview(code, 'Show all properties', 'NBR'),
  '/ov4': (code) => pageOverview(code, 'Reveal everything', 'NBR'),
  '/ovx': (code) => pageOverview(code, 'Reveal everything', 'NBR').replace('>NBR</td>', '>FKM</td>'),
  '/sa1': (code) => pageAliasSection(code, 'Specifications'),
  '/sa2': (code) => pageAliasSection(code, 'Technical data'),
  '/sa3': (code) => pageAliasSection(code, 'Specifications'),
  '/sa4': (code) => pageAliasSection(code, 'Technical data'),
  '/xt': pageExtraTable,
  '/xt2': pageExtraTable,
  '/xt3': pageExtraTable,
  '/fm': (code) => pageMissingField(code, 'Part no.'),
  '/fm2': (code) => pageMissingField(code, 'Item no.'),
  '/sw1': (code) => pageSwappedSlot(code, '800 g', '810 g'),
  '/sw2': (code) => pageSwappedSlot(code, '800 g', '810 g'),
  '/sw3': (code) => pageSwappedSlot(code, '800 g', '810 g'),
  '/sw4': (code) => pageSwappedSlot(code, '900 g', '910 g'),
  '/xc': pageExcludedCtl,
  '/am': pageAmbiguousCtl,
  '/ok1': pageOpaqueLinks,
  '/ok2': pageOpaqueLinks,
  '/ok3': pageOpaqueLinks,
  '/ok4': (code) => pageOpaqueLinks(code, true),
  '/cr': pageCredentialLink,
  '/ly1': (code) => pageLayout(code, 'layout-plain'),
  '/ly2': (code) => pageLayout(code, 'layout-card'),
  '/ly3': (code) => pageLayout(code, 'layout-grid'),
  '/ly4': (code) => pageLayout(code, 'layout-plain'),
  '/tb1': (code) => pageTwoTables(code, '24 V', '230 V'),
  '/tb2': (code) => pageTwoTables(code, '24 V', '230 V'),
  '/tb3': (code) => pageTwoTables(code, '24 V', '230 V'),
  '/tb4': (code) => pageTwoTables(code, '48 V', '230 V'),
  '/ove1': pageOverviewAlias,
  '/ove2': pageOverviewAlias,
  '/ove3': pageOverviewAlias,
  '/ove4': pageOverviewAlias,
  '/lay1': (code) => pageAncLayout(code, 'lay-plain'),
  '/lay2': (code) => pageAncLayout(code, 'lay-card'),
  '/lay3': (code) => pageAncLayout(code, 'lay-grid'),
  '/lay4': (code) => pageAncLayout(code, 'lay-plain'),
  '/lay5': (code) => pageAncLayout(code, 'lay-card'),
  '/lay6': (code) => pageAncLayout(code, 'lay-grid'),
  '/ua1': (code) => pageTwoUnheaded(code),
  '/ua2': (code) => pageTwoUnheaded(code),
  '/ua3': (code) => pageTwoUnheaded(code, true),
  '/ua4': (code) => pageTwoUnheaded(code),
  '/ua5': (code) => pageTwoUnheaded(code, true),
  '/spx': (code) => pageSchemaPath(code, 'Crossed series, wrong product'),
  '/skd': pageSkuDup,
  '/id1': (code) => pageIdReveal(code, '', `M-${code.slice(3)}`),
  '/id2': (code) => pageIdReveal(code, '', `M-${code.slice(3)}`),
  '/id3': (code) => pageIdReveal(code, '', `M-${code.slice(3)}`),
  '/id4': (code) => pageIdReveal(code, '', `M-${code.slice(3)}`),
  '/id5': (code) => pageIdReveal(code, `<span itemprop="mpn">MP-${code.slice(3)}</span><span>Part no.:</span><span>PT-${code.slice(3)}</span>`, `M-${code.slice(3)}`),
};

export const DETAIL_CODES: Record<string, string> = {
  '/a': 'FIX-A101',
  '/a2': 'FIX-A101',
  '/b': 'FIX-B202',
  '/c': 'FIX-C303',
  '/d': 'FIX-D404',
  '/e': 'FIX-E505',
  '/f': 'FIX-F606',
  '/g': 'FIX-G707',
  '/h': 'FIX-H808',
  '/i': 'FIX-I909',
  '/j': 'FIX-J010',
  '/k': 'FIX-K111',
  '/m': 'FIX-M121',
  '/n': 'FIX-N131',
  '/p': 'FIX-P111',
  '/x': 'FIX-X141',
  '/many': 'FIX-Q151',
  '/t': 'FIX-T161',
  '/dup': 'FIX-U171',
  '/redir': 'FIX-R111',
  '/mix': 'FIX-M505',
  '/d2': 'FIX-D606',
  '/err': 'FIX-R555',
  '/f2': 'FIX-F707',
  '/frame': 'FIX-W111',
  '/cap': 'FIX-C909',
  '/one': 'FIX-O121',
  '/i2': 'FIX-I212',
  '/nomain': 'FIX-N313',
  '/consent': 'FIX-C424',
  '/deu': '1005-000-001',
  '/rc1': 'FIX-R101',
  '/rc2': 'FIX-R202',
  '/rc3': 'FIX-R303',
  '/dub1': '1005-000-001',
  '/dub2': '1005-011-037',
  '/n1': '10.01.01.13237',
  '/lu1': '50153815',
  '/lu2': '50153814',
  '/lu3': '50153813',
  '/lu4': '50153812',
  '/s1': 'SCH-1001',
  '/s2': 'SCH-1002',
  '/s3': 'SCH-1003',
  '/s4': 'SCH-4004',
  '/sp1': 'SPH-1001',
  '/sp2': 'SPH-1002',
  '/sp3': 'SPH-1003',
  '/sp4': 'SPH-4004',
  '/sh': 'HD-0001',
  '/deep': 'DEP-0001',
  '/pan': 'PAN-0001',
  '/v1': 'DUP-1001',
  '/v2': 'DUP-1002',
  '/v3': 'DUP-1003',
  '/vx': 'DUP-4004',
  '/o1': 'OPT-1001',
  '/o2': 'OPT-1002',
  '/o3': 'OPT-1003',
  '/of1': 'OFR-1001',
  '/of2': 'OFR-1002',
  '/of3': 'OFR-1003',
  '/dd1': 'DIM-1001',
  '/dd2': 'DIM-1002',
  '/dd3': 'DIM-1003',
  '/al1': 'AL-1001',
  '/al2': 'AL-1002',
  '/al3': 'AL-1003',
  '/al4': 'AL-4004',
  '/sku1': 'TSK-1111',
  '/sku2': 'TSK-2222',
  '/aux1': 'AUX-1001',
  '/aux2': 'AUX-1002',
  '/aux3': 'AUX-1003',
  '/aux4': 'AUX-4004',
  '/auxm': 'AUX-4005',
  '/dl1': 'DOC-1001',
  '/dl2': 'DOC-1002',
  '/dl3': 'DOC-1003',
  '/dl4': 'DOC-4004',
  '/icon': 'DOC-5005',
  '/late': 'DOC-4005',
  '/ax1': 'AX-1001',
  '/ax2': 'AX-1002',
  '/ax3': 'AX-1003',
  '/ax4': 'AX-4004',
  '/ov1': 'OV-1001',
  '/ov2': 'OV-1002',
  '/ov3': 'OV-1003',
  '/ov4': 'OV-4004',
  '/ovx': 'OV-4005',
  '/sa1': 'SA-1001',
  '/sa2': 'SA-1002',
  '/sa3': 'SA-1003',
  '/sa4': 'SA-4004',
  '/xt': 'XT-1001',
  '/xt2': 'XT-1002',
  '/xt3': 'XT-1003',
  '/fm': 'FM-4004',
  '/fm2': 'FM-4005',
  '/sw1': 'SW-1001',
  '/sw2': 'SW-1002',
  '/sw3': 'SW-1003',
  '/sw4': 'SW-4004',
  '/xc': 'XC-4004',
  '/am': 'AM-4004',
  '/ok1': 'OK-1001',
  '/ok2': 'OK-1002',
  '/ok3': 'OK-1003',
  '/ok4': 'OK-4004',
  '/cr': 'CR-4004',
  '/ly1': 'LY-1001',
  '/ly2': 'LY-1002',
  '/ly3': 'LY-1003',
  '/ly4': 'LY-4004',
  '/tb1': 'TB-1001',
  '/tb2': 'TB-1002',
  '/tb3': 'TB-1003',
  '/tb4': 'TB-4004',
  '/ove1': 'OVE-1001',
  '/ove2': 'OVE-1002',
  '/ove3': 'OVE-1003',
  '/ove4': 'OVE-4004',
  '/lay1': 'LAY-1001',
  '/lay2': 'LAY-1002',
  '/lay3': 'LAY-1003',
  '/lay4': 'LAY-4004',
  '/lay5': 'LAY-4005',
  '/lay6': 'LAY-4006',
  '/ua1': 'UA-1001',
  '/ua2': 'UA-1002',
  '/ua3': 'UA-1003',
  '/ua4': 'UA-4004',
  '/ua5': 'UA-4005',
  '/spx': 'SPX-9999',
  '/skd': 'SKD-1001',
  '/id1': 'ID-1001',
  '/id2': 'ID-1002',
  '/id3': 'ID-1003',
  '/id4': 'ID-4004',
  '/id5': 'ID-9999',
};

export function detailPageFor(host: string, pathname: string): string | undefined {
  if (host === 'other.test') return OTHER_LANDING;
  const build = PAGES[pathname];
  return build ? build(DETAIL_CODES[pathname] ?? '') : undefined;
}

/** Playwright route handler serving the fixture site; records requested paths. */
export function detailRouteHandler(requested: string[] = []) {
  return async (route: Route) => {
    const u = new URL(route.request().url());
    requested.push(`${u.hostname}${u.pathname}${u.search}`);
    const html = detailPageFor(u.hostname, u.pathname);
    if (html) {
      await route.fulfill({ status: 200, contentType: 'text/html', body: html });
    } else {
      await route.fulfill({ status: 404, contentType: 'text/plain', body: 'not found' });
    }
  };
}

/** Standalone http server on 127.0.0.1 for manual inspection (CLI, Playwright CLI). */
export async function startDetailSite(port = 0): Promise<{ origin: string; close: () => Promise<void>; requested: string[] }> {
  const requested: string[] = [];
  const server = createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://127.0.0.1');
    requested.push(u.pathname + u.search);
    const html = detailPageFor('detail.test', u.pathname);
    if (html) {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(html);
    } else {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
    }
  });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fixture server failed to bind');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    requested,
    close: () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}

export function detailTargets(origin: string, paths: string[] = ['/a', '/b', '/c']): DetailTarget[] {
  return paths.map((p) => ({ url: `${origin}${p}`, expected_code: DETAIL_CODES[p] }));
}

/** Scripted stand-in for Jev: classifies fixture candidates, controls and blocks by shape. */
export function scriptedDetailJudge(opts: {
  primaryPattern?: RegExp;
  controlProbability?: number;
  blockRoleByUrl?: Record<string, string>;
  headingRoles?: Record<string, string>;
  fieldRoles?: Record<string, string>;
  blockRoleWhen?: { match: RegExp; role: string }[];
  relationNoul?: number | ((kind: string, instructions: Record<string, any>) => number);
  downloadLabels?: RegExp;
  descriptivePattern?: RegExp;
} = {}): Judge {
  const primary = opts.primaryPattern ?? /^FIX-[A-Z]\d{3}$/;
  const prob = opts.controlProbability ?? 0.9;
  const answer = (role: string, roles: string[], p = prob) => ({
    choice: role,
    probabilities: Object.fromEntries(roles.map((r) => [r, r === role ? p : (1 - p) / Math.max(1, roles.length - 1)])),
  });
  const GATE_ROLES = Object.keys(CONTROL_ROLES);
  const trace: Judge['trace'] = [];
  return {
    trace,
    async ask(step, _state, questions) {
      const out: Record<string, unknown> = {};
      if (step === 'gate') {
        // The consent fixture is the only page that answers gate_present true.
        const consent = String((_state as { page?: { url?: string } })?.page?.url ?? '').includes('/consent');
        for (const [k, q] of Object.entries(questions as Record<string, { instructions?: Record<string, any> }>)) {
          if (k === 'gate_present') {
            out[k] = { noul: consent ? 0.95 : 0 };
          } else if (k.startsWith('role_')) {
            const label = q.instructions?.control?.label ?? '';
            const role = /reject|decline|necessary|essential/i.test(label) ? 'reject_optional'
              : /accept|allow/i.test(label) ? 'accept_all'
                : /settings|preferences|manage|details/i.test(label) ? 'open_settings'
                  : 'other';
            out[k] = answer(role, GATE_ROLES, consent ? 0.9 : 0.2);
          }
        }
        trace.push({ step, model: 'scripted', latency_ms: 0, input_tokens: 0, state: _state, questions, answers: out });
        return out as never;
      }
      for (const [k, q] of Object.entries(questions as Record<string, { instructions?: Record<string, any> }>)) {
        const ins = q.instructions ?? {};
        if (k.startsWith('identity_')) {
          const c = ins.candidate ?? {};
          if (c.source !== undefined) {
            const role = primary.test(c.value ?? '') ? 'primary_code'
              : (opts.descriptivePattern?.test(c.value ?? '') ? 'descriptive_model' : 'other');
            out[k] = answer(role, ['primary_code', 'descriptive_model', 'other'], 0.9);
          } else {
            out[k] = answer(primary.test(c.value ?? '') ? 'primary_code' : 'other', ['primary_code', 'other'], 0.9);
          }
        } else if (k.startsWith('detail-heading_')) {
          const h = ins.heading ?? {};
          const role = opts.headingRoles?.[h.text ?? '']
            ?? (opts.descriptivePattern?.test(h.text ?? '') ? 'product_description'
              : ((h.sample_labels ?? []).length || h.via === 'panel_label' ? 'specification_section' : 'other'));
          out[k] = answer(role, ['specification_section', 'document_section', 'product_description', 'navigation', 'disclosure_ui', 'other']);
        } else if (k.startsWith('detail-field_')) {
          const label = ins.candidate?.label ?? '';
          const role = opts.fieldRoles?.[label] ?? (/^(attribute|value)$/i.test(label) ? 'table_heading' : 'product_attribute');
          out[k] = answer(role, ['product_attribute', 'ordering_attribute', 'table_heading', 'ui_navigation', 'marketing', 'other']);
        } else if (k.startsWith('detail-section-relation_') || k.startsWith('detail-field-relation_') || k.startsWith('detail-duplicate-relation_')) {
          const noul = typeof opts.relationNoul === 'function'
            ? opts.relationNoul(k.startsWith('detail-section') ? 'section' : k.startsWith('detail-field') ? 'field' : 'duplicate', ins)
            : (opts.relationNoul ?? 0.95);
          out[k] = { noul };
        } else if (k.startsWith('detail-download_')) {
          const c = ins.candidate ?? {};
          const role = opts.downloadLabels?.test(c.label ?? '') ? 'direct_download'
            : /\.(pdf|docx?|xlsx?|csv|zip|step|stp|iges|igs|dxf|dwg|stl)($|\?)/i.test(c.url ?? '') || c.download_attribute
            ? 'direct_download'
            : /log\s?in|account|cart|watch|product|family|catalog/i.test(`${c.label ?? ''} ${c.url ?? ''}`) ? 'navigation' : 'other';
          out[k] = answer(role, ['direct_download', 'navigation', 'other']);
        } else if (k.startsWith('control_')) {
          const c = ins.control ?? {};
          const text = `${c.label ?? ''} ${c.panel_heading ?? ''}`;
          const role = /variant|config|option|price|quantity|cart|login|compare|related/i.test(text)
            ? 'other'
            : /specification|dimension|electrical|technical|operating|data/i.test(text)
              ? 'specifications'
              : /download|document|file|media|drawing/i.test(text)
                ? 'downloads'
                : 'other';
          out[k] = answer(role, ['specifications', 'downloads', 'other']);
        } else if (k.startsWith('block_')) {
          const b = ins.block ?? {};
          const pageUrl = String((_state as { page?: { url?: string } })?.page?.url ?? '');
          const override = opts.blockRoleByUrl?.[new URL(pageUrl).pathname];
          const section = (b.section ?? []).join(' ');
          const labels = `${(b.sample_rows ?? []).map((r: { label: string }) => r.label).join(' ')} ${(b.link_labels ?? []).join(' ')}`;
          let role = 'other';
          const when = opts.blockRoleWhen?.find((x) => x.match.test(`${section}|${labels}`));
          // Label evidence decides first: a related-products table inside a technical section
          // keeps its own judgment instead of borrowing the section's.
          if (override) role = override;
          else if (when) role = when.role;
          else if (/variant|model|compare|related|compatible/i.test(labels)) role = 'related_products';
          else if (/accessor|spare/i.test(`${labels} ${section}`)) role = 'accessories';
          else if (/datasheet|cad|step|drawing|download|document|file|certificate/i.test(`${section} ${labels}`)) role = 'downloads';
          else if (/specification|dimension|electrical|technical|operating|compliance/i.test(section)) role = 'specifications';
          else if (/voltage|pressure|current|weight|material|width|price|property|new|shaft|bore/i.test(labels)) role = 'specifications';
          out[k] = answer(role, ['specifications', 'ordering', 'downloads', 'accessories', 'related_products', 'marketing', 'other']);
        }
      }
      trace.push({ step, model: 'scripted', latency_ms: 0, input_tokens: 0, state: _state, questions, answers: out });
      return out as never;
    },
  };
}
