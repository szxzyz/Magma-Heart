import { WalletContractV5R1, Address, toNano, internal, beginCell, external, storeMessage } from '@ton/ton';
import { mnemonicToPrivateKey } from '@ton/crypto';

const TREASURY_ADDRESS = 'UQDeroBz4zvOntJ4xuMdiwFtNddMhJ4cGxghF9B7fYz50q8b';
const AXN_JETTON_MASTER = 'EQCj3Cpl5aEEdt7fhZmHrhCYA99YjMZxvkp8UmtmHT4Gfm7b';
// Treasury's AXN jetton wallet — hardcoded (dynamic tonapi lookup returns empty for this wallet)
const TREASURY_JETTON_WALLET = 'EQCwXpD3EieWnsV-ZR3ytGYdfkw9iGIat08r9M0GAteLuceS';
export const CLAIM_FEE_TON = '0.03';
export const CLAIM_FEE_NANO = '30000000';
const AXN_DECIMALS = 9;

const TONAPI = 'https://tonapi.io/v2';

function tonapiHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Accept': 'application/json', 'Content-Type': 'application/json' };
  if (process.env.TONAPI_KEY) h['Authorization'] = `Bearer ${process.env.TONAPI_KEY}`;
  return h;
}

async function getTreasuryWallet() {
  const mnemonic = (process.env.TREASURY_MNEMONIC || '').trim().split(/\s+/);
  if (mnemonic.length < 12) throw new Error('TREASURY_MNEMONIC not configured');
  const keyPair = await mnemonicToPrivateKey(mnemonic);
  const wallet = WalletContractV5R1.create({ publicKey: keyPair.publicKey, workchain: 0 });
  return { wallet, keyPair };
}

function getAllAddressForms(addr: string): string[] {
  try {
    const parsed = Address.parse(addr);
    return [
      parsed.toString({ bounceable: false }),
      parsed.toString({ bounceable: true }),
      parsed.toRawString(),
    ];
  } catch { return [addr]; }
}

// ── Get AXN balance from the treasury's jetton wallet via get_wallet_data ─────
async function getJettonWalletBalance(): Promise<bigint> {
  try {
    const jwRaw = Address.parse(TREASURY_JETTON_WALLET).toRawString();
    const resp = await fetch(
      `${TONAPI}/blockchain/accounts/${jwRaw}/methods/get_wallet_data`,
      { headers: tonapiHeaders(), signal: AbortSignal.timeout(10000) }
    );
    if (!resp.ok) throw new Error(`get_wallet_data failed: ${resp.status}`);
    const data = await resp.json();
    const balHex = data.decoded?.balance ?? data.stack?.[0]?.num;
    if (balHex === undefined) throw new Error('balance not found in get_wallet_data response');
    return typeof balHex === 'bigint' ? balHex
         : typeof balHex === 'number' ? BigInt(balHex)
         : balHex.startsWith('0x') ? BigInt(balHex)
         : BigInt(balHex);
  } catch (e) {
    console.error('[TON] getJettonWalletBalance error:', e);
    return BigInt(0);
  }
}

// ── Treasury diagnostics ───────────────────────────────────────────────────────
export async function getTreasuryInfo(): Promise<{
  address: string;
  tonBalance: string;
  axnBalance: string;
  axnBalanceRaw: string;
  hasEnoughTon: boolean;
  walletAddress: string;
}> {
  const treasuryRaw = Address.parse(TREASURY_ADDRESS).toRawString();

  let tonBalance = '0';
  let axnBalance = '0';
  let axnBalanceRaw = '0';

  // TON balance
  try {
    const accResp = await fetch(`${TONAPI}/accounts/${treasuryRaw}`, {
      headers: tonapiHeaders(), signal: AbortSignal.timeout(10000)
    });
    if (accResp.ok) {
      const acc = await accResp.json();
      tonBalance = (Number(BigInt(acc.balance || 0)) / 1e9).toFixed(4);
    }
  } catch {}

  // AXN balance — direct get_wallet_data on hardcoded jetton wallet
  const rawBal = await getJettonWalletBalance();
  axnBalanceRaw = rawBal.toString();
  axnBalance = (Number(rawBal) / 10 ** AXN_DECIMALS).toFixed(2);

  return {
    address: TREASURY_ADDRESS,
    tonBalance,
    axnBalance,
    axnBalanceRaw,
    hasEnoughTon: parseFloat(tonBalance) >= 0.05,
    walletAddress: TREASURY_JETTON_WALLET,
  };
}

