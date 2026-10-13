/**
 * GATE TO GATE (W0.8) — the hangar departure helpers for browser harnesses.
 *
 * The ops hangar is changing shape. Today it has a native
 * `<select id="departure-airport">` (authored airports plus the one picked
 * catalog runway) beside the "Find an airport or runway" search, and start
 * radios `input[name="departure-mode"]` inside `fieldset.ops-start-options`.
 * OPS_HANGAR (W3 L) replaces the select with a chooser:
 *
 *   [data-testid="hangar-airport-search"]          the search input
 *   [data-testid="hangar-airport-row-<ident>"]     one row per airport
 *   [data-testid="hangar-runway-<id>"]             a runway inside the row
 *   [data-testid="hangar-departure"][data-airport-id]  the selected departure
 *
 * and keeps the start radios (values gate | runway | approach; 'apron' stays
 * an accepted alias of 'gate' at the authored airports).
 *
 * Every helper here detects which UI is mounted and drives it, so a harness
 * written against these names passes on both trees. Nothing here pins or
 * un-pins anything.
 *
 * USAGE
 *   const { pickDeparture, departureId, pickStart } = require('./_hangar-pick');
 *   await pickDeparture(page, 'KOSU');            // authored airport
 *   await pickDeparture(page, 'LOWI:08-26');      // catalog runway (searched)
 *   await pickDeparture(page, 'LOWI');            // catalog ident (first runway listed)
 *   const id = await departureId(page);           // 'KOSU' | 'LOWI:08-26' | null
 *   await pickStart(page, 'runway');              // the start radio
 */

const LEGACY_SELECT = '#departure-airport';
const LEGACY_SEARCH = '#airport-search';
const CHOOSER_SEARCH = '[data-testid="hangar-airport-search"]';
const CHOOSER_SELECTED = '[data-testid="hangar-departure"]';
const ANY_PICKER = `${LEGACY_SELECT}, ${CHOOSER_SEARCH}, ${CHOOSER_SELECTED}`;
// undefined = Playwright's own default (page.setDefaultTimeout), exactly what the
// raw page.selectOption / locator calls these helpers replace used.
const DEFAULT_TIMEOUT = undefined;

const tid = (id) => `[data-testid="${id}"]`;
const identOf = (id) => String(id).split(':')[0];
// 'LOWI:08-26' -> '08-26' (the catalog id's runway part); authored ids have none.
const runwayPartOf = (id) => (String(id).includes(':') ? String(id).split(':')[1] : null);

/** In-page: the departure the hangar shows right now, from whichever UI is mounted. */
function readDepartureInPage() {
  const select = document.querySelector('#departure-airport');
  if (select) return select.value || null;
  const chip = document.querySelector('[data-testid="hangar-departure"]');
  return chip ? chip.getAttribute('data-airport-id') || null : null;
}

/** In-page: does `value` satisfy `want` ('KOSU' exact, 'LOWI' / 'LOWI:' any LOWI runway)? */
function departureMatchesInPage(want) {
  const select = document.querySelector('#departure-airport');
  const chip = document.querySelector('[data-testid="hangar-departure"]');
  const v = select ? select.value : chip ? chip.getAttribute('data-airport-id') : null;
  if (!v) return false;
  if (v === want) return true;
  // A full runway id must match exactly; an ident or 'IDENT:' accepts any runway of it.
  if (want.includes(':') && !want.endsWith(':')) return false;
  return v.startsWith(want.replace(/:$/, '') + ':');
}

/** Which hangar departure UI is mounted now: 'select' | 'chooser' | null (no wait). */
async function departureUi(page) {
  if ((await page.locator(LEGACY_SELECT).count()) > 0) return 'select';
  if ((await page.locator(`${CHOOSER_SEARCH}, ${CHOOSER_SELECTED}`).count()) > 0) return 'chooser';
  return null;
}

/** True when the ops departure picker (either UI) is in the DOM right now. No wait. */
async function hasDeparturePicker(page) {
  return (await departureUi(page)) != null;
}

