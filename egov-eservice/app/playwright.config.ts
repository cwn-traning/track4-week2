import { defineConfig } from '@playwright/test';

// ต้อง workers=1: ทุก TC เริ่มด้วย POST /api/test/reset (สถานะร่วมกันทั้งเซิร์ฟเวอร์)
// REPORT=1  → เขียนหลักฐานลง ../test-report/ (results.json + index.html) และอัดวิดีโอทุก TC (ไว้แปลงเป็น GIF)
const REPORT_DIR = '../test-report';
const isReport = process.env.REPORT === '1';

export default defineConfig({
  testDir: './tests/e2e',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  outputDir: isReport ? `${REPORT_DIR}/.artifacts` : 'test-results',
  reporter: isReport
    ? [['list'], ['json', { outputFile: `${REPORT_DIR}/results.json` }], ['html', { outputFolder: `${REPORT_DIR}/html`, open: 'never' }]]
    : [['list']],
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:3000',
    video: isReport ? { mode: 'on', size: { width: 800, height: 600 } } : 'off',
  },
});