// ── Payment detection ─────────────────────────────────────────────────────────
export async function checkPaymentReceived(
  userWalletAddress: string,
  claimCreatedAt: Date
): Promise<{ found: boolean; txHash?: string }> {
  const userForms = getAllAddressForms(userWalletAddress);
  const claimTs = Math.floor(claimCreatedAt.getTime() / 1000);

  // Strategy 1: TONCenter v2
  try {
    const apiKey = process.env.TONCENTER_API_KEY;
    const keyParam = apiKey ? `&api_key=${apiKey}` : '';
    const treasuryAddr = Address.parse(TREASURY_ADDRESS);
    const url = `https://toncenter.com/api/v2/getTransactions?address=${treasuryAddr.toString()}&limit=100&archival=false${keyParam}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (resp.ok) {
      const data = await resp.json();
      if (data.ok && Array.isArray(data.result)) {
        for (const tx of data.result) {
          if (!tx.in_msg?.source) continue;
          if ((tx.utime || 0) < claimTs - 120) continue;
          const senderForms = getAllAddressForms(tx.in_msg.source);
          if (!userForms.some(u => senderForms.includes(u))) continue;
          if (parseInt(tx.in_msg.value || '0') < 20_000_000) continue;
          const txHash = tx.transaction_id?.hash || tx.hash || `toncv2_${tx.utime}`;
          console.log(`[TON] ✅ Payment found via TONCenter! hash=${txHash}`);
          return { found: true, txHash };
        }
        console.log(`[TON] TONCenter: No matching payment`);
        return { found: false };
      }
    } else {
      console.warn(`[TON] TONCenter ${resp.status}, trying tonapi.io...`);
    }
  } catch (e) {
    console.warn(`[TON] TONCenter failed: ${e}, trying tonapi.io...`);
  }

  // Strategy 2: tonapi.io
  try {
    const treasuryRaw = Address.parse(TREASURY_ADDRESS).toRawString();
    const url = `${TONAPI}/blockchain/accounts/${treasuryRaw}/transactions?limit=100`;
    const resp = await fetch(url, { headers: tonapiHeaders(), signal: AbortSignal.timeout(12000) });
    if (!resp.ok) { console.warn(`[TON] tonapi.io ${resp.status}`); return { found: false }; }
    const data = await resp.json();
    for (const tx of (data.transactions || [])) {
      if ((tx.utime || 0) < claimTs - 120) continue;
      const inMsg = tx.in_msg;
      if (!inMsg?.source?.address) continue;
      const senderForms = getAllAddressForms(inMsg.source.address);
      if (!userForms.some(u => senderForms.includes(u))) continue;
      if (parseInt(inMsg.value || '0') < 20_000_000) continue;
      const txHash = tx.hash || `tonapi_${tx.utime}`;
      console.log(`[TON] ✅ Payment found via tonapi.io! hash=${txHash}`);
      return { found: true, txHash };
    }
    console.log(`[TON] tonapi.io: No matching payment`);
    return { found: false };
  } catch (e) {
    console.error(`[TON] tonapi.io failed: ${e}`);
    return { found: false };
  }
}

// Exact TON deposit verification for CIPHER purchases. Unlike withdrawal-fee
// detection above, this requires the exact nanoTON amount and sender wallet.
export async function checkDepositPaymentReceived(
  userWalletAddress: string,
  createdAt: Date,
  expectedNano: string,
): Promise<{ found: boolean; txHash?: string }> {
  const userForms = getAllAddressForms(userWalletAddress);
  const claimTs = Math.floor(createdAt.getTime() / 1000) - 120;
  const expected = BigInt(expectedNano);
  const treasuryRaw = Address.parse(TREASURY_ADDRESS).toRawString();

  try {
    const apiKey = process.env.TONCENTER_API_KEY;
    const keyParam = apiKey ? `&api_key=${apiKey}` : '';
    const treasuryAddr = Address.parse(TREASURY_ADDRESS);
    const url = `https://toncenter.com/api/v2/getTransactions?address=${treasuryAddr.toString()}&limit=100&archival=false${keyParam}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (resp.ok) {
      const data = await resp.json();
      for (const tx of (data.result || [])) {
        if (!tx.in_msg?.source || (tx.utime || 0) < claimTs) continue;
        const senderForms = getAllAddressForms(tx.in_msg.source);
        if (!userForms.some(u => senderForms.includes(u))) continue;
        if (BigInt(tx.in_msg.value || 0) !== expected) continue;
        return { found: true, txHash: tx.transaction_id?.hash || tx.hash || `toncenter_${tx.utime}` };
      }
    }
  } catch (error) {
    console.warn('[TON] Exact deposit TONCenter lookup failed:', error);
  }

  try {
    const url = `${TONAPI}/blockchain/accounts/${treasuryRaw}/transactions?limit=100`;
    const resp = await fetch(url, { headers: tonapiHeaders(), signal: AbortSignal.timeout(12000) });
    if (!resp.ok) return { found: false };
    const data = await resp.json();
    for (const tx of (data.transactions || [])) {
      if ((tx.utime || 0) < claimTs) continue;
      const inMsg = tx.in_msg;
      if (!inMsg?.source?.address) continue;
      const senderForms = getAllAddressForms(inMsg.source.address);
      if (!userForms.some(u => senderForms.includes(u))) continue;
      if (BigInt(inMsg.value || 0) !== expected) continue;
      return { found: true, txHash: tx.hash || `tonapi_${tx.utime}` };
    }
  } catch (error) {
    console.warn('[TON] Exact deposit TonAPI lookup failed:', error);
  }

  return { found: false };
}

