const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests/ui', workers: 1, fullyParallel: false, timeout: 30000,
  expect: { timeout: 7000 }, reporter: 'list', use: { trace: 'retain-on-failure' }
});
