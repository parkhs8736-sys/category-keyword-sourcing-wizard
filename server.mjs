import http from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import nodemailer from 'nodemailer';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFile } from 'node:child_process';

const PORT = Number(process.env.PORT || 8787);
const ROOT = fileURLToPath(new URL('.', import.meta.url));
const AUTH_FILE = join(ROOT, 'auth-store.json');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.zip': 'application/zip' };
const WING_PACKAGE_FILE = join(ROOT, 'wing-lens-extension.zip');
const WING_UPLOAD_PASSWORD_HASH = 'f9843f9a13d30c824d124ba62d3f04c82b3f2d15b9e1274c46b722e0b8fd0542';

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

function createFilteredTemplate(records) {
  return new Promise((resolve, reject) => {
    const child = spawn('python', ['generate_filtered_template.py'], { cwd: ROOT });
    const output = []; let error = '';
    child.stdout.on('data', part => output.push(part));
    child.stderr.on('data', part => { error += part; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(Buffer.concat(output)) : reject(new Error(error || '다운로드 양식을 만들지 못했습니다.')));
    child.stdin.end(JSON.stringify({ records }));
  });
}

function runShutdown(args) {
  return new Promise((resolve, reject) => execFile('shutdown', args, error => error ? reject(error) : resolve()));
}
function isWingUploadPassword(value) { return createHash('sha256').update(String(value || '')).digest('hex') === WING_UPLOAD_PASSWORD_HASH; }
async function sendMetricEmail({ to, subject, message, fileName, fileBase64 }) {
  const user = process.env.GMAIL_SMTP_USER;
  const pass = process.env.GMAIL_SMTP_APP_PASSWORD;
  if (!user || !pass) throw new Error('Gmail SMTP 설정이 없습니다. 메일설정하기.ps1을 실행한 뒤 서버를 다시 시작해 주세요.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(to || ''))) throw new Error('수신 이메일 주소를 확인해 주세요.');
  const attachment = Buffer.from(String(fileBase64 || ''), 'base64');
  if (!attachment.length || attachment.length > 20 * 1024 * 1024) throw new Error('첨부 엑셀 파일을 확인해 주세요.');
  const transport = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });
  await transport.sendMail({ from: `신부장 소싱판별기 <${user}>`, to, subject, text: message, attachments: [{ filename: fileName, content: attachment, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }] });
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
  if (url.pathname === '/api/filtered-template' && req.method === 'POST') {
    if (!(await requireAccess(req))) return send(res, 401, JSON.stringify({ message: '인증이 필요합니다.' }));
    try {
      const file = await readRequest(req); file.limit = 0;
      const filters = JSON.parse(url.searchParams.get('filters') || '{}');
      const extracted = JSON.parse(await extractKeywords(file, filters));
      const workbook = await createFilteredTemplate(extracted.records || []);
      res.writeHead(200, { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'content-disposition': "attachment; filename*=UTF-8''%ED%95%84%ED%84%B0%EB%A7%81_%EC%A0%84%EC%B2%B4.xlsx", 'cache-control': 'no-store' });
      return res.end(workbook);
    } catch (error) { return send(res, 422, JSON.stringify({ message: error.message })); }
  }
  if (url.pathname === '/api/shutdown' && req.method === 'POST') {
    if (!(await requireAccess(req))) return send(res, 401, JSON.stringify({ message: '인증이 필요합니다.' }));
    try {
      const { delaySeconds } = JSON.parse((await readRequest(req, 10000)).toString());
      const delay = Math.max(60, Math.min(3600, Math.floor(Number(delaySeconds)) || 120));
      if (process.platform !== 'win32') return send(res, 400, JSON.stringify({ message: 'PC 종료 예약은 Windows에서만 사용할 수 있습니다.' }));
      await runShutdown(['/s', '/t', String(delay)]);
      return send(res, 200, JSON.stringify({ delaySeconds: delay }));
    } catch { return send(res, 500, JSON.stringify({ message: 'PC 종료 예약을 설정하지 못했습니다.' })); }
  }
  if (url.pathname === '/api/shutdown/cancel' && req.method === 'POST') {
    if (!(await requireAccess(req))) return send(res, 401, JSON.stringify({ message: '인증이 필요합니다.' }));
    try {
      if (process.platform !== 'win32') return send(res, 400, JSON.stringify({ message: 'PC 종료 예약은 Windows에서만 사용할 수 있습니다.' }));
      await runShutdown(['/a']);
      return send(res, 200, JSON.stringify({ message: 'PC 종료 예약을 취소했습니다.' }));
    } catch { return send(res, 409, JSON.stringify({ message: '취소할 PC 종료 예약이 없습니다.' })); }
  }
  if (url.pathname === '/api/wing-lens-package' && req.method === 'POST') {
    if (!(await requireAccess(req))) return send(res, 401, JSON.stringify({ message: '인증이 필요합니다.' }));
    if (!isWingUploadPassword(req.headers['x-wing-upload-password'])) return send(res, 403, JSON.stringify({ message: '업로드 비밀번호가 올바르지 않습니다.' }));
    try {
      const file = await readRequest(req, 50 * 1024 * 1024);
      if (file.length < 4 || file[0] !== 0x50 || file[1] !== 0x4b) return send(res, 422, JSON.stringify({ message: '윙렌즈 ZIP 파일만 올릴 수 있습니다.' }));
      await writeFile(WING_PACKAGE_FILE, file);
      return send(res, 200, JSON.stringify({ message: '윙렌즈 다운로드 파일을 교체했습니다.' }));
    } catch (error) { return send(res, 422, JSON.stringify({ message: error.message || '파일을 올리지 못했습니다.' })); }
  }
  if (url.pathname === '/api/metric-email' && req.method === 'POST') {
    if (!(await requireAccess(req))) return send(res, 401, JSON.stringify({ message: '인증이 필요합니다.' }));
    try {
      const payload = JSON.parse((await readRequest(req, 30 * 1024 * 1024)).toString());
      await sendMetricEmail(payload);
      return send(res, 200, JSON.stringify({ message: '분석 결과 이메일을 발송했습니다.' }));
    } catch (error) { return send(res, 422, JSON.stringify({ message: error.message || '이메일을 발송하지 못했습니다.' })); }
  }

  const requested = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const file = normalize(join(ROOT, requested));
  if (!file.startsWith(normalize(ROOT))) return send(res, 403, 'Forbidden', 'text/plain');
  try { return send(res, 200, await readFile(file), MIME[extname(file)] || 'application/octet-stream'); }
  catch { return send(res, 404, 'Not found', 'text/plain'); }
}).listen(PORT, () => console.log(`소싱 판별 관리자 실행 중: http://localhost:${PORT}`));
