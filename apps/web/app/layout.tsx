import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  WalletBoundary,
  WalletHeaderControl,
} from "../frontend/wallet-boundary";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://pact-web-production-ea97.up.railway.app"),
  title: "Pact — Outcome verification for ERC-8183 settlement",
  description:
    "Pact verifies objective external outcomes and turns them into evidence-linked ERC-8183 USDC settlement decisions on Arc.",
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
    shortcut: "/favicon.svg",
    apple: [
      {
        url: "/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "Pact",
    title: "Pact — Outcome verification for ERC-8183 settlement",
    description:
      "Pact verifies objective external outcomes and turns them into evidence-linked ERC-8183 USDC settlement decisions on Arc.",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "Pact — Objective outcomes. ERC-8183 settlement. Live on Arc Mainnet.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Pact — Outcome verification for ERC-8183 settlement",
    description:
      "Pact verifies objective external outcomes and turns them into evidence-linked ERC-8183 USDC settlement decisions on Arc.",
    images: ["/og.png"],
  },
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
              </div>
              <div className="nav-actions">
                <nav className="nav-links" aria-label="Primary navigation">
                  <Link href="/proof" className="nav-link">
                    Proof Center
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
                <Link href="/proof">Proof Center</Link>
              </div>
            </div>
          </footer>
        </WalletBoundary>
      </body>
    </html>
  );
}
