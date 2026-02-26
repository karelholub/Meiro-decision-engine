import type { Metadata } from "next";
import AppShell from "../components/app-shell/app-shell";
import { PermissionProvider } from "../lib/permissions";
import "./globals.css";

export const metadata: Metadata = {
  title: "Decisioning Extension",
  description: "MVP decisioning service for Meiro CDP profiles"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <PermissionProvider>
          <AppShell>{children}</AppShell>
        </PermissionProvider>
      </body>
    </html>
  );
}
