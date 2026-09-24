// Enter operations through the shipped title UI; also accepts the older direct hangar.
async function enterOperationsHangar(page) {
  await page
    .locator(
      '[data-testid="title-takeoff-landing"], [data-testid="hangar-pick-prop"]',
    )
    .first()
    .waitFor({ state: "visible", timeout: 60000 });
  const title = page.getByTestId("title-takeoff-landing");
  if (await title.isVisible()) await title.click();
}
module.exports = { enterOperationsHangar };
