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

async function waitForSdk(ms = 8000): Promise<boolean> {
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
  const ready = await waitForSdk();
  if (!ready) {
    throw new Error("Monetag SDK not available");
  }
  await (window.show_10963365 as any)();
}

export async function showAdgramAd(): Promise<void> {
  const ADSGRAM_BLOCK_ID = "33715";
  let waited = 0;
  while (typeof window.Adsgram === "undefined" && waited < 8000) {
    await new Promise(r => setTimeout(r, 200));
    waited += 200;
  }
  if (typeof window.Adsgram === "undefined") {
    throw new Error("Adsgram SDK not available");
  }
  const controller = window.Adsgram.init({ blockId: ADSGRAM_BLOCK_ID });
  const result = await controller.show();
  if (!result?.done) {
    throw new Error("Adgram ad was not completed");
  }
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
