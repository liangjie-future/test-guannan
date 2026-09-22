import { test, expect } from '@playwright/test';
import { startServer } from '../../src/server.js';

let handle;

test.beforeAll(async () => {
  handle = await startServer({ host: '127.0.0.1', port: 0, dataDir: 'data/browser-tests' });
});

test.afterAll(async () => {
  await new Promise((resolve) => handle.server.close(resolve));
});

test.beforeEach(async ({ page }) => {
  await page.goto(`${handle.url}login`);
});

test('mouse click toggles visibility without submitting or changing the URL', async ({ page }) => {
  const password = page.locator('#login-password');
  const username = page.locator('#login-username');
  const toggle = page.locator('[aria-controls="login-password"]');
  const requests = [];
  page.on('request', (request) => requests.push(request));

  await username.fill('bob');
  await password.fill('secret');
  await toggle.click();

  await expect(password).toHaveAttribute('type', 'text');
  await expect(toggle).toHaveText('隐藏密码');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(username).toHaveValue('bob');
  await expect(password).toHaveValue('secret');
  await expect(toggle).toBeFocused();
  expect(page.url()).toBe(`${handle.url}login`);
  expect(requests.some((request) => request.method() === 'POST')).toBe(false);

  await toggle.click();
  await expect(password).toHaveAttribute('type', 'password');
  await expect(toggle).toHaveText('显示密码');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
});

test('Tab then Enter and Space toggle while retaining focus and not submitting', async ({ page }) => {
  const password = page.locator('#login-password');
  const toggle = page.locator('[aria-controls="login-password"]');
  const requests = [];
  page.on('request', (request) => requests.push(request));

  await page.locator('#login-username').focus();
  await page.keyboard.press('Tab');
  await expect(password).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(toggle).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(password).toHaveAttribute('type', 'text');
  await expect(toggle).toBeFocused();

  await page.keyboard.press('Space');
  await expect(password).toHaveAttribute('type', 'password');
  await expect(toggle).toBeFocused();
  expect(page.url()).toBe(`${handle.url}login`);
  expect(requests.some((request) => request.method() === 'POST')).toBe(false);
});

test('the submit control retains the normal POST login flow', async ({ page }) => {
  await page.locator('#login-username').fill('bob');
  await page.locator('#login-password').fill('right-password');

  const response = await Promise.all([
    page.waitForResponse((res) => res.request().method() === 'POST' && res.url().endsWith('/login')),
    page.locator('[data-testid="login-submit"]').click(),
  ]);

  expect(response[0].status()).toBe(302);
  await expect(page).toHaveURL(`${handle.url}timeline`);
});

test('a failed login reloads the hidden default without retaining input values', async ({ page }) => {
  await page.locator('#login-username').fill('bob');
  await page.locator('#login-password').fill('wrong-password');
  await page.locator('[aria-controls="login-password"]').click();
  await expect(page.locator('#login-password')).toHaveAttribute('type', 'text');

  await Promise.all([
    page.waitForResponse((res) => res.request().method() === 'POST' && res.url().endsWith('/login')),
    page.locator('[data-testid="login-submit"]').click(),
  ]);

  await expect(page).toHaveURL(`${handle.url}login`);
  await expect(page.locator('[data-testid="login-error"]')).toHaveText('用户名或密码错误');
  await expect(page.locator('#login-password')).toHaveAttribute('type', 'password');
  await expect(page.locator('[aria-controls="login-password"]')).toHaveText('显示密码');
  await expect(page.locator('[aria-controls="login-password"]')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#login-username')).toHaveValue('');
  await expect(page.locator('#login-password')).toHaveValue('');
});

test('without JavaScript the native password field and submit still work', async ({ browser }) => {
  const context = await browser.newContext({ javaScript: false });
  const page = await context.newPage();
  try {
    await page.goto(`${handle.url}login`);
    await expect(page.locator('#login-password')).toHaveAttribute('type', 'password');
    await expect(page.locator('[data-testid="login-submit"]')).toBeVisible();

    await page.locator('#login-username').fill('bob');
    await page.locator('#login-password').fill('wrong-password');
    await Promise.all([
      page.waitForResponse((res) => res.request().method() === 'POST' && res.url().endsWith('/login')),
      page.locator('[data-testid="login-submit"]').click(),
    ]);

    await expect(page).toHaveURL(`${handle.url}login`);
    await expect(page.locator('[data-testid="login-error"]')).toHaveText('用户名或密码错误');
    await expect(page.locator('#login-password')).toHaveAttribute('type', 'password');
  } finally {
    await context.close();
  }
});
