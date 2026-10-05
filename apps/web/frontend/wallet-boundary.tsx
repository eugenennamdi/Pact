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
  ARC_TESTNET_CHAIN_ID,
  WalletDiscovery,
  bindWalletEvents,
  connectWallet,
  switchToArcTestnet,
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

  useEffect(() => {
    if (provider === null || address === null) return;
    return bindWalletEvents(provider, {
      accountsChanged: (accounts) => {
        clearSession();
        const next = accounts[0];
        setAddress(
          next !== undefined && /^0x[0-9a-f]{40}$/i.test(next)
            ? (next as `0x${string}`)
            : null,
        );
        setAccountDialogOpen(false);
      },
      chainChanged: (nextChainId) => {
        clearSession();
        setChainId(nextChainId);
      },
      disconnected: () => {
        clearSession();
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
      setBusy(true);
      setMessage(null);
      try {
        const connected = await connectWallet(selected.provider);
        setAddress(connected.address);
        setChainId(connected.chainId);
        setConnectModalOpen(false);
      } catch (error) {
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
      setSession(
        await authenticateWallet({ client: api, provider, address, chainId }),
      );
    } catch (error) {
      setSession(null);
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
      await switchToArcTestnet(provider);
      const connected = await connectWallet(provider);
      setAddress(connected.address);
      setChainId(connected.chainId);
      setSession(null);
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
          <div>
            <span className="eyebrow">Arc Testnet</span>
            <h2 id="connect-wallet-title">Connect a wallet</h2>
          </div>
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
                  disabled={busy}
                  onClick={() => void connectProvider(item.info.uuid)}
                >
                  {icon === null ? (
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
                    <span>{item.info.rdns}</span>
                  </span>
                  <span aria-hidden="true">→</span>
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
            {chainId === ARC_TESTNET_CHAIN_ID ? "Arc Testnet" : "Wrong network"}
          </strong>
        </div>
        {chainId !== ARC_TESTNET_CHAIN_ID ? (
          <button
            type="button"
            className="wallet-dialog-action"
            onClick={() => void switchNetwork()}
            disabled={busy}
          >
            Switch to Arc Testnet
          </button>
        ) : !authenticated ? (
          <button
            type="button"
            className="wallet-dialog-action"
            onClick={() => void authenticate()}
            disabled={busy}
          >
            Sign in to Pact
          </button>
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
  const wallet = useWallet();
  if (wallet.address === null) {
    return (
      <button
        type="button"
        className="wallet-trigger"
        onClick={wallet.openConnectModal}
      >
        Connect wallet
      </button>
    );
  }
  const wrongNetwork = wallet.chainId !== ARC_TESTNET_CHAIN_ID;
  return (
    <button
      type="button"
      className={`account-trigger${wrongNetwork ? " account-trigger-warning" : ""}`}
      aria-label={`Open wallet account ${truncateWalletAddress(wallet.address)}`}
      onClick={wallet.openAccountDialog}
    >
      <span className="account-status-dot" aria-hidden="true" />
      {truncateWalletAddress(wallet.address)}
    </button>
  );
}

export function WalletRequirement() {
  const wallet = useWallet();
  if (
    wallet.address !== null &&
    wallet.chainId === ARC_TESTNET_CHAIN_ID &&
    wallet.authenticated
  ) {
    return null;
  }
  if (wallet.address === null) {
    return (
      <div className="wallet-requirement">
        <div>
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
  if (wallet.chainId !== ARC_TESTNET_CHAIN_ID) {
    return (
      <div className="wallet-requirement wallet-requirement-warning">
        <div>
          <span>Switch to Arc Testnet to continue.</span>
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
          Switch to Arc Testnet
        </button>
      </div>
    );
  }
  return (
    <div className="wallet-requirement">
      <div>
        <span>Sign in to create a Pact with this wallet.</span>
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
