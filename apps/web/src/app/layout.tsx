import type { Metadata } from "next";
import "@fontsource-variable/inter";
import "@fontsource-variable/newsreader";
import "../../../../design/tokens.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "AILI",
  description: "Artificial Intelligence Learning Interface",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
