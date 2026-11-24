import assert from 'node:assert/strict';
export const testArticleUrl = 'https://example.test/page-study';
export const testTemplatePrompt = '给课堂复述写一份提纲，每个要点配上材料中的依据。';
export const testCommonPrompt = '每个术语首次出现时补上英文名称。';
export const canvasTemplatePrompt = '先写出本次的假设，再按观察结果整理证据。';

export async function checkCanvasTemplate(dsh, store) {
  const board = await store.create({ title: '模板测试笔记', source: { url: testArticleUrl } });
  await store.dispatch({
    action: 'saveWebNotes',
    id: board.id,
    url: testArticleUrl,
    baseVersion: 0,
    text: '先回忆，再核对资料。',
  });
  const page = await dsh.context().newPage();
  try {
    await page.goto(dsh.url());
    await page.getByRole('heading', { name: board.title, exact: true }).click();
    await page.getByRole('button', { name: /^AI\s*总结$/ }).click();
    const picker = page.getByRole('combobox', { name: '总结模板', exact: true });
    assert.equal(await picker.inputValue(), 'default');
    await page.getByRole('button', { name: '管理模板', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '管理总结模板' });
    assert.match(await dialog.getByLabel('模板提示词').inputValue(), /先形成整体理解/);
    await dialog.getByRole('button', { name: '新建模板', exact: true }).click();
    await dialog.getByLabel('模板名称').fill('实验讲义');
    await dialog.getByLabel('模板提示词').fill(canvasTemplatePrompt);
    await dialog.getByRole('button', { name: '保存模板', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    await page.getByLabel('学习目标').fill('关注实验的条件。');
    await page.getByRole('button', { name: '生成AI总结', exact: true }).click();
    await page
      .locator('.sb-study-title')
      .getByText(/实验讲义/)
      .waitFor();
    const saved = (await store.read(board.id)).summaries[0];
    assert.equal(saved.template.prompt, canvasTemplatePrompt);
    assert.equal(saved.template.common.prompt, testCommonPrompt);
  } finally {
    await page.close();
  }
}

export async function checkPageStudy(panel, article, dsh, learning) {
  await panel.getByRole('button', { name: '总结当前网页' }).click();
  const study = panel.getByRole('region', { name: '网页学习总结' });
  await study.getByText('记忆提示 · 合上回忆，打开核对').waitFor();
  const question = study.locator('details').filter({ hasText: '回忆之后怎样发现遗漏？' });
  assert.equal(await question.getByText('对照原文核对遗漏。').isVisible(), false);
  await question.locator('summary').click();
  await question.getByText('对照原文核对遗漏。').waitFor();
  await question.getByRole('button', { name: /查看来源/ }).click();
  await article.waitForFunction(() =>
    [...document.querySelectorAll('p')].some((p) => p.style.outline.includes('solid')),
  );
  await study.getByRole('button', { name: '将自测题加入今日复习' }).click();
  await study.getByRole('status').filter({ hasText: '1 道自测题已加入今日复习。' }).waitFor();
  const dashboard = await learning.dashboard();
  const enrolled = dashboard.cards.filter((c) => c.question === '回忆之后怎样发现遗漏？');
  assert.equal(enrolled.length, 1);
  await panel.reload();
  await panel.getByRole('tab', { name: '材料预览' }).click();
  await study.getByText('记忆提示 · 合上回忆，打开核对').waitFor();
  await panel.getByText('手动导入正文或字幕', { exact: true }).click();
  await panel
    .getByRole('textbox', { name: '粘贴正文或字幕' })
    .fill('先尝试回忆，再核对资料。\n\n这是手动选取的原文。');
  await panel.getByRole('button', { name: '总结粘贴内容' }).click();
  await study.getByText('本次总结仅覆盖已读取的部分正文或字幕。').waitFor();
  await dsh.getByRole('button', { name: /材料预览/ }).click();
  await dsh.getByLabel('已导入材料').selectOption(enrolled[0].sourceRefs[0].materialId);
  const saved = dsh.getByRole('region', { name: '网页学习总结' });
  await saved.getByText('记忆提示 · 合上回忆，打开核对').waitFor();
  await saved.getByRole('button', { name: '将自测题加入今日复习' }).click();
  await saved.getByRole('status').waitFor();
  assert.equal(
    (await learning.dashboard()).cards.filter((c) => c.question === '回忆之后怎样发现遗漏？').length,
    1,
  );
  await dsh.getByRole('textbox', { name: '材料网址' }).fill(testArticleUrl);
  await dsh.getByRole('button', { name: '总结网页', exact: true }).click();
  await dsh.getByRole('heading', { name: '通过网址读取的文章', exact: true }).waitFor();
  await saved.getByText('记忆提示 · 合上回忆，打开核对').waitFor();
  assert.equal(await dsh.getByRole('link', { name: '打开原网页 ↗' }).getAttribute('href'), testArticleUrl);
  const picker = dsh.getByRole('combobox', { name: '总结模板', exact: true });
  assert.equal(await picker.inputValue(), 'default');
  await dsh.getByRole('button', { name: '管理模板', exact: true }).click();
  const manager = dsh.getByRole('dialog', { name: '管理总结模板' });
  assert.match(await manager.getByLabel('模板提示词').inputValue(), /overview/);
  await manager.getByRole('button', { name: '复制为新模板' }).click();
  await manager.getByLabel('模板名称').fill('课堂提纲');
  await manager.getByLabel('模板提示词').fill(testTemplatePrompt);
  await manager.getByRole('button', { name: '保存模板' }).click();
  await manager.waitFor({ state: 'hidden' });
  const customId = await picker.inputValue();
  assert.notEqual(customId, 'default');
  await dsh.getByRole('button', { name: '生成学习总结', exact: true }).click();
  await saved.getByText('总结模板 · 课堂提纲', { exact: true }).waitFor();
  const history = dsh.getByRole('combobox', { name: '已生成的网页总结', exact: true });
  await history.selectOption(await history.getByRole('option', { name: /默认模板/ }).getAttribute('value'));
  await saved.getByText('总结模板 · 默认模板', { exact: true }).waitFor();

  await panel.reload();
  const chromePicker = panel.getByRole('combobox', { name: '总结模板', exact: true });
  await chromePicker.selectOption(customId);
  await panel.getByRole('button', { name: '总结当前网页', exact: true }).click();
  await study.getByText('总结模板 · 课堂提纲', { exact: true }).waitFor();
  const chromeHistory = panel.getByRole('combobox', { name: '已生成的网页总结', exact: true });
  await chromeHistory.selectOption(
    await chromeHistory.getByRole('option', { name: /默认模板/ }).getAttribute('value'),
  );
  await study.getByText('总结模板 · 默认模板', { exact: true }).waitFor();
  await panel.reload();
  await panel.getByRole('tab', { name: '材料预览' }).click();
  await study.getByText('总结模板 · 默认模板', { exact: true }).waitFor();

  await dsh.getByRole('button', { name: '管理模板', exact: true }).click();
  await manager.getByRole('button', { name: '编辑模板' }).click();
  await manager.getByLabel('模板提示词').fill('用原文中的例子准备口头讲解。');
  await manager.getByRole('button', { name: '保存模板' }).click();
  await manager.waitFor({ state: 'hidden' });
  await dsh.getByRole('button', { name: '生成学习总结', exact: true }).click();
  await saved.getByText('总结模板 · 课堂提纲 · v2', { exact: true }).waitFor();
  await dsh.getByRole('button', { name: '管理模板', exact: true }).click();
  await manager.getByRole('button', { name: '编辑共用提示词' }).click();
  await manager.getByLabel('共用提示词', { exact: true }).fill(testCommonPrompt);
  await manager.getByRole('button', { name: '保存共用提示词' }).click();
  await manager.waitFor({ state: 'hidden' });
  await dsh.getByRole('button', { name: '生成学习总结', exact: true }).click();
  await saved.getByText('总结模板 · 课堂提纲 · v2 · 共用提示词 v1', { exact: true }).waitFor();
  await dsh.getByRole('button', { name: '管理模板', exact: true }).click();
  await manager.getByRole('button', { name: '删除模板' }).click();
  await manager.getByRole('button', { name: '确认删除' }).click();
  await manager.waitFor({ state: 'hidden' });
  assert.equal(await picker.inputValue(), 'default');
  await saved.getByText('总结模板 · 课堂提纲 · v2 · 共用提示词 v1', { exact: true }).waitFor();
  await panel.reload();
  await chromePicker.selectOption('recall');
  await panel.getByRole('button', { name: '总结当前网页', exact: true }).click();
  await study.getByText('总结模板 · 速记复习 · 共用提示词 v1', { exact: true }).waitFor();
  await dsh.getByRole('button', { name: '浏览器快捷笔记', exact: true }).click();
}
