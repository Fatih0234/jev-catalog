import type { DetailResult } from '../src/detail.js';
import type { ExpectedProduct } from './heldout-recipe-evidence.js';

interface SourceEvidence {
  sample_url: string;
  label: string;
  value: string;
  section: string[];
}

type ScorableDetail = DetailResult & {
  recipe_version?: number;
  field_sources?: Record<string, SourceEvidence[]>;
  unmapped_fields?: SourceEvidence[];
  warnings?: unknown[];
};

const norm = (value: string) => value.normalize('NFC').replace(/\s+/g, ' ').trim();

export function scoreDetailProduct(result: ScorableDetail | undefined, gold: ExpectedProduct) {
  const version2 = result?.recipe_version === 2;
  const actual = Object.entries(result?.values ?? {}).map(([key, value]) => {
    const path: unknown = JSON.parse(key);
    if (!Array.isArray(path) || !path.every((part) => typeof part === 'string') || typeof value !== 'string') {
      throw new Error('Malformed detail field path or value');
    }
    const sources = result?.field_sources?.[key];
    return { key, path: path as string[], value, sources: Array.isArray(sources) ? sources : [] };
  });
  const matchesFor = (field: ExpectedProduct['fields'][number]) => actual.filter((item) => version2
    ? item.sources.some((source) => source.sample_url === gold.target.url &&
      source.label === field.label && source.section?.at(-1) === field.section)
    : item.path.at(-1) === field.label && item.path.at(-2) === field.section);
  const goldMatches = gold.fields.map(matchesFor);
  const references = new Map<string, number>();
  for (const matches of goldMatches) {
    for (const item of matches) references.set(item.key, (references.get(item.key) ?? 0) + 1);
  }
  const used = new Set<string>();
  const fields = gold.fields.map((field, index) => {
    const matches = goldMatches[index]!;
    matches.forEach((item) => {
      if (!version2 || matches.length === 1 && references.get(item.key) === 1) used.add(item.key);
    });
    const item = matches[0];
    const supported = !version2 || !!item && references.get(item.key) === 1 &&
      item.sources.length > 0 && item.sources.every((source) =>
        source.sample_url === gold.target.url && typeof source.value === 'string' &&
        norm(source.value) === norm(item.value));
    return {
      ...field,
      actual: matches.map((match) => match.value),
      correct: matches.length === 1 && supported && norm(item!.value) === norm(field.value),
    };
  });
  const downloadSet = new Set(result?.downloads.map((download) => download.url) ?? []);
  const downloads = gold.downloads.map((url) => ({ url, correct: downloadSet.has(url) }));
  const extraDownloads = [...downloadSet].filter((url) => !gold.downloads.includes(url));
  const extraValues = actual.filter((item) => !used.has(item.key))
    .map(({ key, path, value }) => ({ key, path, value }));
  const identity = result?.target.url === gold.target.url && result.identity === 'matched' &&
    (!version2 || result.target.expected_code === gold.target.expected_code);
  return {
    target: gold.target,
    present: !!result,
    identity_matched: identity,
    status: result?.status ?? 'missing',
    issues: result?.issues ?? [],
    warnings: result?.warnings ?? [],
    unmapped_fields: result?.unmapped_fields ?? [],
    fields,
    downloads,
    extra_values: extraValues,
    extra_downloads: extraDownloads,
    clean: identity && result?.status === 'ok' && fields.every((field) => field.correct) &&
      downloads.every((download) => download.correct) && !extraValues.length && !extraDownloads.length,
  };
}
