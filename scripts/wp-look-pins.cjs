// World Pass D (LOOK) round 3: console pins for a capture run, as a preload.
//   WP_PINS='{"__flyWorldLookOverride":{"enabled":true,"walls":false}}' \
//     node -r ./scripts/wp-look-pins.cjs scripts/look-pass-capture.cjs --flags=... ...
// Every page the capture tool opens gets the pins in an init script that runs
// before its own (a pin set before boot wins over the URL, fly-pins.js), so a
// sub-switch of a World Pass block can be ablated for one page load without
// editing a constants file. The capture tool itself is not changed.
const pins = JSON.parse(process.env.WP_PINS || '{}');
const pw = require('playwright');
const launch = pw.chromium.launch.bind(pw.chromium);
pw.chromium.launch = async (...a) => {
  const browser = await launch(...a);
  const newPage = browser.newPage.bind(browser);
  browser.newPage = async (...b) => {
    const page = await newPage(...b);
    await page.addInitScript((p) => {
      for (const [k, v] of Object.entries(p)) window[k] = v;
    }, pins);
    return page;
  };
  return browser;
};
