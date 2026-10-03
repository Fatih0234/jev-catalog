import type { ListingRecipe, Row } from './listing.js';

export const DETAIL_POLICY = {
  sampleCount: 3,
  roleProbability: 0.6,
  relationProbability: 0.9,
  maxFieldQuestions: 20,
  maxFieldRequestCharacters: 24_000,
  maxFieldRelations: 300,
  maxContextHeadings: 12,
  maxContextDepth: 6,
  maxClassesPerNode: 8,
  maxReveals: 16,
  maxControls: 24,
  maxBlocks: 40,
  maxRowsPerBlock: 150,
  maxIdentityCandidates: 12,
  maxText: 240,
  maxValue: 600,
  maxPageText: 4_000,
  maxLinksPerBlock: 150,
  shortErrorPageText: 1_500,
  minScopeText: 250,
  maxHeadingCandidates: 4,
  minPeerRows: 2,
  minPeerCoverage: 0.6,
  minFlatGridPairs: 3,
  navigationTimeoutMs: 30_000,
  revealTimeoutMs: 2_000,
  pauseMs: 1_000,
} as const;

export const DETAIL_ERROR_TITLE = /^(?:generic\s+)?error\b|access denied|permission denied|\bforbidden\b|request (?:was |has been )?blocked|verify (?:you are|you're) human/i;
export const DETAIL_ERROR_CONTENT = /access denied|generic error|permission denied|request (?:was |has been )?blocked|\bforbidden\b|are you a robot|your logon id may have been used in another browser/i;
export const DETAIL_DOCUMENT_PATH = /\.(pdf|docx?|xlsx?|csv|zip|step|stp|iges|igs|dxf|dwg|stl)$/i;
export const DETAIL_UNIT_SUFFIX = /^\s*[-+]?\d+(?:[.,]\d+)?\s*(mm|cm|m|µm|μm|g|kg|V|mV|A|mA|W|kW|N|Nm|bar|Pa|kPa|MPa|°C|°F|%|s|ms|Hz|kHz)\s*$/u;
export const DETAIL_COMPOSITE_LABEL = /(?:\s(?:and|&|\+)\s|\/)/i;
export const DETAIL_PRIMARY_LABEL = /^(?:part\s*(?:no\.?|number)|article\s*(?:no\.?|number)|order\s*(?:no\.?|number|code)|art\.?\s*(?:nr\.?|no\.?)|artikel(?:nummer|-?nr\.?)|bestell(?:nummer|-?nr\.?)|sku|product\s*(?:id|code))\s*:?\s*$/i;

export function detailObservedUrlKey(url: string, expectedCode?: string): string {
  if (!expectedCode) return url;
  const token = expectedCode.normalize('NFC').trim();
  if (!token) return url;
  let parsed: URL;
  try { parsed = new URL(url); } catch { return url; }
  const input = parsed.pathname + parsed.search;
  const word = (character: string) => /[\p{L}\p{N}]/u.test(character);
  let offset = 0;
  let output = '';
  for (let index = input.indexOf(token); index >= 0; index = input.indexOf(token, offset)) {
    const end = index + token.length;
    output += input.slice(offset, index);
    output += !word(input[index - 1] ?? '') && !word(input[end] ?? '') ? '{code}' : token;
    offset = end;
  }
  return parsed.origin + output + input.slice(offset) + parsed.hash;
}

export interface DetailTarget {
  url: string;
  expected_code?: string;
  listing_identity?: string;
  row?: Row;
}

export interface DetailTargetSelection {
  targets: DetailTarget[];
  issues: { row: number; reason: 'missing_url' | 'invalid_url' | 'wrong_site' | 'missing_code' | 'shared_url' }[];
}

export function normalizeDetailCode(value: string): string {
  return value.normalize('NFC').replace(/[\u00ad\u200b-\u200d\ufeff]/g, '')
    .replace(/^(?:item\s+no\.?|article\s+(?:no\.?|number)|part\s+(?:no\.?|number)|order\s+code|sku|code)(?:\s*:\s*|\s+)/i, '')
    .replace(/\s+/g, ' ').trim();
}

export function sampleDetailTargets(targets: DetailTarget[]): DetailTarget[] {
  const unique = new Map<string, DetailTarget>();
  const conflicts = new Set<string>();
  for (const target of targets) {
    try {
      const url = new URL(target.url);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) continue;
      url.hash = '';
      const prior = unique.get(url.href);
      if (prior && normalizeDetailCode(prior.expected_code ?? '') !== normalizeDetailCode(target.expected_code ?? '')) {
        conflicts.add(url.href);
      }
      if (!prior) unique.set(url.href, { ...target, url: url.href });
    } catch {
      continue;
    }
  }
  const eligible = [...unique.values()].filter((target) => !conflicts.has(target.url));
  if (eligible.length <= DETAIL_POLICY.sampleCount) return eligible;
  return [eligible[0]!, eligible[Math.floor(eligible.length / 2)]!, eligible[eligible.length - 1]!];
}

