// 매일 07:30(한국 시간)에 구독자별 학년 일정 알림을 보냅니다.
// 월요일에 '주간 요약'을 켠 사람은 이번 주 요약 한 통으로 오늘 알림까지 대신 받습니다.
import { getStore } from '@netlify/blobs';
import webpush from 'web-push';
import { eventsFrom, dailyDigest, weeklyDigest, kstToday } from '../../src/digest.js';

export const config = { schedule: '30 22 * * *' }; // UTC 22:30 = KST 07:30

export default async () => {
  const today = kstToday();
  const dow = today.getDay();
  if (dow === 0 || dow === 6) return new Response('weekend');

  const store = getStore({ name: 'school', consistency: 'strong' });
  const pub = await store.get('public', { type: 'json' });
  if (!pub) return new Response('no data');
  const events = eventsFrom(pub);

  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@example.com', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);

  const { blobs } = await store.list({ prefix: 'sub/' });
  let sent = 0, removed = 0;
  for (const b of blobs) {
    const rec = await store.get(b.key, { type: 'json' });
    if (!rec) continue;
    let msg = null;
    if (dow === 1 && rec.weekly) msg = weeklyDigest(events, rec.groups, today);
    if (!msg && rec.daily) msg = dailyDigest(events, rec.groups, today);
    if (!msg) continue;
    try { await webpush.sendNotification(rec.sub, JSON.stringify(msg), { TTL: 6 * 3600 }); sent++; }
    catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) { await store.delete(b.key); removed++; }
    }
  }
  return new Response(`sent ${sent}, removed ${removed}`);
};
