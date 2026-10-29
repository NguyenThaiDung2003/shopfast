/**
 * Đo thời gian phản hồi của catalog khi có cache (F04, ADR-0007).
 *
 *   docker compose up -d --build && docker compose exec api npx prisma db seed
 *   pnpm --filter @shopfast/api bench:cache
 *
 * Mỗi endpoint: xoá cache → đo lần 1 (miss, đọc DB) và lần 2 (hit) → 50 request tuần tự
 * → autocannon chạy tải. Kết quả ghi vào docs/perf/cache-benchmark.md, mục theo trạng thái
 * CACHE_ENABLED của API (chạy lại với CACHE_ENABLED=false để có cột so sánh).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, platform, release } from 'node:os';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import autocannon from 'autocannon';
import { clearCatalogCache } from '../prisma/clear-cache';

const BASE_URL = process.env.BENCH_URL ?? 'http://127.0.0.1:3000';
const DURATION_SECONDS = Number(process.env.BENCH_DURATION ?? 10);
const CONNECTIONS = Number(process.env.BENCH_CONNECTIONS ?? 10);
const SEQUENTIAL_RUNS = 50;
const TARGET_MS = 20;
const ADMIN_EMAIL = process.env.BENCH_ADMIN_EMAIL ?? 'admin01@shopfast.local';
const ADMIN_PASSWORD = process.env.BENCH_ADMIN_PASSWORD ?? process.env.SEED_USER_PASSWORD;
const OUTPUT = resolve(__dirname, '../../../docs/perf/cache-benchmark.md');

const TARGETS = [
  { name: 'Chi tiết sản phẩm', path: `/api/products/${process.env.BENCH_PRODUCT_ID ?? 1}` },
  {
    name: 'Danh sách có lọc',
    path: '/api/products?categoryId=1&minPrice=1000000&sort=price_asc&limit=20',
  },
];

interface TargetResult {
  name: string;
  path: string;
  firstMs: number;
  secondMs: number;
  sequential: { median: number; p95: number; max: number };
  load: autocannon.Result;
}

async function timedGet(path: string): Promise<number> {
  const started = performance.now();
  const res = await fetch(BASE_URL + path);
  await res.arrayBuffer();
  const elapsed = performance.now() - started;
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return elapsed;
}

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

async function adminToken(): Promise<string> {
  if (!ADMIN_PASSWORD) throw new Error('Cần BENCH_ADMIN_PASSWORD hoặc SEED_USER_PASSWORD.');
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  if (!res.ok) throw new Error(`Đăng nhập admin thất bại (${res.status}) – đã chạy seed chưa?`);
  return ((await res.json()) as { accessToken: string }).accessToken;
}

async function measure(name: string, path: string): Promise<TargetResult> {
  const firstMs = await timedGet(path);
  const secondMs = await timedGet(path);
  const runs: number[] = [];
  for (let i = 0; i < SEQUENTIAL_RUNS; i++) runs.push(await timedGet(path));
  runs.sort((a, b) => a - b);
  const load = await autocannon({
    url: BASE_URL + path,
    connections: CONNECTIONS,
    duration: DURATION_SECONDS,
  });
  return {
    name,
    path,
    firstMs,
    secondMs,
    sequential: { median: percentile(runs, 50), p95: percentile(runs, 95), max: runs.at(-1)! },
    load,
  };
}

const ms = (value: number) => `${value.toFixed(1)} ms`;

function render(results: TargetResult[], stats: CacheStats): string {
  const lines = [
    `Chạy lúc ${new Date().toISOString()} · Node ${process.version} · ${platform()} ${release()} · ` +
      `${cpus().length} CPU · API ${BASE_URL}`,
    '',
    '| Endpoint | Lần 1 (miss) | **Lần 2** | Trung vị 50 lần | p95 50 lần | Đạt < 20ms |',
    '| --- | ---: | ---: | ---: | ---: | :---: |',
    ...results.map(
      (r) =>
        `| ${r.name} | ${ms(r.firstMs)} | **${ms(r.secondMs)}** | ${ms(r.sequential.median)} | ` +
        `${ms(r.sequential.p95)} | ${r.secondMs < TARGET_MS ? '✅' : '❌'} |`,
    ),
    '',
    `Tải autocannon: ${CONNECTIONS} kết nối × ${DURATION_SECONDS} giây.`,
    '',
    '| Endpoint | req/s | p50 | p90 | p97.5 | p99 | max | lỗi / non-2xx |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...results.map(
      ({ name, load: { requests, latency, errors, non2xx } }) =>
        `| ${name} | ${Math.round(requests.average)} | ${latency.p50} ms | ${latency.p90} ms | ` +
        `${latency.p97_5} ms | ${latency.p99} ms | ${latency.max} ms | ${errors} / ${non2xx} |`,
    ),
    '',
    `Tỉ lệ trúng cache sau lượt đo (\`GET /api/admin/cache/stats\`): ` +
      stats.namespaces
        .map((n) => `${n.name} ${(n.hitRate * 100).toFixed(2)}%`)
        .concat(`tổng ${(stats.total.hitRate * 100).toFixed(2)}%`)
        .join(' · '),
  ];
  return lines.join('\n');
}

interface CacheStats {
  enabled: boolean;
  namespaces: Array<{ name: string; hitRate: number }>;
  total: { hitRate: number };
}

/** Thay đúng mục của chế độ đang đo, giữ nguyên mục còn lại và phần viết tay. */
function writeSection(enabled: boolean, body: string): void {
  const mode = enabled ? 'on' : 'off';
  const start = `<!-- bench:${mode}:start -->`;
  const end = `<!-- bench:${mode}:end -->`;
  const block = `${start}\n${body}\n${end}`;
  mkdirSync(dirname(OUTPUT), { recursive: true });
  let doc = existsSync(OUTPUT) ? readFileSync(OUTPUT, 'utf8') : '';
  if (doc.includes(start) && doc.includes(end)) {
    doc = doc.slice(0, doc.indexOf(start)) + block + doc.slice(doc.indexOf(end) + end.length);
  } else {
    const title = enabled ? '## Kết quả – cache bật' : '## Kết quả – cache tắt (đối chứng)';
    doc = `${doc.trimEnd()}\n\n${title}\n\n${block}\n`;
  }
  writeFileSync(OUTPUT, doc);
}

async function main(): Promise<void> {
  const token = await adminToken();
  const auth = { Authorization: `Bearer ${token}` };

  await clearCatalogCache(process.env.REDIS_URL); // lần 1 chắc chắn là miss
  await fetch(`${BASE_URL}/api/admin/cache/stats`, { method: 'DELETE', headers: auth });

  const results: TargetResult[] = [];
  for (const { name, path } of TARGETS) {
    console.log(`Đo ${name} (${path})…`);
    results.push(await measure(name, path));
  }

  const statsRes = await fetch(`${BASE_URL}/api/admin/cache/stats`, { headers: auth });
  const stats = (await statsRes.json()) as CacheStats;
  const section = render(results, stats);
  writeSection(stats.enabled, section);

  console.log(`\nCache ${stats.enabled ? 'BẬT' : 'TẮT'}\n\n${section}\n\nĐã ghi ${OUTPUT}`);
  const failed = stats.enabled && results.some((r) => r.secondMs >= TARGET_MS);
  if (failed) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
