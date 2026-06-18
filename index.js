/**
 * RTC Reward Action
 *
 * Automatically awards RTC tokens to contributors when their PR is merged.
 * Reads the recipient wallet from the PR body or falls back to a .rtc-wallet file.
 */

const core = require('@actions/core');
const github = require('@actions/github');
const fs = require('fs');
const path = require('path');

// Regex to match a wallet address in PR body
// Supports formats like:
//   wallet: 0xABCD...
//   RTC wallet: rtc1abc...
//   <!-- rtc-wallet: addr -->
const WALLET_PATTERNS = [
  /rtc[- ]wallet[:\s]+([a-zA-Z0-9_-]{20,})/i,
  /wallet[:\s]+([a-zA-Z0-9_-]{20,})/i,
  /<!--\s*rtc-wallet:\s*([a-zA-Z0-9_-]{20,})\s*-->/i,
];

/**
 * Extract wallet address from PR body text.
 * @param {string} body
 * @returns {string|null}
 */
function extractWalletFromBody(body) {
  if (!body) return null;
  for (const pattern of WALLET_PATTERNS) {
    const match = body.match(pattern);
    if (match) return match[1].trim();
  }
  return null;
}

/**
 * Read wallet address from a .rtc-wallet file in the workspace.
 * @param {string} walletFile - path relative to GITHUB_WORKSPACE
 * @returns {string|null}
 */
function readWalletFromFile(walletFile) {
  const workspace = process.env.GITHUB_WORKSPACE || '.';
  const fullPath = path.join(workspace, walletFile);
  if (!fs.existsSync(fullPath)) return null;
  const content = fs.readFileSync(fullPath, 'utf8').trim();
  // First non-comment, non-empty line is the wallet address
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      return trimmed;
    }
  }
  return null;
}

/**
 * Submit an RTC transfer (or simulate in dry-run mode).
 */
async function submitRTCTransfer({ nodeUrl, walletFrom, adminKey, recipientWallet, amount, dryRun }) {
  if (dryRun) {
    core.info(`[DRY RUN] Would transfer ${amount} RTC`);
    core.info(`[DRY RUN]   From:  ${walletFrom}`);
    core.info(`[DRY RUN]   To:    ${recipientWallet}`);
    core.info(`[DRY RUN]   Node:  ${nodeUrl}`);
    return { success: true, txHash: null, dryRun: true };
  }

  // Real transfer — POST to the RustChain node's transfer endpoint
  const fetch = require('node-fetch');
  const payload = {
    from: walletFrom,
    to: recipientWallet,
    amount: parseFloat(amount),
    key: adminKey,
  };

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
    // --- Read inputs ---
    const nodeUrl    = core.getInput('node-url', { required: false }) || 'https://node.rustchain.io';
    const amount     = core.getInput('amount', { required: false }) || '10';
    const walletFrom = core.getInput('wallet-from', { required: true });
    const adminKey   = core.getInput('admin-key', { required: false }) || '';
    const dryRun     = (core.getInput('dry-run') || 'false').toLowerCase() === 'true';
    const walletFile = core.getInput('wallet-file') || '.rtc-wallet';

    // --- Validate event context ---
    const context = github.context;
    if (context.eventName !== 'pull_request' && context.eventName !== 'pull_request_target') {
      core.warning(`This action is designed for pull_request events (got: ${context.eventName}).`);
    }

    const prPayload = context.payload.pull_request;
    if (!prPayload) {
      core.setFailed('No pull_request payload found. Make sure this action runs on pull_request events.');
      return;
    }

    // --- Only act on merged PRs ---
    if (!prPayload.merged) {
      core.info('Pull request is not merged yet — skipping RTC award.');
      return;
    }

    const prNumber  = prPayload.number;
    const prAuthor  = prPayload.user.login;
    const prTitle   = prPayload.title;
    const prBody    = prPayload.body || '';

    core.info(`Processing merged PR #${prNumber}: "${prTitle}" by @${prAuthor}`);

    // --- Resolve recipient wallet ---
    let recipientWallet = extractWalletFromBody(prBody);
    if (recipientWallet) {
      core.info(`Found wallet in PR body: ${recipientWallet}`);
    } else {
      core.info('No wallet found in PR body — checking .rtc-wallet file...');
      recipientWallet = readWalletFromFile(walletFile);
      if (recipientWallet) {
        core.info(`Found wallet in file (${walletFile}): ${recipientWallet}`);
      }
    }

    if (!recipientWallet) {
      core.warning(
        `No RTC wallet address found for @${prAuthor}. ` +
        `Add a wallet to the PR body (e.g. "RTC wallet: <address>") or commit a "${walletFile}" file.`
      );
      // Post a comment asking for the wallet
      const token = process.env.GITHUB_TOKEN;
      if (token) {
        const octokit = github.getOctokit(token);
        await octokit.rest.issues.createComment({
          ...context.repo,
          issue_number: prNumber,
          body:
            `🏦 **RTC Reward Action** — wallet not found!\n\n` +
            `Hey @${prAuthor}! Your PR was merged but we couldn't locate your RTC wallet address.\n\n` +
            `To receive your **${amount} RTC** reward, please:\n` +
            `1. Add a \`${walletFile}\` file to your branch with your wallet address, **or**\n` +
            `2. Edit this PR description and add a line like:\n` +
            `   \`RTC wallet: <your-wallet-address>\`\n\n` +
            `A maintainer will process the payment once your wallet address is on file.`,
        });
      }
      core.setOutput('tx-hash', '');
      core.setOutput('recipient-wallet', '');
      core.setOutput('awarded-amount', '0');
      return;
    }

    // --- Submit transfer ---
    core.info(`Awarding ${amount} RTC to ${recipientWallet}...`);
    const result = await submitRTCTransfer({
      nodeUrl,
      walletFrom,
      adminKey,
      recipientWallet,
      amount,
      dryRun,
    });

    // --- Set outputs ---
    core.setOutput('tx-hash', result.txHash || '');
    core.setOutput('recipient-wallet', recipientWallet);
    core.setOutput('awarded-amount', amount);

    // --- Post confirmation comment ---
    const token = process.env.GITHUB_TOKEN;
    if (token) {
      const octokit = github.getOctokit(token);
      const dryRunNote = result.dryRun ? ' *(dry-run — no real transaction submitted)*' : '';
      const txLine = result.txHash
        ? `\n> 🔗 Transaction hash: \`${result.txHash}\``
        : '';

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

      core.info(`Comment posted on PR #${prNumber}.`);
    } else {
      core.warning('GITHUB_TOKEN not set — skipping PR comment.');
    }

    core.info(`✅ Successfully awarded ${amount} RTC to ${recipientWallet}${result.dryRun ? ' (dry-run)' : ''}`);
  } catch (error) {
    core.setFailed(`RTC Reward Action failed: ${error.message}`);
  }
}

run();
