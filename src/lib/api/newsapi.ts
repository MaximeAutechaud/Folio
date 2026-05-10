import { invoke } from '@tauri-apps/api/core';

interface NewsApiResponse {
  status: string;
  totalResults: number;
}

async function fetchArticleCount(q: string, from: string, to: string, apiKey: string): Promise<number> {
  const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(q)}&from=${from}&to=${to}&pageSize=1&language=en&apiKey=${apiKey}`;
  try {
    const raw: string = await invoke('fetch_url', { url });
    const data = JSON.parse(raw) as NewsApiResponse;
    if (data.status !== 'ok') return 0;
    return data.totalResults ?? 0;
  } catch {
    return 0;
  }
}

function daysBefore(n: number): string {
  const d = new Date(Date.now() - n * 86_400_000);
  return d.toISOString().split('T')[0];
}

function buildQuery(keywords: string[]): string {
  return keywords
    .map(k => (k.includes(' ') ? `"${k}"` : k))
    .join(' OR ');
}

export async function fetchNewsSentiment(
  keywords: string[],
  apiKey: string
): Promise<{ volume7d: number; volumePrev: number; score: number; mainstream: boolean }> {
  if (keywords.length === 0) return { volume7d: 0, volumePrev: 0, score: 0, mainstream: false };

  const q = buildQuery(keywords);
  const today = daysBefore(0);
  const d7 = daysBefore(7);
  const d14 = daysBefore(14);

  const [volume7d, volumePrev] = await Promise.all([
    fetchArticleCount(q, d7, today, apiKey),
    fetchArticleCount(q, d14, d7, apiKey),
  ]);

  const ratio = volumePrev > 0 ? volume7d / volumePrev : volume7d > 0 ? 3 : 0;
  const score = Math.min((ratio / 3) * 100, 100);
  const mainstream = ratio >= 3;

  return { volume7d, volumePrev, score, mainstream };
}