/** Wait (up to `timeout`) for either departure UI; returns 'select' | 'chooser'. Throws on timeout. */
async function waitDepartureUi(page, timeout = DEFAULT_TIMEOUT) {
  await page.waitForSelector(ANY_PICKER, { state: 'attached', timeout });
  return (await departureUi(page)) || 'chooser';
}

/**
 * The departure the hangar has selected: the select's value (today) or the
 * chooser chip's data-airport-id (OPS_HANGAR). Waits up to `timeout` for a
 * picker to mount, like Playwright's own locator.inputValue(); returns null
 * when there is none (Free Flight has no departure).
 */
async function departureId(page, { timeout = DEFAULT_TIMEOUT } = {}) {
  try {
    await page.waitForSelector(ANY_PICKER, { state: 'attached', timeout });
  } catch {
    return null;
  }
  return page.evaluate(readDepartureInPage);
}

/**
 * Wait until the hangar's departure matches `want`: an exact id ('KOSU',
 * 'LOWI:08-26') or a bare ident / 'IDENT:' prefix (any runway of it).
 */
async function waitForDeparture(page, want, { timeout = DEFAULT_TIMEOUT } = {}) {
  await page.waitForFunction(departureMatchesInPage, String(want), { timeout, polling: 100 });
  return page.evaluate(readDepartureInPage);
}

async function clickOrDom(page, selector, { timeout, domFallback }) {
  const loc = page.locator(selector).first();
  try {
    await loc.click({ timeout });
    return false;
  } catch (e) {
    if (!domFallback) throw e;
    // The starved-main-thread fallback (verify-r25-smoke's press idiom): one
    // plain DOM click; the caller asserts the EFFECT.
    const ok = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el || el.disabled) return false;
      el.click();
      return true;
    }, selector);
    if (!ok) throw e;
    return true;
  }
}

/** Search the legacy "Find an airport or runway" picker and click the row for `id`. */
async function pickCatalogLegacy(page, id, { timeout, domFallback }) {
  const ident = identOf(id);
  const runway = runwayPartOf(id);
  await page.locator(LEGACY_SEARCH).fill(ident, { timeout });
  // Rows render "<name>" + "<small>IDENT · 08/26</small>" (AirportPicker.jsx).
  const rowText = runway ? `${ident} · ${runway.replace('-', '/')}` : `${ident} · `;
  const row = page.locator('section[aria-label="Worldwide airports"] button', { hasText: rowText }).first();
  await row.waitFor({ state: 'visible', timeout });
  let forced = false;
  try {
    await row.click({ timeout });
  } catch (e) {
    if (!domFallback) throw e;
    forced = true;
    await row.evaluate((el) => el.click());
  }
  await waitForDeparture(page, runway ? id : ident, { timeout });
  return forced;
}

/** Drive the OPS_HANGAR chooser: search -> airport row -> runway (when the id names one). */
async function pickChooser(page, id, { timeout, domFallback }) {
  const ident = identOf(id);
  const runway = runwayPartOf(id);
  let forced = false;
  const search = page.locator(CHOOSER_SEARCH);
  if ((await search.count()) > 0) await search.first().fill(ident, { timeout });
  const rowSel = tid(`hangar-airport-row-${ident}`);
  await page.waitForSelector(rowSel, { state: 'attached', timeout });
  forced = (await clickOrDom(page, rowSel, { timeout, domFallback })) || forced;
  if (runway) {
    // The runway control may be keyed by the full catalog id or its runway part.
    const candidates = [tid(`hangar-runway-${id}`), tid(`hangar-runway-${runway}`)];
    await page.waitForSelector(candidates.join(', '), { state: 'attached', timeout });
    const sel = (await page.locator(candidates[0]).count()) > 0 ? candidates[0] : candidates[1];
    forced = (await clickOrDom(page, sel, { timeout, domFallback })) || forced;
  }
  await waitForDeparture(page, runway ? id : ident, { timeout });
  return forced;
}

