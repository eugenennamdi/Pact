"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

interface WalletContextValue {
  readonly providers: readonly DiscoveredWalletProvider[];
  readonly selectedProviderId: string | null;
  readonly provider: Eip1193Provider | null;
  readonly address: `0x${string}` | null;
  readonly chainId: number | null;
  readonly authenticated: boolean;
  readonly busy: boolean;
  readonly message: string | null;
  selectProvider(id: string): void;
  connect(): Promise<void>;
  authenticate(): Promise<void>;
  switchNetwork(): Promise<void>;
  disconnect(): Promise<void>;
  invalidateAuthentication(): void;
}

const WalletContext = createContext<WalletContextValue | null>(null);
const api = createProductApiClient();

function safeMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.message === "WRONG_NETWORK") return "WRONG_NETWORK";
    if (error.message.includes("rejected") || error.message.includes("4001"))
      return "The wallet request was rejected.";
  }
  return "The wallet request could not be completed.";
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
    const unsubscribe = discovery.subscribe((next) => {
      setProviders(next);
    });
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
      },
      chainChanged: (nextChainId) => {
        clearSession();
        setChainId(nextChainId);
      },
      disconnected: () => {
        clearSession();
        setAddress(null);
        setChainId(null);
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

  const selectProvider = useCallback((id: string) => {
    setSelectedProviderId(id);
    setAddress(null);
    setChainId(null);
    setSession(null);
    setMessage(null);
  }, []);

  const connect = useCallback(async () => {
    if (provider === null) {
      setMessage("Choose a wallet provider first.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const connected = await connectWallet(provider);
      setAddress(connected.address);
      setChainId(connected.chainId);
      setSession(null);
      if (connected.chainId !== ARC_TESTNET_CHAIN_ID)
        setMessage("WRONG_NETWORK");
    } catch (error) {
      setMessage(safeMessage(error));
    } finally {
      setBusy(false);
    }
  }, [provider]);

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
      setMessage(safeMessage(error));
    } finally {
      setBusy(false);
    }
  }, [address, chainId, provider]);

  const switchNetwork = useCallback(async () => {
    if (provider === null) return;
    setBusy(true);
    setMessage(null);
    try {
      await switchToArcTestnet(provider);
      const connected = await connectWallet(provider);
      setAddress(connected.address);
      setChainId(connected.chainId);
      setSession(null);
    } catch (error) {
      setMessage(safeMessage(error));
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
      setAddress(null);
      setChainId(null);
      setSession(null);
      setMessage(null);
      setBusy(false);
    }
  }, []);

  const authenticated = isBrowserSessionValid(session, address, chainId);
  const value = useMemo<WalletContextValue>(
    () => ({
      providers,
      selectedProviderId,
      provider,
      address,
      chainId,
      authenticated,
      busy,
      message,
      selectProvider,
      connect,
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
      connect,
      disconnect,
      clearSession,
      message,
      provider,
      providers,
      selectProvider,
      selectedProviderId,
      switchNetwork,
    ],
  );
  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}

export function useWallet(): WalletContextValue {
  const value = useContext(WalletContext);
  if (value === null) throw new Error("WalletBoundary is required");
  return value;
}

export function WalletControls() {
  const wallet = useWallet();
  return (
    <section className="card wallet-panel" aria-labelledby="wallet-heading">
      <div className="card-header">
        <div className="card-title-group">
          <h2 id="wallet-heading">Wallet connection</h2>
          <p className="card-description">
            Connect and authenticate to prepare and sign onchain actions on Arc
            Testnet.
          </p>
        </div>
        {wallet.address !== null && (
          <span
            className={`badge ${
              wallet.chainId !== ARC_TESTNET_CHAIN_ID
                ? "badge-error"
                : wallet.authenticated
                  ? "badge-verified"
                  : "badge-pending"
            }`}
          >
            <span className="badge-dot" />
            {wallet.chainId !== ARC_TESTNET_CHAIN_ID
              ? "Wrong Network"
              : wallet.authenticated
                ? "Authenticated"
                : "Needs Sign-in"}
          </span>
        )}
      </div>

      {wallet.providers.length === 0 ? (
        <p className="form-hint" style={{ margin: "0.5rem 0" }}>
          No EVM browser wallet detected. Install a Web3 wallet extension like
          MetaMask, Rabby, or Coinbase Wallet.
        </p>
      ) : (
        <div className="form-group" style={{ marginBottom: "1rem" }}>
          <label>
            <span>Wallet provider</span>
            <select
              value={wallet.selectedProviderId ?? ""}
              onChange={(event) => wallet.selectProvider(event.target.value)}
              disabled={wallet.busy}
            >
              <option value="" disabled>
                Choose wallet provider
              </option>
              {wallet.providers.map((item) => (
                <option key={item.info.uuid} value={item.info.uuid}>
                  {item.info.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {wallet.address === null ? (
        <div className="actions" style={{ margin: "0.75rem 0 0 0" }}>
          <button
            type="button"
            onClick={() => void wallet.connect()}
            disabled={wallet.busy || wallet.selectedProviderId === null}
          >
            Connect wallet
          </button>
        </div>
      ) : (
        <div className="stack" style={{ gap: "0.85rem" }}>
          <dl style={{ margin: 0 }}>
            <dt>Connected address</dt>
            <dd>
              <span className="tech-address-wrapper">
                <code className="tech-hash">{wallet.address}</code>
              </span>
            </dd>
            <dt>Network</dt>
            <dd>
              <span className="network-badge">
                <span className="network-indicator" />
                {wallet.chainId === ARC_TESTNET_CHAIN_ID
                  ? "Arc Testnet (5042002)"
                  : `Wrong network (${wallet.chainId ?? "unknown"})`}
              </span>
            </dd>
            <dt>Session status</dt>
            <dd>
              {wallet.authenticated ? (
                <span
                  role="status"
                  style={{ color: "var(--accent-verified)", fontWeight: 600 }}
                >
                  Active authenticated session
                </span>
              ) : (
                <span
                  style={{ color: "var(--accent-pending)", fontWeight: 550 }}
                >
                  Signature challenge required
                </span>
              )}
            </dd>
          </dl>

          <div className="actions" style={{ margin: "0.5rem 0 0 0" }}>
            {wallet.chainId !== ARC_TESTNET_CHAIN_ID ? (
              <button
                type="button"
                onClick={() => void wallet.switchNetwork()}
                disabled={wallet.busy}
              >
                Switch to Arc Testnet
              </button>
            ) : wallet.authenticated ? null : (
              <button
                type="button"
                onClick={() => void wallet.authenticate()}
                disabled={wallet.busy}
              >
                Sign in with wallet
              </button>
            )}
            <button
              type="button"
              className="secondary"
              onClick={() => void wallet.disconnect()}
              disabled={wallet.busy}
            >
              Disconnect
            </button>
          </div>
        </div>
      )}

      {wallet.message !== null && (
        <p role="alert" className="error" style={{ marginTop: "1rem" }}>
          {wallet.message}
        </p>
      )}
    </section>
  );
}
