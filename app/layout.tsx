import type { Metadata, Viewport } from "next";
import "./globals.css";
import { DataProvider } from "./context/DataContext";

export const metadata: Metadata = {
  title: {
    default: "FRT Barabanki - Supply Complaint Report",
    template: "%s | FRT Barabanki",
  },
  description: "Analyze, filter and export supply complaint reports for Barabanki.",
  applicationName: "FRT Barabanki Report",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        suppressHydrationWarning
        className="antialiased"
      >
        <DataProvider>{children}</DataProvider>
      </body>
    </html>
  );
}
