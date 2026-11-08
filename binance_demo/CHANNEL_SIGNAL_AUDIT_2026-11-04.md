# @KCryptoBTC168 public signal → reported profit audit
**As of:** 2026-11-04 10:15:55 UTC  
**Source:** https://t.me/s/KCryptoBTC168 (Telegram public preview, forward pagination via `?before=ID`)  
**Coverage:** public ID #1–#1984, 82 pages, 1,600 distinct posts extracted. Other ID values may be deleted, hidden, non-post, or otherwise not publicly visible; this is *not* a claim to have retrieved private/removed posts.

## Method
- Extract post ID, timestamp, visible textual body, reply-to parent and media marker. Follow reply chains up to 8 steps.
- Classify text-only entry candidates by recognized asset tag + directional entry language (including some incomplete signals); stop price must be explicit for a more stringent executable-signal subset.
- A reply-to parent chain explicitly linked to an entry is accepted as **linkage evidence** only. Unlinked messages are never automatically attributed to the nearest entry.
- Track `浮盈`, `翻倍`, `賺錢`, `減倉`, `止盈`, `止損`, `撤單` separately. **These words do not establish actual executed P&L.**
- Posts with only images or embedded charts can contain details the public text extractor cannot verify; no OCR was applied. Screenshots without signed account reports are not independent exchange proof.

## Quantitative first pass (keyword + reply association, NOT winning trades)
| Metric | Result |
| --- | ---: |
| Distinct public posts | 1,600 |
| Entry candidates by text pattern | 184 |
| Entry candidates with a recognizable stop-loss price | 92 |
| Candidate entries with >=1 reply-chain-linked follow-up | 88 |
| Candidate entries with >=1 linked profit/float/TP phrase | 68 |
| Candidate entries with no matched reply | 96 |
| Candidate entries with linked partial-reduction wording | 35 |
| Candidate entries with linked close/TP wording | 12 |
| Candidate entries with linked cancellation wording | 7 |
| Candidate entries with stop-related follow-up words | 13 |
| Detected follow-up-like posts | 773 |
| Follow-ups linked to entry parent or chain | 152 (148 direct, 4 chained) |
| Follow-ups not linked to a recognized entry | 621 |
| Unlinked follow-up posts containing profit-related words | 456 |
| Explicit labeled exit-price in matched follow-up text detected | 0 |

**Important:** The 13 stop-related follow-ups include *moving a stop* and phrases such as "almost stopped out"; they are **not 13 proven losing positions**. The 68 profit-linked entries also include **unrealized** gain posts, *not 68 realized winners*. Some follow-ups may be associated with entries outside the strict pattern (e.g. without recognizable hashtag or stop). None of the table entries is a trustworthy win rate.

### First-pass entry candidates by token
BTC 125; ETH 21; ZEC 18; SOL 6; HYPE 5; XAU 2; LINK/WIF/SUI/TON/APT/DOGE/XRP 1 each. These counts do not imply that each post was an executable order.

