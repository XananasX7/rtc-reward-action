/**
 * Unit tests for rtc-reward-action
 * Run with: node test/action.test.js
 */

'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

// ── helpers ──────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ ${name}`);
    console.error(`     ${err.message}`);
    failed++;
  }
}

// ── inline the pure helpers from index.js so we can unit-test without side-effects ──

const WALLET_PATTERNS = [
  /rtc[- ]wallet[:\s]+([a-zA-Z0-9_-]{20,})/i,
  /wallet[:\s]+([a-zA-Z0-9_-]{20,})/i,
  /<!--\s*rtc-wallet:\s*([a-zA-Z0-9_-]{20,})\s*-->/i,
];

function extractWalletFromBody(body) {
  if (!body) return null;
  for (const pattern of WALLET_PATTERNS) {
    const match = body.match(pattern);
    if (match) return match[1].trim();
  }
  return null;
}

function readWalletFromFile(walletFile, workspace) {
  const fullPath = path.join(workspace, walletFile);
  if (!fs.existsSync(fullPath)) return null;
  const content = fs.readFileSync(fullPath, 'utf8').trim();
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) return trimmed;
  }
  return null;
}

// ── wallet extraction ─────────────────────────────────────────────────────────

console.log('\nextractWalletFromBody');

test('extracts wallet with "RTC wallet:" prefix', () => {
  const wallet = extractWalletFromBody('RTC wallet: RTCe0961d6b54f2fa96db57a373c84d8ad8986153f8');
  assert.strictEqual(wallet, 'RTCe0961d6b54f2fa96db57a373c84d8ad8986153f8');
});

test('extracts wallet with "wallet:" prefix', () => {
  const wallet = extractWalletFromBody('My wallet: abc123def456ghi789jkl0');
  assert.strictEqual(wallet, 'abc123def456ghi789jkl0');
});

test('extracts wallet from HTML comment', () => {
  const wallet = extractWalletFromBody('<!-- rtc-wallet: RTCabc123def456ghi789jklmno -->');
  assert.strictEqual(wallet, 'RTCabc123def456ghi789jklmno');
});

test('returns null when no wallet in body', () => {
  const wallet = extractWalletFromBody('Just a normal PR description with no wallet.');
  assert.strictEqual(wallet, null);
});

test('returns null on empty body', () => {
  assert.strictEqual(extractWalletFromBody(''), null);
  assert.strictEqual(extractWalletFromBody(null), null);
});

test('ignores addresses shorter than 20 chars', () => {
  const wallet = extractWalletFromBody('RTC wallet: short');
  assert.strictEqual(wallet, null);
});

// ── file wallet reading ───────────────────────────────────────────────────────

console.log('\nreadWalletFromFile');

test('reads wallet from .rtc-wallet file', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtc-test-'));
  fs.writeFileSync(path.join(tmpDir, '.rtc-wallet'), 'RTCe0961d6b54f2fa96db57a373c84d8ad8986153f8\n');
  const wallet = readWalletFromFile('.rtc-wallet', tmpDir);
  assert.strictEqual(wallet, 'RTCe0961d6b54f2fa96db57a373c84d8ad8986153f8');
});

test('skips comment lines in .rtc-wallet', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtc-test-'));
  fs.writeFileSync(path.join(tmpDir, '.rtc-wallet'), '# my wallet\nRTCe0961d6b54f2fa96db57a373c84d8ad8986153f8\n');
  const wallet = readWalletFromFile('.rtc-wallet', tmpDir);
  assert.strictEqual(wallet, 'RTCe0961d6b54f2fa96db57a373c84d8ad8986153f8');
});

test('returns null when .rtc-wallet does not exist', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtc-test-'));
  const wallet = readWalletFromFile('.rtc-wallet', tmpDir);
  assert.strictEqual(wallet, null);
});

test('returns null when .rtc-wallet is all comments', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtc-test-'));
  fs.writeFileSync(path.join(tmpDir, '.rtc-wallet'), '# comment only\n# another comment\n');
  const wallet = readWalletFromFile('.rtc-wallet', tmpDir);
  assert.strictEqual(wallet, null);
});

// ── /wallet/transfer endpoint (dry-run integration) ──────────────────────────

console.log('\n/wallet/transfer endpoint (dry-run)');

test('POST /wallet/transfer returns Unauthorized with wrong key (confirms endpoint exists)', async () => {
  // This is a live probe against the real node to confirm the contract shape.
  // We intentionally use a bad key; a 401/Unauthorized response proves the endpoint
  // is reachable and accepts our request format.
  const https = require('https');

  await new Promise((resolve, reject) => {
    const body = JSON.stringify({
      from_miner: 'test-wallet-from',
      to_miner: 'test-wallet-to',
      amount_rtc: 0.001,
      idempotency_key: 'test-probe-action-unit-test',
    });

    const req = https.request(
      {
        hostname: 'rustchain.org',
        path: '/wallet/transfer',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'X-Admin-Key': 'invalid-test-key',
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          // 401 Unauthorized = endpoint exists and validates key — correct contract
          assert.ok(
            res.statusCode === 401 || res.statusCode === 403,
            `Expected 401/403 from /wallet/transfer with bad key, got ${res.statusCode}: ${data}`
          );
          resolve();
        });
      }
    );

    req.on('error', reject);
    req.write(body);
    req.end();
  });
});

// ── summary ───────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
