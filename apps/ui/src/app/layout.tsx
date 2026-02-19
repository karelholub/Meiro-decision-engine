import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Decisioning Extension",
  description: "MVP decisioning service for Meiro CDP profiles"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <div className="mx-auto flex min-h-screen max-w-7xl flex-col px-4 py-6 md:px-8">
          <header className="mb-6 panel p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h1 className="text-xl font-semibold tracking-tight">Decisioning Extension</h1>
              <nav className="flex flex-wrap gap-2 text-sm">
                <Link className="rounded-md border border-stone-300 px-3 py-1 hover:bg-stone-100" href="/decisions">
                  Decisions
                </Link>
                <Link className="rounded-md border border-stone-300 px-3 py-1 hover:bg-stone-100" href="/simulator">
                  Simulator
                </Link>
                <Link className="rounded-md border border-stone-300 px-3 py-1 hover:bg-stone-100" href="/logs">
                  Logs
                </Link>
              </nav>
            </div>
          </header>
          <main className="flex-1">{children}</main>
        </div>
      </body>
    </html>
  );
}