/**
 * Choose the departure airport in the ops hangar, whichever UI is mounted.
 *
 * `id` is an authored airport ('KOSU' | 'KCMH' | 'KLCK'), a catalog runway id
 * ('LOWI:08-26') or a catalog ident ('LOWI': the first runway the search
 * lists for it). Options: `timeout` (ms, default the page's), and `domFallback`
 * (on a timed-out press, set the value / click through the DOM once — the
 * verify-r25-smoke starved-main-thread idiom; `forced` reports it ran).
 *
 * Returns { ui: 'select'|'chooser', id: <selected departure>, forced }.
 */
async function pickDeparture(page, id, { timeout = DEFAULT_TIMEOUT, domFallback = false } = {}) {
  if (!id) throw new Error('_hangar-pick.pickDeparture: an airport id is required');
  const ui = await waitDepartureUi(page, timeout);
  let forced = false;
  if (ui === 'select') {
    const offered = await page.evaluate(
      ([sel, want]) => [...(document.querySelector(sel)?.options || [])].some((o) => o.value === want),
      [LEGACY_SELECT, String(id)]
    );
    if (offered) {
      try {
        await page.selectOption(LEGACY_SELECT, String(id), { timeout });
      } catch (e) {
        if (!domFallback) throw e;
        forced = true;
        // Set the value through the native setter and fire the change React listens for.
        await page.evaluate(
          ([sel, want]) => {
            const el = document.querySelector(sel);
            if (!el || el.value === want) return;
            Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, want);
            el.dispatchEvent(new Event('change', { bubbles: true }));
          },
          [LEGACY_SELECT, String(id)]
        );
      }
    } else {
      // A catalog runway is not an <option> until it has been picked once:
      // go through the "Find an airport or runway" search, as a player does.
      forced = await pickCatalogLegacy(page, String(id), { timeout, domFallback });
    }
  } else {
    forced = await pickChooser(page, String(id), { timeout, domFallback });
  }
  return { ui, id: await page.evaluate(readDepartureInPage), forced };
}

/**
 * Choose the start mode radio ('gate' | 'apron' | 'runway' | 'approach').
 * Both hangar UIs keep `input[name="departure-mode"]`; 'apron' and 'gate' are
 * aliases of each other (OPS_HANGAR renames apron to gate at the authored
 * airports), so whichever the mounted UI offers is used.
 *
 * Options: `how` 'click' (default) | 'check' | 'tap', `force` (passed to the
 * press), `timeout`, and `optional` (return false instead of throwing when the
 * radio is absent — e.g. a catalog runway has no apron start).
 * Returns the value pressed, or false when optional and absent.
 */
async function pickStart(page, mode, { how = 'click', force = false, timeout = DEFAULT_TIMEOUT, optional = false } = {}) {
  const aliases = mode === 'apron' ? ['apron', 'gate'] : mode === 'gate' ? ['gate', 'apron'] : [mode];
  const radio = (v) => page.locator(`input[name="departure-mode"][value="${v}"]`);
  let value = null;
  if (optional) {
    for (const v of aliases) if ((await radio(v).count()) > 0) { value = v; break; }
    if (!value) return false;
  } else {
    await page.waitForSelector(aliases.map((v) => `input[name="departure-mode"][value="${v}"]`).join(', '), { state: 'attached', timeout });
    for (const v of aliases) if ((await radio(v).count()) > 0) { value = v; break; }
  }
  const loc = radio(value).first();
  if (how === 'check') await loc.check({ force, timeout });
  else if (how === 'tap') await loc.tap({ force, timeout });
  else await loc.click({ force, timeout });
  return value;
}

module.exports = {
  pickDeparture,
  departureId,
  pickStart,
  waitForDeparture,
  hasDeparturePicker,
  departureUi,
  HANGAR_PICK_SELECTORS: { LEGACY_SELECT, LEGACY_SEARCH, CHOOSER_SEARCH, CHOOSER_SELECTED },
};
