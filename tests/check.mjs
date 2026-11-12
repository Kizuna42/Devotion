// Zero-dependency checks for index.html: schedule data integrity,
// local asset references, and runtime behaviour of the inline script.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(root, "index.html"), "utf8");
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
assert.ok(scriptMatch, "inline <script> not found");
const script = scriptMatch[1];

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`not ok - ${name}\n  ${error.message}`);
  }
}

class StubElement {
  constructor(id) {
    this.id = id;
    this.textContent = "";
    this.innerHTML = "";
    this.dataset = {};
    this.style = { setProperty() {} };
    this.listeners = {};
  }
  addEventListener(type, fn) {
    this.listeners[type] = fn;
  }
  scrollIntoView() {}
}

function run({ storage, confirmResult = true, today = "2026-05-01T09:00:00" } = {}) {
  const elements = new Map();
  const get = (id) => {
    if (!elements.has(id)) elements.set(id, new StubElement(id));
    return elements.get(id);
  };
  const RealDate = Date;
  class FixedDate extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : [today]));
    }
  }
  const context = {
    console,
    localStorage: storage,
    window: { confirm: () => confirmResult },
    document: {
      querySelector: (selector) => get(selector.replace(/^#/, "")),
      getElementById: (id) => get(id),
    },
    Date: FixedDate,
  };
  vm.runInNewContext(`${script}\n;globalThis.__state = { READINGS, getCompleted: () => completed };`, context);
  return { context, get, state: context.__state };
}

function memoryStorage(initial) {
  const data = new Map(initial === undefined ? [] : [["devotionBibleSchedule:v2:completed", initial]]);
  return {
    data,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
  };
}

const { state } = run({ storage: memoryStorage() });
const READINGS = state.READINGS;
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

test("schedule has 70 sequential days", () => {
  assert.equal(READINGS.length, 70);
  READINGS.forEach((reading, index) => assert.equal(reading.day, index + 1));
});

test("dates are consecutive and weekdays match", () => {
  READINGS.forEach((reading, index) => {
    const date = new Date(`${reading.date}T00:00:00Z`);
    assert.equal(WEEKDAYS[date.getUTCDay()], reading.weekday, `day ${reading.day} weekday`);
    if (index > 0) {
      const prev = new Date(`${READINGS[index - 1].date}T00:00:00Z`);
      assert.equal(date - prev, 86400000, `day ${reading.day} is not the day after day ${reading.day - 1}`);
    }
  });
});

test("every reading has a known section, title and passage", () => {
  const sections = new Set(["神を発見 S1", "神を発見 S2", "従う", "成熟"]);
  for (const reading of READINGS) {
    assert.ok(sections.has(reading.section), `day ${reading.day} section ${reading.section}`);
    assert.ok(reading.title.trim(), `day ${reading.day} title`);
    assert.ok(reading.passage.trim(), `day ${reading.day} passage`);
  }
});

test("summary end date matches the last reading", () => {
  const last = READINGS[READINGS.length - 1].date.split("-").map(Number);
  assert.ok(html.includes(`<strong>${last[1]}/${last[2]}</strong>`), "完了予定 does not match last date");
});

test("local asset references exist", () => {
  const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1])
    .filter((ref) => !/^(?:https?:|data:|#|mailto:)/.test(ref));
  for (const ref of refs) assert.ok(existsSync(join(root, ref)), `missing ${ref}`);
});

test("first visit stores default progress", () => {
  const storage = memoryStorage();
  const { get } = run({ storage });
  assert.equal(storage.getItem("devotionBibleSchedule:v2:completed"), JSON.stringify([1,2,3,4,5,6,7,8,9,10,11,12]));
  assert.equal(get("completed-count").textContent, "12 / 70");
});

test("out-of-range and non-integer stored values are ignored", () => {
  const { get, state } = run({ storage: memoryStorage(JSON.stringify([1, 2, 0, 71, 999, "3", 2.5])) });
  assert.deepEqual([...state.getCompleted()], [1, 2]);
  assert.equal(get("completed-count").textContent, "2 / 70");
  assert.equal(get("progress-percent").textContent, "3%");
});

test("corrupt or non-array stored data falls back to defaults", () => {
  for (const raw of ["{not json", "{}", "42", "null"]) {
    const { state } = run({ storage: memoryStorage(raw) });
    assert.equal(state.getCompleted().size, 12, `raw=${raw}`);
  }
});

test("unavailable localStorage does not break the page", () => {
  const throwing = {
    getItem() { throw new Error("SecurityError"); },
    setItem() { throw new Error("QuotaExceededError"); },
  };
  const { get } = run({ storage: throwing });
  assert.equal(get("completed-count").textContent, "12 / 70");
  const toggle = { closest: () => ({ dataset: { toggle: "13" } }) };
  get("timeline").listeners.click({ target: toggle });
  assert.equal(get("completed-count").textContent, "13 / 70");
});

test("toggling a card persists progress", () => {
  const storage = memoryStorage(JSON.stringify([1]));
  const { get } = run({ storage });
  get("timeline").listeners.click({ target: { closest: () => ({ dataset: { toggle: "2" } }) } });
  assert.equal(storage.getItem("devotionBibleSchedule:v2:completed"), "[1,2]");
  get("timeline").listeners.click({ target: { closest: () => ({ dataset: { toggle: "1" } }) } });
  assert.equal(storage.getItem("devotionBibleSchedule:v2:completed"), "[2]");
});

test("reset asks for confirmation before discarding progress", () => {
  const storage = memoryStorage(JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]));
  const cancelled = run({ storage, confirmResult: false });
  cancelled.get("reset-button").listeners.click();
  assert.equal(cancelled.get("completed-count").textContent, "15 / 70");

  const confirmed = run({ storage, confirmResult: true });
  confirmed.get("reset-button").listeners.click();
  assert.equal(confirmed.get("completed-count").textContent, "12 / 70");
});

test("today's reading is featured when it is not complete", () => {
  const { get } = run({ storage: memoryStorage(JSON.stringify([1])), today: "2026-05-01T09:00:00" });
  assert.equal(get("summary-kicker").textContent, "今日の箇所");
  assert.equal(get("today-button").dataset.target, "day-6");
  assert.equal(get("next-button").dataset.target, "day-2");
});

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
