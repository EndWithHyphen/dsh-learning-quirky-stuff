import assert from 'node:assert/strict';

const button = (page, name) => page.getByRole('button', { name, exact: typeof name === 'string' });
async function openQuoteForm(page) {
  await button(page, '学习控件').click();
  await button(page, /^金句记录/).click();
  return page.getByRole('dialog', { name: '金句记录' });
}
async function placeQuote(page) {
  await button(page, '选择摆放区域').click();
  const area = page.getByRole('application', { name: '选择学习控件摆放区域' });
  await area.click({ position: { x: 180, y: 140 } });
  await area.waitFor({ state: 'hidden' });
}
async function startPractice(page) {
  await button(page, '学习控件').click();
  await button(page, /^背诵摘录/).click();
  return page.getByRole('dialog', { name: '背诵摘录' });
}

export async function checkQuotePractice(panel, dsh, noteTitle, selectedText) {
  const passage = '  「慢一点，读准每个字。」\n\n\t' + 'Keep  the spaces. '.repeat(8) + '\n';
  await panel.evaluate(() => {
    window.__qaCanvas.updateScene({ appState: { selectedElementIds: { 'old-long-text': true } } });
  });
  const form = await openQuoteForm(panel);
  const input = form.getByLabel(/^原文/);
  assert.equal(await input.inputValue(), selectedText);
  await input.fill('  ');
  await button(form, '选择摆放区域').click();
  await form.getByRole('alert').filter({ hasText: '请填写原文' }).waitFor();
  await input.fill(passage);
  await form.getByLabel(/出处/).fill('读书札记');
  const savedQuote = panel.waitForResponse(
    (response) =>
      response.url().endsWith('/note/canvas/save') &&
      response.request().method() === 'POST' &&
      response
        .request()
        .postDataJSON()
        .scene.elements.some((element) => element.customData?.studyboard?.values?.text === passage),
  );
  await placeQuote(panel);
  await button(panel, '保存').first().click();
  assert.ok((await savedQuote).ok());
  await panel.locator('.canvas-status [role="status"]').filter({ hasText: '笔记已保存到 DSH' }).waitFor();
  await panel.reload();
  await panel.waitForFunction(() => window.__qaCanvas);
  const one = await startPractice(panel);
  assert.equal(await one.locator('blockquote').count(), 0);
  await button(one, '显示原文').click();
  assert.equal(await one.locator('blockquote').textContent(), passage);
  await button(one, '遮住原文').click();
  assert.equal(await one.locator('blockquote').count(), 0);
  await button(one, '结束背诵').click();

  await dsh.reload();
  await dsh.getByRole('heading', { name: noteTitle, exact: true }).click();
  const second = await openQuoteForm(dsh);
  await second.getByLabel(/^原文/).fill('第二条。');
  await placeQuote(dsh);
  await dsh.locator('.excalidraw').focus();
  await dsh.keyboard.press('Enter');
  await second.getByLabel(/^原文/).fill('第二条，校订。');
  await button(second, '更新并排版').click();
  const two = await startPractice(dsh);
  await two.getByText('第 2 条，共 2 条').waitFor();
  await button(two, '显示原文').click();
  assert.equal(await two.locator('blockquote').textContent(), '第二条，校订。');
  await button(two, '上一条').click();
  await two.getByText('读书札记', { exact: true }).waitFor();
  assert.equal(await two.locator('blockquote').count(), 0);
  await button(two, '显示原文').click();
  assert.equal(await two.locator('blockquote').textContent(), passage);
  await button(two, '下一条').click();
  assert.equal(await two.locator('blockquote').count(), 0);
  await dsh.keyboard.press('Escape');
  await two.waitFor({ state: 'hidden' });
  await button(dsh, '返回笔记').click();
  await button(dsh, /^今日复习/).click();
  const daily = dsh.locator('.sb-question-card');
  await daily.getByText('金句背诵', { exact: true }).waitFor();
  assert.equal(await daily.locator('.sb-answer').count(), 0);
  await button(daily, '显示原文').click();
  assert.equal(await daily.locator('.sb-answer .sb-readable-text').textContent(), passage);
  await button(daily, /^掌握/).click();
  await dsh.locator('.sb-upcoming').getByText('读书札记', { exact: true }).waitFor();
  assert.equal(await daily.locator('.sb-answer').count(), 0);
  await button(daily, '显示原文').click();
  assert.equal(await daily.locator('.sb-answer .sb-readable-text').textContent(), '第二条，校订。');
  await button(dsh, '回到画布摘录 ↗').click();
  await dsh.locator('.sb-board-title').getByText(noteTitle, { exact: true }).waitFor();
  await button(dsh, '返回笔记').click();
  await button(dsh, '浏览器快捷笔记').click();
}
