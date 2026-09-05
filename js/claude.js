// In-app Claude coach — calls the Claude API (claude-opus-5) straight from
// the phone with the user's own API key. Raw fetch rather than the official
// SDK on purpose: this app is dependency-free with no build step, and the
// Messages API supports direct browser calls via the explicit opt-in header
// below. The key lives ONLY in this device's localStorage (store.js) — never
// in the repo, never in an export.
//
// Every request sends the same JSON the "Export for analysis" button
// produces, so in-app answers and Claude Code sessions reason from the
// identical picture.

import { buildAnalysisPayload } from './backup.js';
import { getClaudeKey } from './store.js';

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-opus-5';

// The coaching brain, distilled from docs/fitness-principles.md and the
// owner profile. Keep it STABLE: it is the cached prefix (see cache_control
// below), so byte churn here costs money.
const SYSTEM = `You are the training and nutrition coach inside Joshua's personal fitness tracker.

Who he is: recreational lifter, male, mid-20s, ~5'9", on a lean bulk. Trains PPL (push/pull/legs) with weight days and volume days, everything at 8-15 reps. Main strength lifts: flat dumbbell press, lat pulldown, machine leg press. Low-friction logging is his core value; he wants specific, honest, proactive coaching.

The data: the user message contains a JSON export of his log - the sprint (dates and weight goal), daily entries (calories kcal, protein g, weight lb, cardio, 10k-steps and sleep-7h checkboxes), day notes, the full workout log (lifts as weight x reps x sets, optional rir = reps in reserve on the LAST working set, locked is UI state to ignore), and precomputed stats (target streaks and adherence, weight trend rate, per-lift e1RM bests and trends via Epley, weekly volume, session-average RIR). Trust the precomputed stats; recompute only when something looks off.

How to coach:
- Be specific: use HIS numbers, dates, and trends. Never give generic advice a pamphlet could.
- Judge weight by the trend (weekly averages, lb/week), never single weigh-ins - daily noise is 1-2% of bodyweight. A lean bulk should gain roughly 0.1-0.3% bodyweight per week; faster skews increasingly to fat.
- Implied maintenance = average intake minus 500 kcal/day per lb/week of gain. Use it to sanity-check calorie advice.
- Protein floor is 120 g/day, every day - it is his most-missed target and weekends are the usual failure.
- e1RM is noisy (5-10% per session) and inflated above ~10 reps. Judge strength on 4-8 week trends; prefer 8-10 rep sessions as the truer 1RM signal.
- Hard sets end 0-4 reps from failure. Flat e1RM at RIR 1-2 is a real plateau; flat at RIR 3-4 is sandbagging. Stall fixes in order: check eating and sleep, add a set, change the rep range, deload a week at half volume.
- Short sleep measurably costs muscle and fat-loss quality - call out unchecked sleep days when performance dips.
- Maintenance day type = deliberate easy session; never count it as a strength drop.
- Say what is going WELL in one line; spend the words on the one or two changes that would most improve his results.

Format: plain text only - no markdown symbols (no #, *, or backticks). Short paragraphs and simple dashes for lists. Lead with the direct answer or verdict. Keep it under ~350 words unless he asks you to go deeper.`;

// The last exchange survives tab switches (module state, deliberately not
// persisted — an analysis is a snapshot of the moment, not a record).
export let lastAsk = null;

export function hasClaudeKey() {
  return getClaudeKey().length > 0;
}

export async function askClaude(question) {
  const payload = JSON.stringify(buildAnalysisPayload());
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 180000);
  let res;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': getClaudeKey(),
        'anthropic-version': '2023-06-01',
        // required opt-in for calling the API from a browser
        'anthropic-dangerous-direct-browser-access': 'true',
        // refusal fallback (scalar form): on a policy decline the API re-runs
        // the request on a fallback model within the same call
        'anthropic-beta': 'server-side-fallback-2026-07-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 16000,
        fallbacks: 'default',
        system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
        messages: [{
          role: 'user',
          content: [
            // data first with a cache breakpoint, question last — follow-up
            // questions in the same sitting reuse the cached prefix at ~10%
            // of the input price
            { type: 'text', text: `My current data export:\n${payload}`, cache_control: { type: 'ephemeral' } },
            { type: 'text', text: question },
          ],
        }],
      }),
    });
  } catch (e) {
    clearTimeout(timer);
    throw new Error(e && e.name === 'AbortError' ? 'Timed out — try again.' : 'Could not reach Claude — are you offline?');
  }
  clearTimeout(timer);

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401) throw new Error('API key rejected — check it in Settings.');
    if (res.status === 429) throw new Error('Rate limited — wait a minute and try again.');
    throw new Error(body && body.error && body.error.message ? body.error.message : `Request failed (HTTP ${res.status}).`);
  }
  if (body.stop_reason === 'refusal') throw new Error('Claude declined this request.');

  const text = body.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  if (!text) throw new Error('Empty response — try again.');
  lastAsk = { question, text, when: Date.now(), usage: body.usage || null };
  return lastAsk;
}
