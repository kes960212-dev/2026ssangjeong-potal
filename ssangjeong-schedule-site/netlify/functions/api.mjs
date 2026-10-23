// 사이트용 API — 자료 제공, 시트 동기화 수신, 보안 탭 잠금 해제, 알림 구독
import { getStore } from '@netlify/blobs';
import webpush from 'web-push';
import crypto from 'node:crypto';
import { eventsFrom, dailyDigest, weeklyDigest } from '../../src/digest.js';

export const config = { path: '/api/*' };

const env = k => process.env[k] || '';
const json = (o, status = 200, headers = {}) =>
  new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
const hash = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 32);
const safeEq = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

export default async (req, context) => {
  const url = new URL(req.url);
  const route = url.pathname.replace(/^\/api\/?/, '').replace(/\/$/, '');
  const store = getStore({ name: 'school', consistency: 'strong' });
  const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};

  // 1) 공개 자료 (일정·업무 참고)
  if (route === 'data' && req.method === 'GET') {
    const pub = await store.get('public', { type: 'json' });
    if (!pub) return json({ error: '아직 시트에서 자료를 받지 않았습니다. 앱스스크립트의 syncNow를 한 번 실행해 주세요.' }, 404);
    return json(pub);
  }

  // 2) 앱스스크립트가 보내는 시트 자료
  if (route === 'sync' && req.method === 'POST') {
    if (!env('SYNC_KEY') || !safeEq(req.headers.get('x-sync-key') || '', env('SYNC_KEY'))) return json({ error: 'unauthorized' }, 401);
    if (!body.public || !Array.isArray(body.public.schedule)) return json({ error: 'bad payload' }, 400);
    await store.setJSON('public', body.public);
    if (body.secure) await store.setJSON('secure', body.secure);
    return json({ ok: true, at: body.public.updatedAt });
  }

  // 3) 보안 탭 — 코드가 맞을 때만 내려보냄 (같은 기기에서 10분에 5번 틀리면 잠금)
  if (route === 'secure' && req.method === 'POST') {
    const rlKey = 'rl/' + hash(context.ip || 'unknown');
    const rl = (await store.get(rlKey, { type: 'json' })) || { n: 0, t: Date.now() };
    if (Date.now() - rl.t > 10 * 60e3) { rl.n = 0; rl.t = Date.now(); }
    if (rl.n >= 5) return json({ error: '여러 번 틀려서 10분 동안 잠겼습니다.' }, 429);
    if (!safeEq(String(body.code || ''), env('SECURE_CODE') || '0000')) {
      rl.n += 1; await store.setJSON(rlKey, rl);
      return json({ error: '코드가 맞지 않습니다.' }, 403);
    }
    await store.delete(rlKey);
    const sec = await store.get('secure', { type: 'json' });
    return json(sec || { tables: [] });
  }

  // 4) 알림
  if (route === 'vapid') return new Response(env('VAPID_PUBLIC_KEY'), { headers: { 'content-type': 'text/plain' } });

  if (route === 'subscribe' && req.method === 'POST') {
    const sub = body.sub;
    if (!sub || !sub.endpoint) return json({ error: 'no subscription' }, 400);
    const groups = (Array.isArray(body.groups) ? body.groups : []).map(String).slice(0, 12);
    await store.setJSON('sub/' + hash(sub.endpoint), {
      sub, groups, daily: body.daily !== false, weekly: !!body.weekly, at: new Date().toISOString(),
    });
    return json({ ok: true });
  }

  if (route === 'unsubscribe' && req.method === 'POST') {
    if (body.endpoint) await store.delete('sub/' + hash(body.endpoint));
    return json({ ok: true });
  }

  if (route === 'test' && req.method === 'POST') {
    const rec = body.endpoint && await store.get('sub/' + hash(body.endpoint), { type: 'json' });
    if (!rec) return json({ error: '구독 정보가 없습니다. 알림을 다시 켜 주세요.' }, 404);
    webpush.setVapidDetails(env('VAPID_SUBJECT') || 'mailto:admin@example.com', env('VAPID_PUBLIC_KEY'), env('VAPID_PRIVATE_KEY'));
    const pub = await store.get('public', { type: 'json' });
    const events = pub ? eventsFrom(pub) : [];
    const msg = (rec.weekly && weeklyDigest(events, rec.groups)) || dailyDigest(events, rec.groups)
      || { title: '알림이 연결되었습니다', body: '선택한 학년의 일정이 있는 날 아침 7시 30분에 알려 드립니다.', url: '/', tag: 'test' };
    try { await webpush.sendNotification(rec.sub, JSON.stringify(msg)); return json({ ok: true }); }
    catch (e) { return json({ error: '보내지 못했습니다: ' + (e.statusCode || e.message) }, 500); }
  }

  return json({ error: 'not found' }, 404);
};
