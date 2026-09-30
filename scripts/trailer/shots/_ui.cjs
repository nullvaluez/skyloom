// Shared helpers for UI-beat shots (loop mode + page screenshots).
// Hides DOM that must not appear in marketing frames: the hard-coded Esri /
// adsb.lol attribution (wrong for this capture's data) and control hints.
exports.hideChrome = async (page) => {
  await page.evaluate(() => {
    const kill = (pred) => { for (const el of document.querySelectorAll('div,p,span')) { if (pred(el)) { el.style.setProperty('visibility', 'hidden', 'important'); } } };
    kill((el) => /© Esri|Flight data ©|Steer with the mouse|M Atlas · L Logbook/.test(el.textContent || '') && el.getBoundingClientRect().height < 90 && el.getBoundingClientRect().top > innerHeight * 0.8);
    const st = document.createElement('style');
    st.textContent = 'div.absolute.bottom-2.left-2{visibility:hidden!important} [data-testid="contracts-panel"],[data-testid="contracts-chip"],[data-testid="juice-hud"],[data-testid="hud-quality-tier"]{visibility:hidden!important}';
    document.head.appendChild(st);
  });
};
