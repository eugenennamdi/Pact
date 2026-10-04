import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  description: "Programmable settlement for verifiable outcomes.",
  title: "Pact",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <Link href="/" className="brand">
            Pact
          </Link>
          <nav aria-label="Primary navigation">
            <Link href="/create">Create Pact</Link>
            <Link href="/proof/arc-mainnet/job/1">Mainnet proof</Link>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
