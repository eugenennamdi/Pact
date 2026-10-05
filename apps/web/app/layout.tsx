import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  WalletBoundary,
  WalletHeaderControl,
} from "../frontend/wallet-boundary";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pact — Programmable settlement for verifiable outcomes",
  description:
    "Lock USDC against an outcome. Prove the outcome happened. Settle through ERC-8183 on Arc.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <WalletBoundary>
          <header className="site-header">
            <div className="site-header-inner">
              <div className="brand-wrapper">
                <Link href="/" className="brand" aria-label="Pact Home">
                  <span className="brand-mark" aria-hidden="true">
                    P
                  </span>
                  <span>Pact</span>
                </Link>
                <span
                  className="network-badge"
                  title="Interactive Arc Testnet Environment"
                >
                  <span className="network-indicator" aria-hidden="true" />
                  Arc Testnet
                </span>
              </div>
              <div className="nav-actions">
                <nav className="nav-links" aria-label="Primary navigation">
                  <Link href="/create" className="nav-link">
                    Create Pact
                  </Link>
                  <Link href="/proof/arc-mainnet/job/1" className="nav-link">
                    Mainnet proof
                  </Link>
                </nav>
                <WalletHeaderControl />
              </div>
            </div>
          </header>
          {children}
          <footer className="site-footer">
            <div className="site-footer-inner">
              <div>
                <strong>Pact</strong> — Programmable settlement for objectively
                verifiable outcomes.
              </div>
              <div className="footer-links">
                <span>ERC-8183 Escrow</span>
                <span>PactEvaluator</span>
                <Link href="/proof/arc-mainnet/job/1">
                  Certified Mainnet Proof
                </Link>
              </div>
            </div>
          </footer>
        </WalletBoundary>
      </body>
    </html>
  );
}
