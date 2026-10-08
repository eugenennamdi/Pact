"use client";

import Image from "next/image";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  authenticateWallet,
  isBrowserSessionValid,
  type BrowserAuthState,
} from "./auth-flow";
import { createProductApiClient } from "./product-client";
import {
  PRODUCT_WALLET_NETWORK,
  WalletDiscovery,
  bindWalletEvents,
  connectWallet,
  parseWalletChainId,
  switchToProductNetwork,
  type DiscoveredWalletProvider,
  type Eip1193Provider,
} from "./wallet";
import {
  safeWalletIcon,
  truncateWalletAddress,
  walletErrorMessage,
} from "./wallet-ui";

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

interface WalletContextValue {
  readonly providers: readonly DiscoveredWalletProvider[];
  readonly provider: Eip1193Provider | null;
  readonly address: `0x${string}` | null;
  readonly chainId: number | null;
  readonly authenticated: boolean;
  readonly busy: boolean;
  readonly message: string | null;
  openConnectModal(): void;
  openAccountDialog(): void;
  connectProvider(id: string): Promise<void>;
  authenticate(): Promise<void>;
  switchNetwork(): Promise<void>;
  disconnect(): Promise<void>;
  invalidateAuthentication(): void;
}

const WalletContext = createContext<WalletContextValue | null>(null);
const api = createProductApiClient();

const LAST_WALLET_RDNS_KEY = "pact:last_wallet_provider_rdns";
const LAST_WALLET_UUID_KEY = "pact:last_wallet_provider_uuid";
const AUTH_SESSION_KEY = "pact:auth_session";

function getStoredValue(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function setStoredValue(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore storage quota or access issues
  }
}

function removeStoredValue(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore storage access issues
  }
}

