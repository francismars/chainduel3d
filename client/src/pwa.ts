import { registerSW } from 'virtual:pwa-register';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const INSTALL_DISMISS_KEY = 'chainduel3d.pwa.install.dismissedAt';
const UPDATE_DISMISS_KEY = 'chainduel3d.pwa.update.dismissedAt';
const DISMISS_MS = 24 * 60 * 60 * 1000;

const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || (window.navigator as Navigator & { standalone?: boolean }).standalone === true;

const isIos = () => /iphone|ipad|ipod/i.test(window.navigator.userAgent);

const isSafari = () => {
  const ua = window.navigator.userAgent;
  return /safari/i.test(ua) && !/chrome|crios|android/i.test(ua);
};

const wasDismissedRecently = (key: string): boolean => {
  const raw = window.localStorage.getItem(key);
  if (!raw) return false;
  const ts = Number(raw);
  return Number.isFinite(ts) && Date.now() - ts < DISMISS_MS;
};

const setDismissed = (key: string) => {
  window.localStorage.setItem(key, String(Date.now()));
};

const createBanner = (message: string, primaryLabel: string, onPrimary: () => void, onDismiss: () => void): HTMLDivElement => {
  const wrap = document.createElement('div');
  wrap.style.cssText = [
    'position:fixed',
    'left:12px',
    'right:12px',
    'bottom:12px',
    'z-index:9999',
    'background:rgba(10,10,10,0.95)',
    'border:1px solid #323232',
    'border-radius:10px',
    'padding:10px 12px',
    'display:flex',
    'align-items:center',
    'justify-content:space-between',
    'gap:10px',
    'color:#f2f2f2',
    'font:500 13px Inter, Segoe UI, Tahoma, Geneva, Verdana, sans-serif',
    'box-shadow:0 8px 24px rgba(0,0,0,0.35)',
  ].join(';');

  const text = document.createElement('div');
  text.textContent = message;
  text.style.cssText = 'line-height:1.35;flex:1;';
  wrap.appendChild(text);

  const actions = document.createElement('div');
  actions.style.cssText = 'display:flex;gap:8px;flex-shrink:0;';

  const primary = document.createElement('button');
  primary.textContent = primaryLabel;
  primary.style.cssText = [
    'padding:8px 10px',
    'border:1px solid #f0f0f0',
    'border-radius:6px',
    'background:#f0f0f0',
    'color:#000',
    'cursor:pointer',
    'font:600 12px Inter, Segoe UI, Tahoma, Geneva, Verdana, sans-serif',
  ].join(';');
  primary.onclick = onPrimary;
  actions.appendChild(primary);

  const dismiss = document.createElement('button');
  dismiss.textContent = 'Later';
  dismiss.style.cssText = [
    'padding:8px 10px',
    'border:1px solid #333',
    'border-radius:6px',
    'background:#101010',
    'color:#d0d0d0',
    'cursor:pointer',
    'font:600 12px Inter, Segoe UI, Tahoma, Geneva, Verdana, sans-serif',
  ].join(';');
  dismiss.onclick = onDismiss;
  actions.appendChild(dismiss);

  wrap.appendChild(actions);
  return wrap;
};

const setupInstallPrompt = () => {
  if (isStandalone() || wasDismissedRecently(INSTALL_DISMISS_KEY)) return;

  let installBanner: HTMLDivElement | null = null;
  let deferredPrompt: BeforeInstallPromptEvent | null = null;

  const hide = () => {
    if (!installBanner) return;
    installBanner.remove();
    installBanner = null;
  };

  const showAndroidBanner = () => {
    if (!deferredPrompt || installBanner || isStandalone()) return;
    installBanner = createBanner(
      'Install ChainDuel3D for a full-screen experience.',
      'Install',
      async () => {
        if (!deferredPrompt) return;
        await deferredPrompt.prompt();
        const choice = await deferredPrompt.userChoice;
        deferredPrompt = null;
        hide();
        if (choice.outcome === 'dismissed') setDismissed(INSTALL_DISMISS_KEY);
      },
      () => {
        setDismissed(INSTALL_DISMISS_KEY);
        hide();
      },
    );
    document.body.appendChild(installBanner);
  };

  const showIosBanner = () => {
    if (!isIos() || !isSafari() || installBanner || isStandalone()) return;
    installBanner = createBanner(
      'Install: tap Share then Add to Home Screen.',
      'Got it',
      () => {
        setDismissed(INSTALL_DISMISS_KEY);
        hide();
      },
      () => {
        setDismissed(INSTALL_DISMISS_KEY);
        hide();
      },
    );
    document.body.appendChild(installBanner);
  };

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    showAndroidBanner();
  });

  window.addEventListener('appinstalled', () => {
    hide();
    window.localStorage.removeItem(INSTALL_DISMISS_KEY);
  });

  // iOS Safari does not emit beforeinstallprompt.
  showIosBanner();
};

const setupUpdateChecks = () => {
  let updateBanner: HTMLDivElement | null = null;

  const hideUpdateBanner = () => {
    if (!updateBanner) return;
    updateBanner.remove();
    updateBanner = null;
  };

  let refreshing = false;
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
  }

  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      if (wasDismissedRecently(UPDATE_DISMISS_KEY) || updateBanner) return;
      updateBanner = createBanner(
        'A new version is available.',
        'Update',
        () => {
          hideUpdateBanner();
          void updateSW(true);
        },
        () => {
          setDismissed(UPDATE_DISMISS_KEY);
          hideUpdateBanner();
        },
      );
      document.body.appendChild(updateBanner);
    },
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      window.setInterval(() => {
        void registration.update();
      }, 60_000);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void registration.update();
      });
    },
  });
};

export const setupPWA = () => {
  setupInstallPrompt();
  setupUpdateChecks();
};
