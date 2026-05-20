const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const DB_ID  = process.env.NOTION_DATABASE_ID;

// Ensure all required properties exist on the database (idempotent).
let schemaReady = false;
async function ensureSchema() {
  if (schemaReady) return;
  await notion.databases.update({
    database_id: DB_ID,
    properties: {
      'Date':          { date: {} },
      'Intention':     { rich_text: {} },
      'Big 3 #1':      { rich_text: {} },
      'Big 3 #1 Done': { checkbox: {} },
      'Big 3 #2':      { rich_text: {} },
      'Big 3 #2 Done': { checkbox: {} },
      'Big 3 #3':      { rich_text: {} },
      'Big 3 #3 Done': { checkbox: {} },
      'Tasks':         { rich_text: {} },
      'Schedule':      { rich_text: {} },
      'Notes':         { rich_text: {} },
      'Gratitude':     { rich_text: {} },
      'Wins':          { rich_text: {} },
      'Improvement':   { rich_text: {} },
    },
  });
  schemaReady = true;
}

// Notion rich_text has a 2000-char limit per block — chunk long strings.
function toRt(str) {
  const s = String(str || '');
  const out = [];
  for (let i = 0; i < s.length; i += 1999) {
    out.push({ type: 'text', text: { content: s.slice(i, i + 1999) } });
  }
  return out.length ? out : [{ type: 'text', text: { content: '' } }];
}

function fromRt(prop) {
  return (prop?.rich_text || []).map(b => b.plain_text ?? b.text?.content ?? '').join('');
}

function toProperties(date, data) {
  return {
    'Name':          { title: toRt(date) },
    'Date':          { date: { start: date } },
    'Intention':     { rich_text: toRt(data.intention) },
    'Big 3 #1':      { rich_text: toRt(data.big3?.[0]?.text) },
    'Big 3 #1 Done': { checkbox: !!data.big3?.[0]?.done },
    'Big 3 #2':      { rich_text: toRt(data.big3?.[1]?.text) },
    'Big 3 #2 Done': { checkbox: !!data.big3?.[1]?.done },
    'Big 3 #3':      { rich_text: toRt(data.big3?.[2]?.text) },
    'Big 3 #3 Done': { checkbox: !!data.big3?.[2]?.done },
    'Tasks':         { rich_text: toRt(JSON.stringify(data.tasks    ?? [])) },
    'Schedule':      { rich_text: toRt(JSON.stringify(data.schedule ?? {})) },
    'Notes':         { rich_text: toRt(data.notes) },
    'Gratitude':     { rich_text: toRt(data.gratitude) },
    'Wins':          { rich_text: toRt(data.wins) },
    'Improvement':   { rich_text: toRt(data.improvement) },
  };
}

function fromPage(page) {
  const p = page.properties;
  let tasks = [], schedule = {};
  try { tasks    = JSON.parse(fromRt(p['Tasks']));    } catch {}
  try { schedule = JSON.parse(fromRt(p['Schedule'])); } catch {}
  return {
    intention:   fromRt(p['Intention']),
    big3: [
      { text: fromRt(p['Big 3 #1']), done: !!p['Big 3 #1 Done']?.checkbox },
      { text: fromRt(p['Big 3 #2']), done: !!p['Big 3 #2 Done']?.checkbox },
      { text: fromRt(p['Big 3 #3']), done: !!p['Big 3 #3 Done']?.checkbox },
    ],
    tasks,
    schedule,
    notes:       fromRt(p['Notes']),
    gratitude:   fromRt(p['Gratitude']),
    wins:        fromRt(p['Wins']),
    improvement: fromRt(p['Improvement']),
  };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!process.env.NOTION_TOKEN || !process.env.NOTION_DATABASE_ID) {
    return res.status(503).json({ error: 'Notion not configured' });
  }

  try {
    await ensureSchema();

    const date = req.method === 'GET' ? req.query.date : req.body?.date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) {
      return res.status(400).json({ error: 'Invalid or missing date' });
    }

    const existing = await notion.databases.query({
      database_id: DB_ID,
      filter: { property: 'Date', date: { equals: date } },
      page_size: 1,
    });

    if (req.method === 'GET') {
      if (!existing.results.length) return res.json(null);
      return res.json(fromPage(existing.results[0]));
    }

    if (req.method === 'POST') {
      const props = toProperties(date, req.body);
      if (existing.results.length) {
        await notion.pages.update({ page_id: existing.results[0].id, properties: props });
      } else {
        await notion.pages.create({ parent: { database_id: DB_ID }, properties: props });
      }
      return res.json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[notion] day handler error:', err);
    return res.status(500).json({ error: err.message });
  }
};
