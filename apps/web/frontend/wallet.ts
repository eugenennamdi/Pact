import {
  DEFAULT_PRODUCT_NETWORK,
  type ProductNetworkConfig,
} from "../../../packages/product/src/network";

export const PRODUCT_WALLET_NETWORK = DEFAULT_PRODUCT_NETWORK;

export interface Eip1193RequestArguments {
  readonly method: string;
  readonly params?: readonly unknown[] | object;
}

export interface Eip1193Provider {
  request(arguments_: Eip1193RequestArguments): Promise<unknown>;
  on?(event: string, listener: (...arguments_: unknown[]) => void): void;
  removeListener?(
    event: string,
    listener: (...arguments_: unknown[]) => void,
  ): void;
}

export interface WalletProviderInfo {
  readonly uuid: string;
  readonly name: string;
  readonly icon: string;
  readonly rdns: string;
}

export interface DiscoveredWalletProvider {
  readonly info: WalletProviderInfo;
  readonly provider: Eip1193Provider;
  readonly legacy: boolean;
}

interface DiscoveryTarget {
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
  dispatchEvent(event: Event): boolean;
}

interface ProviderAnnouncement extends Event {
  readonly detail?: {
    readonly info?: WalletProviderInfo;
    readonly provider?: Eip1193Provider;
  };
}

function validInfo(value: unknown): value is WalletProviderInfo {
  if (typeof value !== "object" || value === null) return false;
  const info = value as Partial<WalletProviderInfo>;
  return [info.uuid, info.name, info.icon, info.rdns].every(
    (item) => typeof item === "string" && item.length > 0,
  );
}

export class WalletDiscovery {
  readonly #target: DiscoveryTarget;
  readonly #legacyProvider: Eip1193Provider | undefined;
  readonly #providers = new Map<string, DiscoveredWalletProvider>();
  readonly #subscribers = new Set<
    (providers: readonly DiscoveredWalletProvider[]) => void
  >();
  #started = false;

  constructor(target: DiscoveryTarget, legacyProvider?: Eip1193Provider) {
    this.#target = target;
    this.#legacyProvider = legacyProvider;
  }

  readonly #announce = (event: Event): void => {
    const detail = (event as ProviderAnnouncement).detail;
    const provider = detail?.provider;
    if (
      detail === undefined ||
      !validInfo(detail.info) ||
      provider === undefined ||
      typeof provider.request !== "function"
    ) {
      return;
    }
    this.#providers.set(detail.info.uuid, {
      info: detail.info,
      provider,
      legacy: false,
    });
    this.#emit();
  };

  #emit(): void {
    const snapshot = this.providers();
    for (const subscriber of this.#subscribers) subscriber(snapshot);
  }

  start(): void {
    if (this.#started) return;
    this.#started = true;
    this.#target.addEventListener(
      "eip6963:announceProvider",
      this.#announce as EventListener,
    );
    this.#target.dispatchEvent(new Event("eip6963:requestProvider"));
    queueMicrotask(() => {
      if (this.#providers.size === 0 && this.#legacyProvider !== undefined) {
        this.#providers.set("legacy-window-ethereum", {
          info: {
            uuid: "legacy-window-ethereum",
            name: "Browser wallet",
            icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>",
            rdns: "legacy.window.ethereum",
          },
          provider: this.#legacyProvider,
          legacy: true,
        });
        this.#emit();
      }
    });
  }

  stop(): void {
    if (!this.#started) return;
    this.#target.removeEventListener(
      "eip6963:announceProvider",
      this.#announce as EventListener,
    );
    this.#started = false;
  }

  subscribe(
    subscriber: (providers: readonly DiscoveredWalletProvider[]) => void,
  ): () => void {
    this.#subscribers.add(subscriber);
    subscriber(this.providers());
    return () => this.#subscribers.delete(subscriber);
  }

  providers(): readonly DiscoveredWalletProvider[] {
    return [...this.#providers.values()].sort((left, right) =>
      left.info.name.localeCompare(right.info.name),
    );
  }
}

export function parseWalletChainId(value: unknown): number {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/i.test(value)) {
    throw new Error("INVALID_WALLET_CHAIN_ID");
  }
  const parsed = Number.parseInt(value.slice(2), 16);
  if (!Number.isSafeInteger(parsed)) throw new Error("INVALID_WALLET_CHAIN_ID");
  return parsed;
}

function firstAddress(value: unknown): `0x${string}` {
  if (
    !Array.isArray(value) ||
    typeof value[0] !== "string" ||
    !/^0x[0-9a-f]{40}$/i.test(value[0])
  ) {
    throw new Error("WALLET_ACCOUNT_UNAVAILABLE");
  }
  return value[0] as `0x${string}`;
}

export async function connectWallet(provider: Eip1193Provider): Promise<{
  readonly address: `0x${string}`;
  readonly chainId: number;
}> {
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  const chain = await provider.request({ method: "eth_chainId" });
  return Object.freeze({
    address: firstAddress(accounts),
    chainId: parseWalletChainId(chain),
  });
}

export async function switchToProductNetwork(
  provider: Eip1193Provider,
  network: ProductNetworkConfig = PRODUCT_WALLET_NETWORK,
): Promise<void> {
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: network.hexChainId }],
    });
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? Number(error.code)
        : undefined;
    if (code !== 4902) throw error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: network.hexChainId,
          chainName: network.displayName,
          nativeCurrency: network.nativeCurrency,
          rpcUrls: [network.defaultPublicRpcUrl],
        },
      ],
    });
  }
}

export function bindWalletEvents(
  provider: Eip1193Provider,
  handlers: {
    readonly accountsChanged: (accounts: readonly string[]) => void;
    readonly chainChanged: (chainId: number) => void;
    readonly disconnected: () => void;
  },
): () => void {
  const accountListener = (...arguments_: unknown[]) => {
    const accounts = arguments_[0];
    handlers.accountsChanged(
      Array.isArray(accounts)
        ? accounts.filter((item): item is string => typeof item === "string")
        : [],
    );
  };
  const chainListener = (...arguments_: unknown[]) => {
    handlers.chainChanged(parseWalletChainId(arguments_[0]));
  };
  const disconnectListener = () => handlers.disconnected();
  provider.on?.("accountsChanged", accountListener);
  provider.on?.("chainChanged", chainListener);
  provider.on?.("disconnect", disconnectListener);
  return () => {
    provider.removeListener?.("accountsChanged", accountListener);
    provider.removeListener?.("chainChanged", chainListener);
    provider.removeListener?.("disconnect", disconnectListener);
  };
}
