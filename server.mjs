import http from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const PORT = Number(process.env.PORT || 8787);
const ROOT = fileURLToPath(new URL('.', import.meta.url));
const AUTH_FILE = join(ROOT, 'auth-store.json');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png' };

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}

async function authStore() { try { return JSON.parse(await readFile(AUTH_FILE, 'utf8')); } catch { return {}; } }
async function saveAuth(store) { await writeFile(AUTH_FILE, JSON.stringify(store, null, 2), 'utf8'); }
function authResult(entry) { if (!entry) return { valid: false }; if (entry.kind === 'permanent') return { valid: true, kind: entry.kind, expiresAt: null }; const expiresAt = new Date(new Date(entry.firstAuthenticatedAt).getTime() + 7 * 86400000); return { valid: expiresAt > new Date(), kind: entry.kind, expiresAt: expiresAt.toISOString() }; }
async function requireAccess(req) { const clientId = req.headers['x-client-id']; if (!clientId || typeof clientId !== 'string') return false; return authResult((await authStore())[clientId]).valid; }

function readRequest(req, limit = 200 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', chunk => { size += chunk.length; if (size > limit) reject(new Error('파일 용량은 200MB까지 가능합니다.')); else chunks.push(chunk); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function extractKeywords(file, filters) {
  return new Promise((resolve, reject) => {
    const child = spawn('python', ['extract_keywords.py', String(file.limit ?? 100), JSON.stringify(filters)], { cwd: ROOT });
    const output = []; let error = '';
    child.stdout.on('data', part => output.push(part));
    child.stderr.on('data', part => { error += part; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(Buffer.concat(output).toString()) : reject(new Error(error || '엑셀에서 키워드를 읽지 못했습니다.')));
    child.stdin.end(file);
  });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/api/auth/status') { const clientId = req.headers['x-client-id']; return send(res, 200, JSON.stringify(authResult(clientId ? (await authStore())[clientId] : null))); }
  if (url.pathname === '/api/auth/activate' && req.method === 'POST') {
    try {
      const { code, clientId } = JSON.parse((await readRequest(req, 10000)).toString());
      if (!clientId || !/^[a-z0-9-]{16,80}$/i.test(clientId)) return send(res, 400, JSON.stringify({ message: '인증 정보를 확인할 수 없습니다.' }));
      const store = await authStore(); const current = store[clientId];
      if (code === 'SHIN2030') store[clientId] = { kind: 'permanent', firstAuthenticatedAt: current?.firstAuthenticatedAt || new Date().toISOString() };
      else if (code === 'SHIN2026') { if (current?.kind === 'trial' && !authResult(current).valid) return send(res, 403, JSON.stringify({ message: '이 기기의 7일 사용 기간이 만료되었습니다.' })); store[clientId] ||= { kind: 'trial', firstAuthenticatedAt: new Date().toISOString() }; }
      else return send(res, 401, JSON.stringify({ message: '인증코드가 올바르지 않습니다.' }));
      await saveAuth(store); return send(res, 200, JSON.stringify(authResult(store[clientId])));
    } catch { return send(res, 400, JSON.stringify({ message: '인증 요청을 처리하지 못했습니다.' })); }
  }
  if (url.pathname === '/api/judge') {
    if (!(await requireAccess(req))) return send(res, 401, JSON.stringify({ message: '인증이 필요합니다.' }));
    const keyword = url.searchParams.get('keyword')?.trim();
    if (!keyword) return send(res, 400, JSON.stringify({ message: '키워드가 없습니다.' }));
    try {
      const upstream = await fetch(`https://select.irumai.kr/api/judge?keyword=${encodeURIComponent(keyword)}`, { signal: AbortSignal.timeout(30000) });
      return send(res, upstream.status, await upstream.text());
    } catch {
      return send(res, 502, JSON.stringify({ message: '소싱 판별 서버에 연결하지 못했습니다. 잠시 후 다시 실행해 주세요.' }));
    }
  }
  if (url.pathname === '/api/keywords' && req.method === 'POST') {
    if (!(await requireAccess(req))) return send(res, 401, JSON.stringify({ message: '인증이 필요합니다.' }));
    try { const file = await readRequest(req); const requestedLimit = Number(url.searchParams.get('limit')); file.limit = Number.isFinite(requestedLimit) && requestedLimit >= 0 ? requestedLimit : 100; const filters = JSON.parse(url.searchParams.get('filters') || '{}'); return send(res, 200, await extractKeywords(file, filters)); }
    catch (error) { return send(res, 422, JSON.stringify({ message: error.message })); }
  }

  const requested = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const file = normalize(join(ROOT, requested));
  if (!file.startsWith(normalize(ROOT))) return send(res, 403, 'Forbidden', 'text/plain');
  try { return send(res, 200, await readFile(file), MIME[extname(file)] || 'application/octet-stream'); }
  catch { return send(res, 404, 'Not found', 'text/plain'); }
}).listen(PORT, () => console.log(`소싱 판별 관리자 실행 중: http://localhost:${PORT}`));
