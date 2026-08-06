import type { Metadata } from "next";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "STRIKE AP",
  description: "Autonomous SAP Accounts Payable — upload a batch, approve once, park in SAP.",
};

// The page reads the saved theme in an effect, which is correct for hydration
// but repaints: a presenter whose machine is set to light watches the app load
// dark and then flip. This runs before the body is parsed, so the first painted
// frame is already the right theme. It only ever sets the same attribute the
// page's own effect sets, so the two cannot disagree.
const THEME_BOOTSTRAP =
  'try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark"){document.documentElement.dataset.theme=t}}catch(e){}';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body className="antialiased">
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: a fixed literal with no interpolation, and it has to run before first paint */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
        {children}
      </body>
    </html>
  );
}
