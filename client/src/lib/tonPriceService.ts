let cachedPrice: { price: number; lastUpdated: number } | null = null;
const CACHE_DURATION = 60000;

async function fetchFromBinance(): Promise<number> {
  const res = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=TONUSDT', {
    headers: { 'Accept': 'application/json' },
  });
  if (!res.ok) throw new Error('Binance failed');
  const data = await res.json();
  const price = parseFloat(data.price);
  if (!price || isNaN(price)) throw new Error('Binance invalid');
  return price;
}

async function fetchFromOKX(): Promise<number> {
  const res = await fetch('https://www.okx.com/api/v5/market/ticker?instId=TON-USDT', {
    headers: { 'Accept': 'application/json' },
  });
  if (!res.ok) throw new Error('OKX failed');
  const data = await res.json();
  const price = parseFloat(data?.data?.[0]?.last);
  if (!price || isNaN(price)) throw new Error('OKX invalid');
  return price;
}

async function fetchFromBybit(): Promise<number> {
  const res = await fetch('https://api.bybit.com/v5/market/tickers?category=spot&symbol=TONUSDT', {
    headers: { 'Accept': 'application/json' },
  });
  if (!res.ok) throw new Error('Bybit failed');
  const data = await res.json();
  const price = parseFloat(data?.result?.list?.[0]?.lastPrice);
  if (!price || isNaN(price)) throw new Error('Bybit invalid');
  return price;
}

async function fetchFromCoinCap(): Promise<number> {
  const res = await fetch('https://api.coincap.io/v2/assets/the-open-network', {
    headers: { 'Accept': 'application/json' },
  });
  if (!res.ok) throw new Error('CoinCap failed');
  const data = await res.json();
  const price = parseFloat(data?.data?.priceUsd);
  if (!price || isNaN(price)) throw new Error('CoinCap invalid');
  return price;
}

async function fetchFromCoinGecko(): Promise<number> {
  const res = await fetch(
    'https://api.coingecko.com/api/v3/simple/price?ids=the-open-network&vs_currencies=usd',
    { headers: { 'Accept': 'application/json' } }
  );
  if (!res.ok) throw new Error('CoinGecko failed');
  const data = await res.json();
  const price = data['the-open-network']?.usd;
  if (!price || typeof price !== 'number') throw new Error('CoinGecko invalid');
  return price;
}

export async function getTONPrice(): Promise<number> {
  const now = Date.now();
  if (cachedPrice && now - cachedPrice.lastUpdated < CACHE_DURATION) {
    return cachedPrice.price;
  }

  const sources = [fetchFromBinance, fetchFromOKX, fetchFromBybit, fetchFromCoinCap, fetchFromCoinGecko];

  for (const source of sources) {
    try {
      const price = await source();
      cachedPrice = { price, lastUpdated: now };
      return price;
    } catch {
      continue;
    }
  }

  if (cachedPrice) return cachedPrice.price;
  return 3.5;
}

export function axnToTon(axnRaw: number): number {
  return axnRaw / 100000;
}

export function tonToUsd(ton: number, tonPrice: number): number {
  return ton * tonPrice;
}

export function formatTon(ton: number): string {
  if (ton === 0) return '0';
  if (ton < 0.0001) return ton.toFixed(8).replace(/\.?0+$/, '');
  if (ton < 1) return ton.toFixed(6).replace(/\.?0+$/, '');
  return ton.toFixed(4).replace(/\.?0+$/, '');
}

export function formatUsd(usd: number): string {
  if (usd < 0.01) return usd.toFixed(4).replace(/\.?0+$/, '');
  return usd.toFixed(2);
}