function getStoredSession(): BrowserAuthState | null {
  try {
    const raw = window.sessionStorage.getItem(AUTH_SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as BrowserAuthState;
  } catch {
    return null;
  }
}

function setStoredSession(session: BrowserAuthState): void {
  try {
    window.sessionStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
  } catch {
    // Ignore storage quota or access issues
  }
}

function removeStoredSession(): void {
  try {
    window.sessionStorage.removeItem(AUTH_SESSION_KEY);
  } catch {
    // Ignore storage access issues
  }
}

function isRabbyProvider(item: DiscoveredWalletProvider): boolean {
  return (
    item.info.rdns === "io.rabby" ||
    item.info.name.toLowerCase().includes("rabby")
  );
}

function RabbyWalletIcon() {
  return (
    <span
      className="wallet-provider-icon wallet-provider-rabby"
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 28 28"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        focusable="false"
      >
        <rect width="28" height="28" rx="6" fill="#8697FF" />
        <path
          fill="url(#rabby-body)"
          d="M22.54 15.078c.677-1.514-2.673-5.744-5.874-7.506-2.017-1.365-4.12-1.178-4.545-.579-.935 1.316 3.094 2.43 5.788 3.731-.58.252-1.125.703-1.446 1.28-1.004-1.096-3.209-2.04-5.796-1.28-1.743.513-3.191 1.721-3.751 3.546a1.097 1.097 0 1 0-.445 2.1c.112 0 .463-.075.463-.075l5.612.041c-2.244 3.56-4.018 4.081-4.018 4.698s1.697.45 2.335.22c3.05-1.1 6.327-4.531 6.89-5.519 2.36.295 4.345.33 4.786-.657Z"
        />
        <path
          fill="url(#rabby-ear)"
          fillRule="evenodd"
          clipRule="evenodd"
          d="m17.885 10.713.025.01c.125-.049.105-.233.07-.378-.078-.333-1.438-1.676-2.715-2.277-1.743-.82-3.025-.777-3.212-.398.356.726 1.998 1.408 3.714 2.12.723.3 1.46.606 2.118.923Z"
        />
        <path
          fill="url(#rabby-back)"
          fillRule="evenodd"
          clipRule="evenodd"
          d="M15.701 18.036a10.296 10.296 0 0 0-1.2-.37c.482-.862.583-2.138.128-2.945-.639-1.133-1.44-1.736-3.304-1.736-1.024 0-3.783.346-3.832 2.648-.005.242 0 .464.017.667l5.036.037a17.264 17.264 0 0 1-1.871 2.483c.669.172 1.221.316 1.728.448.48.125.92.24 1.38.357a21.003 21.003 0 0 0 1.918-1.59Z"
        />
        <path
          fill="url(#rabby-tail)"
          d="M6.848 16.063c.206 1.75 1.2 2.435 3.232 2.638 2.032.203 3.197.067 4.749.208 1.296.118 2.453.778 2.882.55.386-.205.17-.947-.347-1.423-.67-.617-1.597-1.046-3.229-1.199.325-.89.234-2.138-.27-2.817-.731-.982-2.079-1.426-3.785-1.232-1.782.202-3.49 1.08-3.232 3.275Z"
        />
        <defs>
          <linearGradient
            id="rabby-body"
            x1="10.464"
            x2="22.394"
            y1="13.737"
            y2="17.12"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#fff" />
            <stop offset="1" stopColor="#fff" />
          </linearGradient>
          <linearGradient
            id="rabby-ear"
            x1="20.386"
            x2="11.779"
            y1="13.509"
            y2="4.879"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#7258DC" />
            <stop offset="1" stopColor="#797DEA" stopOpacity="0" />
          </linearGradient>
          <linearGradient
            id="rabby-back"
            x1="15.94"
            x2="7.673"
            y1="18.337"
            y2="13.584"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#7461EA" />
            <stop offset="1" stopColor="#BFC2FF" stopOpacity="0" />
          </linearGradient>
          <linearGradient
            id="rabby-tail"
            x1="11.177"
            x2="16.765"
            y1="13.648"
            y2="20.749"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#fff" />
            <stop offset=".984" stopColor="#D5CEFF" />
          </linearGradient>
        </defs>
      </svg>
    </span>
  );
}

function WalletFallbackIcon() {
  return (
    <span className="wallet-provider-fallback" aria-hidden="true">
      <svg viewBox="0 0 24 24" focusable="false">
        <path d="M5.25 6.5h12.5A2.25 2.25 0 0 1 20 8.75v8A2.25 2.25 0 0 1 17.75 19H5.25A2.25 2.25 0 0 1 3 16.75v-10A2.25 2.25 0 0 1 5.25 4.5h10.5" />
        <path d="M15 11h5v4h-5a2 2 0 1 1 0-4Z" />
      </svg>
    </span>
  );
}

function ModalDialog({
  open,
  titleId,
  onClose,
  children,
}: {
  readonly open: boolean;
  readonly titleId: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="wallet-dialog"
      aria-labelledby={titleId}
      onCancel={onClose}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="wallet-dialog-panel">{children}</div>
    </dialog>
  );
}

export function WalletBoundary({ children }: { readonly children: ReactNode }) {
  const [providers, setProviders] = useState<
    readonly DiscoveredWalletProvider[]
  >([]);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(
    null,
  );
  const [address, setAddress] = useState<`0x${string}` | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [session, setSession] = useState<BrowserAuthState | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [connectModalOpen, setConnectModalOpen] = useState(false);
  const [accountDialogOpen, setAccountDialogOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const provider = useMemo(
    () =>
      providers.find((item) => item.info.uuid === selectedProviderId)
        ?.provider ?? null,
    [providers, selectedProviderId],
  );

  const clearSession = useCallback(() => {
    setSession(null);
    removeStoredSession();
    void api.logout().catch(() => undefined);
  }, []);

  useEffect(() => {
    const discovery = new WalletDiscovery(window, window.ethereum);
    const unsubscribe = discovery.subscribe(setProviders);
    discovery.start();
    return () => {
      unsubscribe();
      discovery.stop();
    };
  }, []);

  const autoConnectingRef = useRef(false);

  useEffect(() => {
    if (address !== null || busy || autoConnectingRef.current) return;
    const lastRdns = getStoredValue(LAST_WALLET_RDNS_KEY);
    const lastUuid = getStoredValue(LAST_WALLET_UUID_KEY);
    if (!lastRdns && !lastUuid) return;

    const matched = providers.find(
      (item) =>
        (lastRdns && item.info.rdns === lastRdns) ||
        (lastUuid && item.info.uuid === lastUuid),
    );
    if (!matched) return;

    autoConnectingRef.current = true;
    void (async () => {
      try {
        const accounts = (await matched.provider.request({
          method: "eth_accounts",
        })) as unknown;
        if (
          Array.isArray(accounts) &&
          typeof accounts[0] === "string" &&
          /^0x[0-9a-f]{40}$/i.test(accounts[0])
        ) {
          const nextAddress = accounts[0] as `0x${string}`;
          const chain = await matched.provider.request({
            method: "eth_chainId",
          });
          const nextChainId = parseWalletChainId(chain);
          setSelectedProviderId(matched.info.uuid);
          setAddress(nextAddress);
          setChainId(nextChainId);

          const savedSession = getStoredSession();
          if (
            savedSession &&
            isBrowserSessionValid(savedSession, nextAddress, nextChainId)
          ) {
            setSession(savedSession);
          } else {
            removeStoredSession();
          }
        }
      } catch {
        // Silent reconnection failure leaves interface in clean disconnected state
      } finally {
        autoConnectingRef.current = false;
      }
    })();
  }, [address, busy, providers]);

  useEffect(() => {
    if (provider === null || address === null) return;
    return bindWalletEvents(provider, {
      accountsChanged: (accounts) => {
        clearSession();
        const next = accounts[0];
        if (next !== undefined && /^0x[0-9a-f]{40}$/i.test(next)) {
          setAddress(next as `0x${string}`);
        } else {
          removeStoredValue(LAST_WALLET_RDNS_KEY);
          removeStoredValue(LAST_WALLET_UUID_KEY);
          setSelectedProviderId(null);
          setAddress(null);
          setChainId(null);
        }
        setAccountDialogOpen(false);
      },
      chainChanged: (nextChainId) => {
        clearSession();
        setChainId(nextChainId);
      },
      disconnected: () => {
        clearSession();
        removeStoredValue(LAST_WALLET_RDNS_KEY);
        removeStoredValue(LAST_WALLET_UUID_KEY);
        setSelectedProviderId(null);
        setAddress(null);
        setChainId(null);
        setAccountDialogOpen(false);
      },
    });
  }, [address, clearSession, provider]);

  useEffect(() => {
    if (session === null) return;
    const remaining = session.expiresAt - Date.now();
    if (remaining <= 0) {
      clearSession();
      return;
    }
    const timer = window.setTimeout(clearSession, remaining);
    return () => window.clearTimeout(timer);
  }, [clearSession, session]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1_500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const openConnectModal = useCallback(() => {
    setMessage(null);
    setConnectModalOpen(true);
    setAccountDialogOpen(false);
  }, []);

  const openAccountDialog = useCallback(() => {
    if (address === null) return;
    setMessage(null);
    setAccountDialogOpen(true);
    setConnectModalOpen(false);
  }, [address]);

  const connectProvider = useCallback(
    async (id: string) => {
      const selected = providers.find((item) => item.info.uuid === id);
      if (selected === undefined) {
        setMessage("Wallet is no longer available");
        return;
      }
      setSelectedProviderId(id);
      setAddress(null);
      setChainId(null);
      setSession(null);
      removeStoredSession();
      setBusy(true);
      setMessage(null);
      try {
        const connected = await connectWallet(selected.provider);
        setStoredValue(LAST_WALLET_RDNS_KEY, selected.info.rdns);
        setStoredValue(LAST_WALLET_UUID_KEY, selected.info.uuid);
        setAddress(connected.address);
        setChainId(connected.chainId);
        setConnectModalOpen(false);
      } catch (error) {
        removeStoredValue(LAST_WALLET_RDNS_KEY);
        removeStoredValue(LAST_WALLET_UUID_KEY);
        setMessage(walletErrorMessage(error, "connect"));
      } finally {
        setBusy(false);
      }
    },
    [providers],
  );

  const authenticate = useCallback(async () => {
    if (provider === null || address === null || chainId === null) return;
    setBusy(true);
    setMessage(null);
    try {
      const nextSession = await authenticateWallet({
        client: api,
        provider,
        address,
        chainId,
      });
      setSession(nextSession);
      setStoredSession(nextSession);
    } catch (error) {
      setSession(null);
      removeStoredSession();
      setMessage(walletErrorMessage(error, "sign-in"));
    } finally {
      setBusy(false);
    }
  }, [address, chainId, provider]);

  const switchNetwork = useCallback(async () => {
    if (provider === null) {
      setMessage("Wallet is no longer available");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await switchToProductNetwork(provider, PRODUCT_WALLET_NETWORK);
      const connected = await connectWallet(provider);
      setAddress(connected.address);
      setChainId(connected.chainId);
      setSession(null);
      removeStoredSession();
    } catch (error) {
      setMessage(walletErrorMessage(error, "switch-network"));
    } finally {
      setBusy(false);
    }
  }, [provider]);

  const disconnect = useCallback(async () => {
    setBusy(true);
    try {
      await api.logout();
    } catch {
      // Local wallet/session separation is still cleared if the server is down.
    } finally {
      removeStoredValue(LAST_WALLET_RDNS_KEY);
      removeStoredValue(LAST_WALLET_UUID_KEY);
      removeStoredSession();
      setSelectedProviderId(null);
      setAddress(null);
      setChainId(null);
      setSession(null);
      setMessage(null);
      setAccountDialogOpen(false);
      setBusy(false);
    }
  }, []);

  const authenticated = isBrowserSessionValid(session, address, chainId);
  const value = useMemo<WalletContextValue>(
    () => ({
      providers,
      provider,
      address,
      chainId,
      authenticated,
      busy,
      message,
      openConnectModal,
      openAccountDialog,
      connectProvider,
      authenticate,
      switchNetwork,
      disconnect,
      invalidateAuthentication: clearSession,
    }),
    [
      address,
      authenticate,
      authenticated,
      busy,
      chainId,
      clearSession,
      connectProvider,
      disconnect,
      message,
      openAccountDialog,
      openConnectModal,
      provider,
      providers,
      switchNetwork,
    ],
  );

  return (
    <WalletContext.Provider value={value}>
      {children}

      <ModalDialog
        open={connectModalOpen}
        titleId="connect-wallet-title"
        onClose={() => setConnectModalOpen(false)}
      >
        <div className="wallet-dialog-header">
          <h2 id="connect-wallet-title">Connect a wallet</h2>
          <button
            type="button"
            className="wallet-dialog-close"
            aria-label="Close wallet dialog"
            onClick={() => setConnectModalOpen(false)}
          >
            ×
          </button>
        </div>
        <p className="wallet-dialog-copy">
          Choose an installed browser wallet to continue with Pact.
        </p>
        <p className="wallet-dialog-label">Installed</p>
        {providers.length === 0 ? (
          <div className="wallet-empty-state">
            <WalletFallbackIcon />
            <div>
              <strong>No browser wallet detected.</strong>
              <span>Install or enable an EIP-1193 wallet, then try again.</span>
            </div>
          </div>
        ) : (
          <div className="wallet-provider-list">
            {providers.map((item) => {
              const icon = safeWalletIcon(item.info.icon);
              return (
                <button
                  key={item.info.uuid}
                  type="button"
                  className="wallet-provider-row"
                  data-rdns={item.info.rdns}
                  disabled={busy}
                  onClick={() => void connectProvider(item.info.uuid)}
                >
                  {isRabbyProvider(item) ? (
                    <RabbyWalletIcon />
                  ) : icon === null ? (
                    <WalletFallbackIcon />
                  ) : (
                    <Image
                      className="wallet-provider-icon"
                      src={icon}
                      width={38}
                      height={38}
                      alt=""
                      unoptimized
                    />
                  )}
                  <span className="wallet-provider-name">
                    <strong>{item.info.name}</strong>
                  </span>
                  <span className="wallet-provider-arrow" aria-hidden="true">
                    →
                  </span>
                </button>
              );
            })}
          </div>
        )}
        {message !== null && (
          <p role="alert" className="wallet-dialog-message">
            {message}
          </p>
        )}
      </ModalDialog>

      <ModalDialog
        open={accountDialogOpen && address !== null}
        titleId="wallet-account-title"
        onClose={() => setAccountDialogOpen(false)}
      >
        <div className="wallet-dialog-header">
          <div>
            <span className="eyebrow">Connected account</span>
            <h2 id="wallet-account-title">Wallet</h2>
          </div>
          <button
            type="button"
            className="wallet-dialog-close"
            aria-label="Close account dialog"
            onClick={() => setAccountDialogOpen(false)}
          >
            ×
          </button>
        </div>
        {address !== null && (
          <div className="wallet-account-address">
            <span title={address}>{truncateWalletAddress(address)}</span>
            <button
              type="button"
              className="secondary btn-sm"
              onClick={() => {
                void navigator.clipboard
                  .writeText(address)
                  .then(() => setCopied(true))
                  .catch(() => undefined);
              }}
            >
              {copied ? "Copied" : "Copy address"}
            </button>
          </div>
        )}
        <div className="wallet-network-row">
          <span>Network</span>
          <strong>
            {chainId === PRODUCT_WALLET_NETWORK.chainIdNumber
              ? PRODUCT_WALLET_NETWORK.displayName
              : "Wrong network"}
          </strong>
        </div>
        {chainId !== PRODUCT_WALLET_NETWORK.chainIdNumber ? (
          <div className="wallet-dialog-callout warning">
            <div className="wallet-callout-text">
              <strong>
                Pact requires {PRODUCT_WALLET_NETWORK.displayName}
              </strong>
              <small>Switch networks to interact with contracts.</small>
            </div>
            <button
              type="button"
              className="wallet-dialog-action"
              onClick={() => void switchNetwork()}
              disabled={busy}
            >
              Switch to {PRODUCT_WALLET_NETWORK.displayName}
            </button>
          </div>
        ) : !authenticated ? (
          <div className="wallet-dialog-callout">
            <div className="wallet-callout-text">
              <strong>Sign in to Pact</strong>
              <small>No transaction or gas required.</small>
            </div>
            <button
              type="button"
              className="wallet-dialog-action"
              onClick={() => void authenticate()}
              disabled={busy}
            >
              Sign in to Pact
            </button>
          </div>
        ) : null}
        <button
          type="button"
          className="secondary wallet-disconnect"
          onClick={() => void disconnect()}
          disabled={busy}
        >
          Disconnect
        </button>
        {message !== null && (
          <p role="alert" className="wallet-dialog-message">
            {message}
          </p>
        )}
      </ModalDialog>
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletContextValue {
  const value = useContext(WalletContext);
  if (value === null) throw new Error("WalletBoundary is required");
  return value;
}

export function WalletHeaderControl() {
  // Public wallet connection control is disabled in production demonstration mode.
  // Connect wallet implementation preserved for future Mainnet migration.
  return null;
}

export function WalletRequirement() {
  const wallet = useWallet();
  if (
    wallet.address !== null &&
    wallet.chainId === PRODUCT_WALLET_NETWORK.chainIdNumber &&
    wallet.authenticated
  ) {
    return null;
  }
  if (wallet.address === null) {
    return (
      <div className="wallet-requirement">
        <div className="wallet-requirement-copy">
          <strong>Client wallet required</strong>
          <span>Connect your client wallet to create this Pact.</span>
          {wallet.message !== null && (
            <span role="alert" className="wallet-requirement-message">
              {wallet.message}
            </span>
          )}
        </div>
        <button type="button" onClick={wallet.openConnectModal}>
          Connect to continue
        </button>
      </div>
    );
  }
  if (wallet.chainId !== PRODUCT_WALLET_NETWORK.chainIdNumber) {
    return (
      <div className="wallet-requirement wallet-requirement-warning">
        <div className="wallet-requirement-copy">
          <strong>Wrong network</strong>
          <span>
            Switch to {PRODUCT_WALLET_NETWORK.displayName} to continue.
          </span>
          {wallet.message !== null && (
            <span role="alert" className="wallet-requirement-message">
              {wallet.message}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => void wallet.switchNetwork()}
          disabled={wallet.busy}
        >
          Switch to {PRODUCT_WALLET_NETWORK.displayName}
        </button>
      </div>
    );
  }
  return (
    <div className="wallet-requirement">
      <div className="wallet-requirement-copy">
        <strong>Sign in to Pact</strong>
        <span>
          Sign a message to verify this wallet. No transaction or gas required.
        </span>
        {wallet.message !== null && (
          <span role="alert" className="wallet-requirement-message">
            {wallet.message}
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={() => void wallet.authenticate()}
        disabled={wallet.busy}
      >
        Sign in to Pact
      </button>
    </div>
  );
}
