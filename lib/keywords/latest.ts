interface HasKeywordAndFetchedAt {
  keyword: string;
  fetchedAt: Date;
}

/**
 * KeywordMetric rows are never overwritten — a later fetch for the same
 * keyword just adds a new row (see the model comment). Callers that need
 * "the current numbers" resolve it here: most recent fetchedAt wins per
 * keyword, independent of which coverage import triggered the fetch.
 */
export function latestPerKeyword<T extends HasKeywordAndFetchedAt>(metrics: T[]): T[] {
  const byKeyword = new Map<string, T>();
  const sorted = [...metrics].sort((a, b) => b.fetchedAt.getTime() - a.fetchedAt.getTime());
  for (const m of sorted) {
    if (!byKeyword.has(m.keyword)) byKeyword.set(m.keyword, m);
  }
  return Array.from(byKeyword.values());
}
