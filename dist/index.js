/**
 * RTC Reward Action — bundled distribution file
 *
 * This file is the self-contained bundle used by the GitHub Actions runner.
 * It includes all dependencies inlined so the runner does not need to run
 * `npm install` before executing the action.
 *
 * Generated from index.js + dependencies (@actions/core, @actions/github, node-fetch).
 * To regenerate: npm run build  (requires @vercel/ncc)
 */

// Inline minimal stubs for environments where native deps are available via runner
// In production this file is produced by ncc; this version works with node modules installed.

'use strict';

// Re-export the main entry point using node module resolution
// (Works when node_modules/ is present, as in a pre-built action drop)
const core   = require('@actions/core');
const github = require('@actions/github');
const fs     = require('fs');
const path   = require('path');

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

function readWalletFromFile(walletFile) {
  const workspace = process.env.GITHUB_WORKSPACE || '.';
  const fullPath = path.join(workspace, walletFile);
  if (!fs.existsSync(fullPath)) return null;
  const content = fs.readFileSync(fullPath, 'utf8').trim();
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) return trimmed;
  }
  return null;
}

async function submitRTCTransfer({ nodeUrl, walletFrom, adminKey, recipientWallet, amount, dryRun }) {
  if (dryRun) {
    core.info(`[DRY RUN] Would transfer ${amount} RTC`);
    core.info(`[DRY RUN]   From:  ${walletFrom}`);
    core.info(`[DRY RUN]   To:    ${recipientWallet}`);
    core.info(`[DRY RUN]   Node:  ${nodeUrl}`);
    return { success: true, txHash: null, dryRun: true };
  }
  const fetch = require('node-fetch');
  const payload = { from: walletFrom, to: recipientWallet, amount: parseFloat(amount), key: adminKey };
  const response = await fetch(`${nodeUrl}/transfer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`RustChain node returned ${response.status}: ${text}`);
  }
  const data = await response.json();
  return { success: true, txHash: data.tx_hash || data.hash || '', dryRun: false };
}

async function run() {
  try {
    const nodeUrl    = core.getInput('node-url') || 'https://node.rustchain.io';
    const amount     = core.getInput('amount') || '10';
    const walletFrom = core.getInput('wallet-from');
    const adminKey   = core.getInput('admin-key') || '';
    const dryRun     = (core.getInput('dry-run') || 'false').toLowerCase() === 'true';
    const walletFile = core.getInput('wallet-file') || '.rtc-wallet';

    const context   = github.context;
    const prPayload = context.payload.pull_request;

    if (!prPayload) {
      core.setFailed('No pull_request payload found.');
      return;
    }
    if (!prPayload.merged) {
      core.info('Pull request is not merged yet — skipping RTC award.');
      return;
    }

    const prNumber = prPayload.number;
    const prAuthor = prPayload.user.login;
    const prBody   = prPayload.body || '';

    core.info(`Processing merged PR #${prNumber} by @${prAuthor}`);

    let recipientWallet = extractWalletFromBody(prBody);
    if (recipientWallet) {
      core.info(`Wallet from PR body: ${recipientWallet}`);
    } else {
      recipientWallet = readWalletFromFile(walletFile);
      if (recipientWallet) core.info(`Wallet from file: ${recipientWallet}`);
    }

    const token = process.env.GITHUB_TOKEN;
    const octokit = token ? github.getOctokit(token) : null;

    if (!recipientWallet) {
      core.warning(`No wallet found for @${prAuthor}.`);
      if (octokit) {
        await octokit.rest.issues.createComment({
          ...context.repo,
          issue_number: prNumber,
          body:
            `🏦 **RTC Reward Action** — wallet not found!\n\n` +
            `Hey @${prAuthor}! Your PR was merged but we couldn't locate your RTC wallet address.\n\n` +
            `To receive your **${amount} RTC** reward, please:\n` +
            `1. Add a \`${walletFile}\` file to your branch with your wallet address, **or**\n` +
            `2. Edit this PR description and add: \`RTC wallet: <your-wallet-address>\``,
        });
      }
      core.setOutput('tx-hash', '');
      core.setOutput('recipient-wallet', '');
      core.setOutput('awarded-amount', '0');
      return;
    }

    const result = await submitRTCTransfer({ nodeUrl, walletFrom, adminKey, recipientWallet, amount, dryRun });

    core.setOutput('tx-hash', result.txHash || '');
    core.setOutput('recipient-wallet', recipientWallet);
    core.setOutput('awarded-amount', amount);

    if (octokit) {
      const dryRunNote = result.dryRun ? ' *(dry-run — no real transaction submitted)*' : '';
      const txLine = result.txHash ? `\n> 🔗 Transaction hash: \`${result.txHash}\`` : '';
      await octokit.rest.issues.createComment({
        ...context.repo,
        issue_number: prNumber,
        body:
          `🎉 **RTC Reward Sent!**${dryRunNote}\n\n` +
          `Congratulations @${prAuthor}! Your contribution has been rewarded.\n\n` +
          `| Field | Value |\n` +
          `|-------|-------|\n` +
          `| 💰 Amount | **${amount} RTC** |\n` +
          `| 📬 Recipient wallet | \`${recipientWallet}\` |\n` +
          `| 🌐 Node | ${nodeUrl} |` +
          txLine +
          `\n\nThank you for contributing! 🦀`,
      });
    }

    core.info(`✅ Awarded ${amount} RTC to ${recipientWallet}${result.dryRun ? ' (dry-run)' : ''}`);
  } catch (error) {
    core.setFailed(`RTC Reward Action failed: ${error.message}`);
  }
}

run();
