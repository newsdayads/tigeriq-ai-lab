import { test, expect } from '@playwright/test';

test.describe('Command Center UI & Web Control Suite', () => {
  test('loading and task pipeline display', async ({ page }) => {
    await page.route('**/api/company-progress', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          activeWork: { active: true, number: 101, title: 'Test Task Pipeline', status: 'IN_PROGRESS', priority: 'P0', currentStep: 'Verify pipeline', nextStep: 'Complete tests' },
          priorityIssues: [
            { number: 101, title: 'Fix P0 Bug', priority: 'P0', status: 'OPEN', open: true, updatedAt: new Date().toISOString() },
            { number: 102, title: 'Enhance UI', priority: 'P1', status: 'DONE', open: false, updatedAt: new Date().toISOString() }
          ],
          employees: [{ employeeId: 'NV01', label: 'Minh', command: 1, active: true }],
          employeeSummary: { total: 1, active: 1, paused: 0 },
          systems: [{ name: 'PC01', state: 'ONLINE', detail: 'Operational' }],
          activity: [{ name: 'Task started', at: new Date().toISOString(), status: 'RECORDED' }],
          source: { centralIssue: 280, registryIssue: 335 }
        })
      });
    });

    await page.goto('/command-center.html');
    await expect(page.locator('#workTitle')).toContainText('Test Task Pipeline');
    await expect(page.locator('.priority')).toHaveCount(2);
  });

  test('filter operation works correctly', async ({ page }) => {
    await page.route('**/api/company-progress', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          activeWork: { active: false, title: 'No active work' },
          priorityIssues: [
            { number: 201, title: 'Urgent P0 Item', priority: 'P0', status: 'OPEN', open: true },
            { number: 202, title: 'Completed P1 Item', priority: 'P1', status: 'DONE', open: false }
          ],
          employees: [],
          systems: [],
          activity: []
        })
      });
    });

    await page.goto('/command-center.html');
    await expect(page.locator('.priority')).toHaveCount(2);

    // Click filter P0
    await page.click('button.filter-btn[data-filter="P0"]');
    await expect(page.locator('.priority')).toHaveCount(1);
    await expect(page.locator('.priority')).toContainText('Urgent P0 Item');

    // Click filter done
    await page.click('button.filter-btn[data-filter="done"]');
    await expect(page.locator('.priority')).toHaveCount(1);
    await expect(page.locator('.priority')).toContainText('Completed P1 Item');
  });

  test('responsive rendering across specified viewports', async ({ page }) => {
    const viewports = [
      { width: 1280, height: 800 },
      { width: 768, height: 1024 },
      { width: 375, height: 667 }
    ];

    await page.route('**/api/company-progress', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          activeWork: { active: true, number: 300, title: 'Responsive Task', priority: 'P0' },
          priorityIssues: [{ number: 300, title: 'Responsive Task', priority: 'P0', status: 'OPEN', open: true }],
          employees: [],
          systems: [],
          activity: []
        })
      });
    });

    for (const vp of viewports) {
      await page.setViewportSize(vp);
      await page.goto('/command-center.html');
      await expect(page.locator('.shell')).toBeVisible();
    }
  });
});
