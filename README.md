# RTC Reward Action

[![GitHub Marketplace](https://img.shields.io/badge/Marketplace-RTC%20Reward%20Action-blue?logo=github)](https://github.com/marketplace/actions/rtc-reward-action)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A GitHub Action that automatically awards **RTC (RustChain Token)** to contributors when their pull request is merged.

## Features

- 🔀 Triggers automatically on PR merge
- 💰 Configurable RTC amount per merge
- 📬 Reads contributor wallet from PR body **or** a `.rtc-wallet` file in the repository
- 💬 Posts a confirmation comment on the PR after successful payment
- 🧪 Supports **dry-run mode** for safe testing without submitting real transactions
- 🎨 GitHub Marketplace ready with branding

---

## Quick Start

```yaml
name: Reward Contributors

on:
  pull_request:
    types: [closed]

jobs:
  reward:
    runs-on: ubuntu-latest
    if: github.event.pull_request.merged == true
    steps:
      - uses: actions/checkout@v4

      - name: Award RTC for merged PR
        uses: XananasX7/rtc-reward-action@v1
        with:
          wallet-from: ${{ secrets.TREASURY_WALLET }}
          admin-key: ${{ secrets.ADMIN_PRIVATE_KEY }}
          amount: '13'
          node-url: 'https://node.rustchain.io'
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

---

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `wallet-from` | Treasury/admin wallet address (sender) | ✅ | — |
| `admin-key` | Admin private key for signing transactions | ❌ | `''` |
| `amount` | RTC amount to award per merged PR | ❌ | `10` |
| `node-url` | RustChain node URL | ❌ | `https://node.rustchain.io` |
| `dry-run` | Simulate without submitting to chain | ❌ | `false` |
| `wallet-file` | Path to `.rtc-wallet` file in the repo | ❌ | `.rtc-wallet` |

## Outputs

| Output | Description |
|--------|-------------|
| `tx-hash` | Transaction hash (empty in dry-run mode) |
| `recipient-wallet` | Wallet address that received the RTC |
| `awarded-amount` | Amount of RTC awarded |

---

## Wallet Resolution

The action finds the contributor's wallet in this order:

### 1. PR Body (recommended for per-contributor wallets)

Add to the PR description:

```
RTC wallet: rtc1yourwalletaddresshere
```

or as an HTML comment (invisible in rendered view):

```html
<!-- rtc-wallet: rtc1yourwalletaddresshere -->
```

### 2. `.rtc-wallet` File (recommended for single-owner repos)

Commit a `.rtc-wallet` file to your repository root:

```
# My RustChain wallet address
rtc1yourwalletaddresshere
```

Lines starting with `#` are treated as comments and ignored.

---

## Dry-Run Mode

Enable dry-run mode to test the action without submitting real transactions:

```yaml
- uses: XananasX7/rtc-reward-action@v1
  with:
    wallet-from: 'test-treasury-wallet'
    amount: '13'
    dry-run: 'true'
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

In dry-run mode, the action will:
- Log what *would* happen
- Post the confirmation comment (marked as dry-run)
- Set outputs normally
- **Not** submit any transaction to the RustChain node

---

## Example PR Comment

When a PR is merged and a wallet is found, the action posts:

> 🎉 **RTC Reward Sent!** *(dry-run — no real transaction submitted)*
>
> Congratulations @contributor! Your contribution has been rewarded.
>
> | Field | Value |
> |-------|-------|
> | 💰 Amount | **13 RTC** |
> | 📬 Recipient wallet | `rtc1abc...` |
> | 🌐 Node | https://node.rustchain.io |
>
> Thank you for contributing! 🦀

---

## Security

- Store your treasury wallet and admin key in **GitHub Secrets**, never in plain text
- Use `dry-run: 'true'` when first setting up to verify the workflow works correctly
- The `GITHUB_TOKEN` is used only to post comments and is automatically provided by GitHub Actions

---

## Development

```bash
# Install dependencies
npm install

# Build the bundled dist
npm run build

# Run tests
npm test
```

---

## License

MIT © [XananasX7](https://github.com/XananasX7)
