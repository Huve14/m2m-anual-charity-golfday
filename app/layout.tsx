import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "M2M Charity Golf Day | Four-ball Registration",
  description: "Register your team or book one or more four-balls for the M2M Charity Golf Day.",
  openGraph: {
    title: "M2M Charity Golf Day | Four-ball Registration",
    description: "Bring your team to the green and make your four-ball count.",
    images: ["/m2m-golf-social.png"],
  },
  icons: {
    icon: "/favicon.svg",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
