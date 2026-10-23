// 알림 문구 만들기 — 아침 알림(remind.mjs)과 테스트 알림(api.mjs)이 함께 씁니다.
import { parseSchedule, matchGroups, ymd, fmtDate, WEEK } from './parse.js';

// 서버는 UTC로 돌기 때문에 한국 시간 기준 '오늘'을 따로 구합니다.
export function kstToday() {
  const k = new Date(Date.now() + 9 * 3600e3);
  return new Date(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate());
}

const short = t => t.replace(/\s+/g, ' ').trim();
const LABEL = { staff: '교직원', parent: '학부모', special: '통합', common: '공통' };
function tag(ev, groups) {
  const g = ev.groups.filter(x => groups.includes(x));
  const nums = g.filter(x => /^\d$/.test(x));
  if (nums.length === 6) return '전교';
  if (nums.length) return nums.join('·') + '학년';
  return LABEL[g[0]] || '';
}

export function eventsFrom(pub) {
  return parseSchedule(pub.schedule, pub.year || new Date().getFullYear()).events;
}

export function dailyDigest(events, groups, today = kstToday()) {
  const key = ymd(today);
  const list = events.filter(e => e.date === key && !e.holiday && matchGroups(e, groups));
  if (!list.length) return null;
  const lines = list.slice(0, 8).map(e => `· [${tag(e, groups)}] ${short(e.text)}`);
  if (list.length > 8) lines.push(`외 ${list.length - 8}건`);
  return {
    title: `오늘 ${fmtDate(key)} 일정 ${list.length}건`,
    body: lines.join('\n'),
    url: `/?d=${key}`, tag: `daily-${key}`,
  };
}

export function weeklyDigest(events, groups, today = kstToday()) {
  const mon = new Date(today); mon.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const days = [...Array(5)].map((_, i) => { const d = new Date(mon); d.setDate(mon.getDate() + i); return ymd(d); });
  const list = events.filter(e => days.includes(e.date) && !e.holiday && matchGroups(e, groups));
  if (!list.length) return null;
  const todayKey = ymd(today);
  const todayCount = list.filter(e => e.date === todayKey).length;
  const lines = list.slice(0, 10).map(e => {
    const [y, m, d] = e.date.split('-').map(Number);
    return `${WEEK[new Date(y, m - 1, d).getDay()]} · ${short(e.text)}`;
  });
  if (list.length > 10) lines.push(`외 ${list.length - 10}건`);
  return {
    title: `이번 주 일정 ${list.length}건` + (todayCount ? ` · 오늘 ${todayCount}건` : ''),
    body: lines.join('\n'),
    url: `/?d=${days[0]}`, tag: `weekly-${days[0]}`,
  };
}
