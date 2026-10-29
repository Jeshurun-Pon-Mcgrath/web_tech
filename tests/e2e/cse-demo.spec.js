import { test, expect } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import mongoose from 'mongoose';

test.use({ trace: 'off', screenshot: 'off' });
test.setTimeout(150000);

test('populated CSE tables, simple navigation and released student results', async ({
  page,
  browser,
}) => {
  // Only the isolated replica started by playwright.config.js; never the application database.
  process.env.NODE_ENV = 'test';
  process.env.EMAIL_ADAPTER = 'preview';
  process.env.LOG_LEVEL = 'silent';
  process.env.CSRF_SECRET = randomBytes(32).toString('hex');
  process.env.MONGODB_URI =
    'mongodb://127.0.0.1:27119/examledger_browser?replicaSet=examledger-e2e';
  const { seedCseFixtures, cseEmail } =
    await import('../../apps/api/src/modules/maintenance/cse-fixtures.js');
  const passwords = Array.from({ length: 20 }, () => randomBytes(18).toString('hex'));
  await mongoose.connect(process.env.MONGODB_URI);
  try {
    const seeded = await seedCseFixtures(passwords);
    expect(seeded.totals.submittedAttempts).toBe(20);
  } finally {
    await mongoose.disconnect();
  }
  await page.goto('/admin/login');
  await page.getByLabel('Email address').fill('admin@examledger.test');
  await page
    .getByLabel('Password', { exact: true })
    .fill(process.env.EXAMLEDGER_BROWSER_ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Sign in to admin portal' }).click();
  await expect(page).toHaveURL(/\/admin$/);
  const nav = page.getByRole('navigation', { name: 'Main navigation', exact: true });
  for (const name of ['Overview', 'Students', 'Subjects', 'Question bank', 'Exams', 'Results'])
    await expect(nav.getByRole('link', { name, exact: true })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Cohorts', exact: true })).toBeHidden();
  const more = nav.locator('.nav-more > summary');
  await more.focus();
  await page.keyboard.press('Enter');
  await expect(nav.getByRole('link', { name: 'Cohorts', exact: true })).toBeVisible();
  await nav.getByRole('link', { name: 'Cohorts', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/cohorts$/);
  await expect(nav.getByRole('link', { name: 'Cohorts', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  const counts = {
    students: 20,
    cohorts: 20,
    subjects: 20,
    questions: 60,
    exams: 20,
    attempts: 20,
    integrity: 20,
    assignments: 23,
  };
  for (const [route, count] of Object.entries(counts)) {
    const response = await page.request.get(`/api/v1/admin/${route}?pageSize=20`);
    expect(response.status()).toBe(200);
    const records = (await response.json()).data;
    expect(records.pagination.total).toBe(count);
    expect(records.items).toHaveLength(20);
    await page.goto(`/admin/${route}`);
    await expect(page.getByLabel('Search records', { exact: true })).toBeVisible();
    await expect(page.locator('.list-loading')).toHaveCount(0);
    await expect(page.locator('.page-content > .panel > .table-wrap tbody tr')).toHaveCount(20);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
  }
  await page.goto('/admin/questions');
  await page.getByLabel('Search records', { exact: true }).fill('binary search');
  await expect(page.locator('.page-content > .panel > .table-wrap tbody tr')).toHaveCount(2);
  await expect(page).toHaveURL(/search=binary/);
  await page.setViewportSize({ width: 375, height: 850 });
  await page.goto('/admin/attempts');
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await expect(nav.getByRole('link', { name: 'Attempts', exact: true })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Attempts', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await nav.getByRole('link', { name: 'Students', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/students$/);
  await expect(page.locator('.sidebar')).not.toHaveClass(/is-open/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );

  const context = await browser.newContext({
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 375, height: 850 },
  });
  try {
    const csrf = (await (await context.request.get('/api/v1/auth/csrf')).json()).data.token;
    const login = await context.request.post('/api/v1/auth/login', {
      headers: { 'x-csrf-token': csrf },
      data: { email: cseEmail(0), password: passwords[0], portal: 'student' },
    });
    expect(login.status()).toBe(200);
    const studentPage = await context.newPage();
    await studentPage.goto('/student');
    await expect(
      studentPage.getByText('[CSE DEMO] Machine Learning - Available practice', { exact: true }),
    ).toBeVisible();
    await studentPage.goto('/student/results');
    await expect(
      studentPage.getByRole('heading', { name: 'Released performance summary', exact: true }),
    ).toBeVisible();
    await expect(
      studentPage
        .getByText('[CSE DEMO] Data Structures - Completed practice', { exact: true })
        .first(),
    ).toBeVisible();
    expect(
      await studentPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    ).toBe(true);
  } finally {
    await context.close();
  }
});
