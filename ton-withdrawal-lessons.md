---
name: TON Withdrawal System Lessons
description: Key bugs found and fixed in the Axionet TON/AXN jetton withdrawal pipeline.
---

## Treasury Wallet Version
The treasury wallet `UQDeroBz4zvOntJ4xuMdiwFtNddMhJ4cGxghF9B7fYz50q8b` is **WalletContractV5R1**, NOT V4. Using `WalletContractV4.create()` produces wrong messages and tonapi.io returns 406 "cannot apply external message to current state".

**Why:** Mismatch between on-chain wallet code and SDK wallet class causes wrong message format.

**How to apply:** Always detect wallet version before creating transfers. Here we hardcode V5R1.

## External Message Wrapping
`wallet.createTransfer({...})` in `@ton/ton` returns **only the message body Cell**, NOT the full external message. Before broadcasting via tonapi.io `/v2/blockchain/message`, must wrap:
```typescript
const fullExternalMsg = beginCell()
  .store(storeMessage(external({ to: wallet.address, body: transfer })))
  .endCell();
const boc = fullExternalMsg.toBoc().toString('base64');
```

**Why:** `sendTransfer()` internally calls `provider.external(body)` which adds the wrapper. When doing it manually (offline signing + REST broadcast), this wrapper must be added explicitly.

## tonapi.io for All TON Operations
TONCenter free API is aggressively rate-limited (1 req/s) and often returns 500. Use tonapi.io for:
- Payment detection (fallback): `GET /v2/blockchain/accounts/{addr}/transactions`
- Jetton wallet lookup: `GET /v2/accounts/{addr}/jettons/{jetton_addr}`
- Seqno: `GET /v2/blockchain/accounts/{addr}/methods/seqno` — returns `stack[0].num` as hex string
- Broadcast: `POST /v2/blockchain/message` with `{ boc: "base64" }`

## Seqno Parsing from tonapi.io
The `/methods/seqno` response has `decoded.state` (NOT `decoded.seqno`) and `stack[0].num` (hex). Parse with: `parseInt(seqnoData.stack[0].num, 16)`.

## Raw Address Conversion
`UQDeroBz4zvOntJ4xuMdiwFtNddMhJ4cGxghF9B7fYz50q8b` → raw `0:deae8073e33bce9ed278c6e31d8b016d35d74c849e1c1b182117d07b7d8cf9d2`

## Claim Retry Pattern
If a claim is stuck as `failed`, reset it with:
```sql
UPDATE ton_withdrawals SET status='pending_payment', expires_at=NOW()+INTERVAL '60 minutes', updated_at=NOW() WHERE id='...'
```
The poller (every 30s) will pick it up and retry automatically.