## Cases with verifiable parent links but unverified *profit*
- [ZEC entry #1976](https://t.me/KCryptoBTC168/1976): long 1,145–1,155, stop 1,118. [#1978](https://t.me/KCryptoBTC168/1978) says `賺錢了`; [#1979](https://t.me/KCryptoBTC168/1979) says `兩倍了 減倉`. Neither text supplies matched exact fill, fee and close quantity. Do not report 100% realized ROI.
- [SOL entry #1981](https://t.me/KCryptoBTC168/1981): long 90.5–91.4, stop 88.8; [#1982](https://t.me/KCryptoBTC168/1982) says `浮盈`; [#1983](https://t.me/KCryptoBTC168/1983) claims `翻倍`. Linked declarations, no full closing evidence.
- [ZEC entry #1956](https://t.me/KCryptoBTC168/1956): long 1,200–1,225, stop 1,168; [#1958](https://t.me/KCryptoBTC168/1958), [#1962](https://t.me/KCryptoBTC168/1962) make "double" claims. A duplicate claim is **not** another distinct profitable trade.
- [ETH entry #1794](https://t.me/KCryptoBTC168/1794) long 2,430–2,440, stop 2,380; [#1798](https://t.me/KCryptoBTC168/1798) says `翻倍了 減倉`: partial-reduction declaration, not independently verified net P&L.

## Cases that illustrate selective outcome reporting risk
- [XRP entry #1831](https://t.me/KCryptoBTC168/1831): long 1.42–1.43, stop 1.395. [#1832](https://t.me/KCryptoBTC168/1832) said `小浮盈`, but [#1833](https://t.me/KCryptoBTC168/1833) later said `這單止損了`. Counting initial positive updates as winners is demonstrably wrong.
- [ZEC short entry #1967](https://t.me/KCryptoBTC168/1967) 1,250–1,265, stop 1,288; [#1968](https://t.me/KCryptoBTC168/1968) says `止損`.
- [ETH long entry #1935](https://t.me/KCryptoBTC168/1935) 2,400–2,420, stop 2,355; [#1936](https://t.me/KCryptoBTC168/1936) reports the trade stopped out.
- [BTC long entry #1689](https://t.me/KCryptoBTC168/1689) 65,800–66,200, stop 64,700; [#1694](https://t.me/KCryptoBTC168/1694) reports ultimately stopped out after scaling attempts. Actual resulting trade P&L cannot be computed without fills.

## Promotional declarations not linkable to public positions
- [#1918](https://t.me/KCryptoBTC168/1918) claims "two 4x TP trades in VIP group", without enough **public** fill/close records to audit.
- [#1964](https://t.me/KCryptoBTC168/1964) mentions "10x, 5x, 7x" gains in members-only results, without a complete public trade ledger. These could reflect leveraged ROI rather than underlying price movement.
These are not accusations of fabrication; they simply cannot be independently audited from the public preview.

## Core gap & recommended accounting rules
1. Entry call is **not** exchange fill: `LIMIT` may never be touched; `MARKET` must have observed executable bid/ask. Do not backfill.
2. `浮盈` means unrealized; `翻倍`/“2x” is ambiguous (could be margin/leveraged return, screenshots, or some other metric).
3. `減倉` confirms a *text instruction*, not the fraction or fill price; unknown ratio must be marked explicitly assumed if simulated.
4. A reported stopped-out trade must appear in the denominator, including when it had previously shown positive floating P&L.
5. Without source-linked actual fill / close transactions, fees, funding and quantities, do **not** compute creator's actual win rate or net ROI.
6. Maintain two separate metrics in K Signal: **public-channel claim frequency** and **independently simulated / Binance Demo realized results**.

## Full per-entry evidence
The independent read-only audit (Basic Auth using Paper Lab dashboard credentials) exposes:
- https://kcrypto-public-channel-audit-production.up.railway.app/ — summary
- https://kcrypto-public-channel-audit-production.up.railway.app/api/entries — all 184 classified entry candidates with linked replies
- https://kcrypto-public-channel-audit-production.up.railway.app/api/unmatched — all 621 unmatched follow-up-style posts
- https://kcrypto-public-channel-audit-production.up.railway.app/audit.csv — downloadable entry/outcome cross-reference
The audit does **not** place orders, read Binance account secrets, or modify existing Paper/Demo ledger. It uses a new Railway Function; in-memory results may be rebuilt after a restart. The current dataset covers publicly visible messages only.

## Future audit improvements
- Manually examine "non-executable" candidate texts and refine parser (Chinese synonyms/no hashtags).
- Separately validate positive words referring to *floating* gain vs closing action and explicit losing exits; avoid `止損上移` false-loss classification.
- For any claim involving an image, manually inspect source media with respect to privacy, trustworthiness and availability.
- Optionally historical market-data replay with UTC timestamp and mark/bid/ask, applying entry/exit execution constraints (a hypothetical backtest, not proof of someone else's fills).