export function targetsFromListing(recipe: ListingRecipe, rows: Row[]): DetailTargetSelection {
  const codeField = recipe.fields.find((field) => field.name === recipe.identity && field.role === 'order_code')
    ?? recipe.fields.find((field) => field.role === 'order_code');
  const targets: DetailTarget[] = [];
  const urlCodes = new Map<string, Set<string>>();
  const urlRows = new Map<string, number[]>();
  const issues: DetailTargetSelection['issues'] = [];
  for (const [index, row] of rows.entries()) {
    if (!row._url) {
      issues.push({ row: index, reason: 'missing_url' });
      continue;
    }
    let url: URL;
    try {
      url = new URL(row._url);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('invalid URL');
    } catch {
      issues.push({ row: index, reason: 'invalid_url' });
      continue;
    }
    if (url.origin !== new URL(recipe.source_url).origin) {
      issues.push({ row: index, reason: 'wrong_site' });
      continue;
    }
    const expected_code = codeField && row[codeField.name] ? normalizeDetailCode(row[codeField.name]!) : undefined;
    if (!expected_code) issues.push({ row: index, reason: 'missing_code' });
    url.hash = '';
    const codes = urlCodes.get(url.href) ?? new Set<string>();
    codes.add(expected_code ?? '');
    urlCodes.set(url.href, codes);
    urlRows.set(url.href, [...(urlRows.get(url.href) ?? []), index]);
    targets.push({
      url: url.href,
      ...(expected_code ? { expected_code } : {}),
      ...(recipe.identity && row[recipe.identity] ? { listing_identity: row[recipe.identity] } : {}),
      row,
    });
  }
  for (const [url, codes] of urlCodes) {
    if (codes.size > 1) for (const row of urlRows.get(url) ?? []) issues.push({ row, reason: 'shared_url' });
  }
  return { targets: sampleDetailTargets(targets), issues };
}

export function parseDetailListing(input: unknown): { recipe: ListingRecipe; rows: Row[] } {
  if (!input || typeof input !== 'object') throw new Error('Expected a saved listing with recipe and rows');
  const value = input as { recipe?: Partial<ListingRecipe>; rows?: unknown };
  const recipe = value.recipe;
  if (!recipe || recipe.version !== 1 || typeof recipe.source_url !== 'string'
    || !Array.isArray(recipe.fields) || !Array.isArray(value.rows)
    || (recipe.identity !== undefined && typeof recipe.identity !== 'string')) {
    throw new Error('Expected a version 1 listing recipe and an array of rows');
  }
  const source = new URL(recipe.source_url);
  if (!['http:', 'https:'].includes(source.protocol) || source.username || source.password) {
    throw new Error('The listing source must be an HTTP or HTTPS URL without credentials');
  }
  if (recipe.fields.some((field) => !field || typeof field !== 'object'
    || typeof field.name !== 'string' || typeof field.role !== 'string')) {
    throw new Error('Every listing field must have a name and role');
  }
  if (value.rows.some((row) => !row || typeof row !== 'object' || Array.isArray(row)
    || Object.values(row).some((cell) => typeof cell !== 'string'))) {
    throw new Error('Every listing row must be a string-valued object');
  }
  return { recipe: recipe as ListingRecipe, rows: value.rows as Row[] };
}

export type DetailIdentity = 'matched' | 'mismatch' | 'unverified';

export function verifyDetailIdentity(expected: string | undefined, observed: string[]): DetailIdentity {
  if (!expected) return 'unverified';
  const codes = [...new Set(observed.map(normalizeDetailCode).filter(Boolean))];
  if (!codes.length || codes.length > 1) return 'unverified';
  return codes[0] === normalizeDetailCode(expected) ? 'matched' : 'mismatch';
}

export function sameDetailDocument(before: string, after: string): boolean {
  try {
    const a = new URL(before), b = new URL(after);
    a.hash = '';
    b.hash = '';
    return a.href === b.href;
  } catch {
    return false;
  }
}

export function detailFieldKey(section: string[], label: string): string {
  return JSON.stringify([...section, label].map((text) => text.normalize('NFC').replace(/\s+/g, ' ').trim()));
}
