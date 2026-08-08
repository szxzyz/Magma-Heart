declare global {
  interface Window {
    show_10963365: (type?: any) => Promise<void>;
    __axnGamePlaying: boolean;
    showGiga: () => Promise<void>;
    Adsgram: {
      init: (config: { blockId: string; debug?: boolean }) => {
        show: () => Promise<{ done: boolean }>;
      };
    };
  }
}

window.__axnGamePlaying = false;
let monetagInFlight: Promise<void> | null = null;

async function waitForSdk(ms = 15000): Promise<boolean> {
  let waited = 0;
  while (typeof window.show_10963365 !== "function" && waited < ms) {
    await new Promise(r => setTimeout(r, 200));
    waited += 200;
  }
  return typeof window.show_10963365 === "function";
}

export async function showRewardedInterstitial(): Promise<void> {
  const ready = await waitForSdk();
  if (!ready) throw new Error("Rewarded ad SDK not available");
  try {
    await (window.show_10963365 as any)();
  } catch (e) {
    console.warn("Rewarded interstitial ad error:", e);
    try {
      await (window.show_10963365 as any)();
    } catch (retryError) {
      throw retryError instanceof Error ? retryError : new Error("Rewarded ad was not completed");
    }
  }
}

export async function showRewardedPopup(): Promise<void> {
  const ready = await waitForSdk();
  if (!ready) return;
  try {
    await (window.show_10963365 as any)('pop');
  } catch (e) {
    console.warn("Rewarded popup ad error:", e);
  }
}

export function showInAppAd(): void {
  if (typeof window.show_10963365 !== "function") return;
  if (window.location.pathname.startsWith('/game/')) return;
  if (window.__axnGamePlaying) return;
  try {
    (window.show_10963365 as any)({
      type: 'inApp',
      inAppSettings: {
        frequency: 2,
        capping: 0.1,
        interval: 30,
        timeout: 5,
        everyPage: false,
      }
    }).catch(() => {});
  } catch {}
}

export function setGamePlaying(playing: boolean): void {
  window.__axnGamePlaying = playing;
}

export async function showAd(): Promise<void> {
  await showRewardedInterstitial();
}

export async function showMonatagRewardedAd(): Promise<void> {
  if (monetagInFlight) return monetagInFlight;
  monetagInFlight = (async () => {
    const ready = await waitForSdk();
    if (!ready) throw new Error("Monetag ad is still loading. Please try again.");
    // Monetag resolves this promise when the rewarded ad flow finishes.
    // Do not award before the SDK settles, and do not retry automatically:
    // retrying can show two ads for one user click.
    await (window.show_10963365 as any)();
  })();
  try {
    await monetagInFlight;
  } finally {
    monetagInFlight = null;
  }
}

export async function showAdgramAd(): Promise<void> {
  const ADSGRAM_BLOCK_ID = import.meta.env.VITE_ADSGRAM_REWARDED_BLOCK_ID;
  await showAdsgramBlock(ADSGRAM_BLOCK_ID, true);
}

async function showAdsgramBlock(blockId: string, requireCompletion: boolean): Promise<void> {
  let waited = 0;
  while (typeof window.Adsgram === "undefined" && waited < 8000) {
    await new Promise(r => setTimeout(r, 200));
    waited += 200;
  }
  if (typeof window.Adsgram === "undefined") {
    throw new Error("Adsgram SDK not available");
  }
  const controller = window.Adsgram.init({ blockId });
  const result = await controller.show();
  if (requireCompletion && !result?.done) {
    throw new Error("Adgram ad was not completed");
  }
}

/** Non-rewarded first-open interstitial. It never participates in earning logic. */
export async function showAdsgramFirstOpenAd(): Promise<void> {
  await showAdsgramBlock(import.meta.env.VITE_ADSGRAM_FIRST_OPEN_BLOCK_ID, false);
}

export async function showGigapubAd(): Promise<void> {
  let waited = 0;
  while (typeof window.showGiga !== "function" && waited < 8000) {
    await new Promise(r => setTimeout(r, 200));
    waited += 200;
  }
  if (typeof window.showGiga !== "function") {
    throw new Error("GigaPub SDK not available");
  }
  await window.showGiga();
}
