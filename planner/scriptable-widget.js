// Full Focus Planner — Scriptable Widget
//
// Shows today's Big 3 and task list, pulled live from your Full Focus
// Planner's Notion-synced API.
//
// SETUP
// 1. Install "Scriptable" from the App Store (free).
// 2. Open Scriptable, tap "+" (top right), select the empty script, paste
//    this entire file in, then rename it (top center) to "Full Focus Planner".
// 3. Replace BASE_URL below with your Vercel deployment URL
//    (e.g. "https://your-project.vercel.app" — no trailing slash).
// 4. Long-press your iPhone home screen → tap "+" → search "Scriptable" →
//    add a Small or Medium widget.
// 5. Long-press the new widget → "Edit Widget" → set Script to
//    "Full Focus Planner".
//    (Optional: set the "Parameter" field to a different planner URL to
//    override BASE_URL without editing the script.)

const BASE_URL = "https://YOUR-PROJECT.vercel.app"; // <-- replace with your Vercel URL

const baseUrl = (args.widgetParameter || BASE_URL).replace(/\/+$/, "");

function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function fetchDay() {
  const req = new Request(`${baseUrl}/api/day?date=${todayKey()}`);
  req.timeoutInterval = 8;
  return await req.loadJSON();
}

function palette() {
  return {
    bg: new Color("#F9F6F0"),
    accent: new Color("#2D5A3D"),
    gold: new Color("#B8832A"),
    text: new Color("#1C1A17"),
    muted: new Color("#A5A09A"),
  };
}

function addRow(widget, text, done, c, emphasize) {
  const row = widget.addStack();
  row.centerAlignContent();
  row.spacing = 6;

  const dot = row.addText(done ? "●" : "○");
  dot.font = Font.systemFont(11);
  dot.textColor = done ? c.accent : (emphasize ? c.gold : c.muted);

  const label = row.addText(text || "—");
  label.font = emphasize ? Font.semiboldSystemFont(13) : Font.systemFont(12);
  label.textColor = done ? c.muted : c.text;
  label.lineLimit = 1;
}

function addSectionLabel(widget, text, c) {
  const label = widget.addText(text);
  label.font = Font.semiboldSystemFont(9);
  label.textColor = c.muted;
  widget.addSpacer(4);
}

async function createWidget() {
  const c = palette();
  const widget = new ListWidget();
  widget.backgroundColor = c.bg;
  widget.url = `${baseUrl}/planner/`;
  widget.setPadding(14, 14, 14, 14);

  const header = widget.addText("FULL FOCUS");
  header.font = Font.boldSystemFont(11);
  header.textColor = c.accent;
  widget.addSpacer(6);

  let data = null;
  try {
    data = await fetchDay();
  } catch (e) {
    data = null;
  }

  if (!data) {
    const msg = widget.addText("Can't reach planner — check BASE_URL or your connection.");
    msg.font = Font.systemFont(12);
    msg.textColor = c.muted;
    widget.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);
    return widget;
  }

  const big3 = (data.big3 || []).filter(t => t.text);
  const tasks = data.tasks || [];

  if (big3.length) {
    addSectionLabel(widget, "BIG 3", c);
    big3.forEach(t => addRow(widget, t.text, t.done, c, true));
    widget.addSpacer(8);
  }

  if (tasks.length) {
    addSectionLabel(widget, "TASKS", c);
    const family = config.widgetFamily;
    const max = family === "small" ? 3 : family === "medium" ? 5 : 10;
    tasks.slice(0, max).forEach(t => addRow(widget, t.text, t.done, c, false));

    if (tasks.length > max) {
      const more = widget.addText(`+${tasks.length - max} more`);
      more.font = Font.systemFont(11);
      more.textColor = c.muted;
    }
  }

  if (!big3.length && !tasks.length) {
    const msg = widget.addText("Nothing planned yet today.");
    msg.font = Font.systemFont(12);
    msg.textColor = c.muted;
  }

  widget.refreshAfterDate = new Date(Date.now() + 10 * 60 * 1000); // hint: refresh ~every 10 min
  return widget;
}

const widget = await createWidget();

if (config.runsInWidget) {
  Script.setWidget(widget);
} else {
  await widget.presentMedium();
}
Script.complete();
