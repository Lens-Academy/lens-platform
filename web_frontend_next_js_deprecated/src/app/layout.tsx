import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { GlobalComponents } from "@/components/GlobalComponents";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Lens Academy | AI Safety Course",
  description:
    "A free, high quality course on AI existential risk. No gatekeeping, no application process.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <Providers>
          {children}
          <GlobalComponents />
        </Providers>
      </body>
    </html>
  );
}
