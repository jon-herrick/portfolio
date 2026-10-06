const ical = require('node-ical');

// One or more published calendar (ICS) links, separated by commas, spaces or
// newlines. Add a link here to onboard another calendar — no code change needed.
const CAL_URLS = (process.env.CALENDAR_ICS_URLS || '')
  .split(/[\s,]+/)
  .map(u => u.trim().replace(/^webcal:\/\//i, 'https://'))
  .filter(Boolean);

const CACHE_TTL_MS = 5 * 60 * 1000;
const DAY_MS       = 24 * 60 * 60 * 1000;
const cache = new Map(); // url -> { at, events }

async function loadCalendar(url) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.events;

  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`calendar fetch ${res.status}`);
  const parsed = ical.sync.parseICS(await res.text());
  const events = Object.values(parsed).filter(e => e.type === 'VEVENT');
  cache.set(url, { at: Date.now(), events });
  return events;
}

// All-day instances are local-midnight Dates (see node-ical docs), so use
// local getters to recover the calendar day.
function dayKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function eventsForDay(vevents, calIdx, date, from, to) {
  // Pad the expansion window a day each side; filter precisely below.
  const winFrom = new Date(from.getTime() - DAY_MS);
  const winTo   = new Date(to.getTime()   + DAY_MS);
  const out = [];

  for (const ev of vevents) {
    if (String(ev.status || '').toUpperCase() === 'CANCELLED') continue;

    let instances;
    try {
      instances = ical.expandRecurringEvent(ev, { from: winFrom, to: winTo, expandOngoing: true });
    } catch {
      continue; // skip a malformed event rather than failing the whole calendar
    }

    for (const inst of instances) {
      if (String(inst.event?.status || '').toUpperCase() === 'CANCELLED') continue;

      if (inst.isFullDay) {
        const s = inst.start;
        const startDay = dayKey(s);
        let endDay = inst.end ? dayKey(inst.end) : ''; // exclusive
        if (endDay <= startDay) endDay = dayKey(new Date(s.getFullYear(), s.getMonth(), s.getDate() + 1));
        if (!(startDay <= date && date < endDay)) continue;
        out.push({ title: inst.summary || '(No title)', allDay: true, location: inst.event?.location || '', cal: calIdx });
      } else {
        const start = inst.start;
        const end   = inst.end || start;
        const overlaps = +start === +end
          ? start >= from && start < to          // zero-length event
          : start < to && end > from;
        if (!overlaps) continue;
        out.push({
          title: inst.summary || '(No title)',
          allDay: false,
          start: start.toISOString(),
          end: end.toISOString(),
          location: inst.event?.location || '',
          cal: calIdx,
        });
      }
    }
  }
  return out;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (!CAL_URLS.length) return res.status(503).json({ error: 'No calendars configured' });

  // date = the viewer's local day (YYYY-MM-DD); from/to = that day's bounds as instants.
  const { date } = req.query;
  const from = new Date(req.query.from);
  const to   = new Date(req.query.to);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') || isNaN(from) || isNaN(to) || to <= from) {
    return res.status(400).json({ error: 'Invalid date range' });
  }

  const results = await Promise.allSettled(CAL_URLS.map(loadCalendar));
  const events = [];
  let failed = 0;
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') events.push(...eventsForDay(r.value, i, date, from, to));
    else { failed++; console.error('[calendar] load failed:', r.reason?.message); }
  });

  events.sort((a, b) => (b.allDay - a.allDay) || String(a.start).localeCompare(String(b.start)));
  res.setHeader('Cache-Control', 'private, max-age=60');
  return res.json({ events, failed });
};
