// Shared helpers for UI-beat shots (loop mode + page screenshots).
// Hides DOM that must not appear in marketing frames: the hard-coded Esri /
// adsb.lol attribution (wrong for this capture's data) and control hints.
exports.hideChrome = async (page) => {
  await page.evaluate(() => {
    const kill = (pred) => { for (const el of document.querySelectorAll('div,p,span')) { if (pred(el)) { el.style.setProperty('visibility', 'hidden', 'important'); } } };
    kill((el) => el.children.length < 12 && /© Esri|Flight data ©|Steer with the mouse|M Atlas · L Logbook/.test(el.textContent || '') && el.getBoundingClientRect().height < 80);
    const st = document.createElement('style');
    st.textContent = '[data-testid="contracts-panel"],[data-testid="contracts-chip"],[data-testid="juice-hud"],[data-testid="hud-quality-tier"]{visibility:hidden!important}';
    document.head.appendChild(st);
  });
};