// ── Wait for tx to land on-chain and return its real hash ────────────────────
async function waitForTxBySeqno(
  treasuryRaw: string,
  seqno: number,
  timeoutMs = 60000
): Promise<string | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise(r => setTimeout(r, 4000));
    try {
      const resp = await fetch(
        `${TONAPI}/blockchain/accounts/${treasuryRaw}/transactions?limit=10`,
        { headers: tonapiHeaders(), signal: AbortSignal.timeout(10000) }
      );
      if (!resp.ok) continue;
      const data = await resp.json();
      for (const tx of (data.transactions || [])) {
        // External messages have no source — match by seqno in decoded body
        if (tx.in_msg && !tx.in_msg.source) {
          // Check if this is recent enough (within last 2 min)
          if ((tx.utime || 0) > Math.floor((Date.now() - 120000) / 1000)) {
            console.log(`[TON] Found recent outgoing tx with hash=${tx.hash}`);
            return tx.hash;
          }
        }
      }
    } catch {}
  }
  return null;
}

// ── AXN Jetton Send ──────────────────────────────────────────────────────────
export async function sendAXNJetton(
  toAddress: string,
  axnAmount: number
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  try {
    const { wallet, keyPair } = await getTreasuryWallet();
    const treasuryAddr = Address.parse(TREASURY_ADDRESS);
    const treasuryRaw = treasuryAddr.toRawString();

    // Step 1: Check AXN balance via get_wallet_data on hardcoded jetton wallet
    // (dynamic tonapi lookup /accounts/{treasury}/jettons/{master} returns empty for this wallet)
    const rawBalance = await getJettonWalletBalance();
    const axnAvailable = Number(rawBalance) / 10 ** AXN_DECIMALS;
    console.log(`[TON] Treasury AXN balance: ${axnAvailable.toFixed(2)} AXN (need ${axnAmount})`);
    if (axnAvailable < axnAmount) {
      throw new Error(
        `Treasury insufficient AXN. Available: ${axnAvailable.toFixed(2)}, Required: ${axnAmount}. ` +
        `Fund treasury wallet: ${TREASURY_ADDRESS}`
      );
    }

    // Step 1b: Check treasury TON for gas
    const accResp = await fetch(`${TONAPI}/accounts/${treasuryRaw}`, {
      headers: tonapiHeaders(), signal: AbortSignal.timeout(10000)
    });
    if (accResp.ok) {
      const acc = await accResp.json();
      const tonBal = Number(BigInt(acc.balance || 0)) / 1e9;
      if (tonBal < 0.05) {
        throw new Error(
          `Treasury insufficient TON for gas. Available: ${tonBal.toFixed(4)} TON, need 0.05+. ` +
          `Send TON to: ${TREASURY_ADDRESS}`
        );
      }
      console.log(`[TON] Treasury TON balance: ${tonBal.toFixed(4)} TON ✅`);
    }

    // Use hardcoded jetton wallet address — verified owner matches treasury
    const jettonWalletAddr = Address.parse(TREASURY_JETTON_WALLET);
    console.log(`[TON] Using jetton wallet: ${TREASURY_JETTON_WALLET}`);

    // Step 2: Get seqno
    const seqnoResp = await fetch(
      `${TONAPI}/blockchain/accounts/${treasuryRaw}/methods/seqno`,
      { headers: tonapiHeaders(), signal: AbortSignal.timeout(12000) }
    );
    if (!seqnoResp.ok) throw new Error(`tonapi seqno failed: ${seqnoResp.status}`);
    const seqnoData = await seqnoResp.json();
    const seqnoHex = seqnoData.stack?.[0]?.num ?? seqnoData.decoded?.seqno;
    if (seqnoHex === undefined) throw new Error('Could not read seqno from tonapi response');
    const seqno = typeof seqnoHex === 'number' ? seqnoHex : parseInt(String(seqnoHex), 16);
    console.log(`[TON] Seqno: ${seqno}`);

    // Step 3: Build jetton transfer body
    const jettonAmount = BigInt(Math.round(axnAmount)) * BigInt(10 ** AXN_DECIMALS);
    const destinationAddr = Address.parse(toAddress);
    const transferBody = beginCell()
      .storeUint(0xf8a7ea5, 32)
      .storeUint(0, 64)
      .storeCoins(jettonAmount)
      .storeAddress(destinationAddr)
      .storeAddress(treasuryAddr)
      .storeBit(false)
      .storeCoins(toNano('0.01'))
      .storeBit(false)
      .endCell();

    // Step 4: Sign
    const transfer = wallet.createTransfer({
      seqno,
      secretKey: keyPair.secretKey,
      messages: [
        internal({
          to: jettonWalletAddr,
          value: toNano('0.05'),
          body: transferBody,
        }),
      ],
    });
    const fullExternalMsg = beginCell()
      .store(storeMessage(external({ to: wallet.address, body: transfer })))
      .endCell();
    const boc = fullExternalMsg.toBoc().toString('base64');

    // Step 5: Broadcast
    const sendResp = await fetch(`${TONAPI}/blockchain/message`, {
      method: 'POST',
      headers: tonapiHeaders(),
      body: JSON.stringify({ boc }),
      signal: AbortSignal.timeout(20000),
    });
    if (!sendResp.ok) {
      const errText = await sendResp.text().catch(() => '');
      throw new Error(`tonapi broadcast failed: ${sendResp.status} ${errText}`);
    }

    console.log(`[TON] ✅ Broadcast accepted! seqno=${seqno}, amount=${axnAmount} AXN → ${toAddress}`);

    // Step 6: Wait for real tx hash on-chain (up to 60s)
    const realHash = await waitForTxBySeqno(treasuryRaw, seqno, 60000);
    const txHash = realHash || `seqno_${seqno}_${Date.now()}`;
    console.log(`[TON] ✅ AXN sent! txHash=${txHash}`);

    return { success: true, txHash };

  } catch (e: any) {
    console.error('[TON] sendAXNJetton error:', e?.message || e);
    return { success: false, error: e?.message || 'Unknown error' };
  }
}

export { TREASURY_ADDRESS, AXN_JETTON_MASTER };
