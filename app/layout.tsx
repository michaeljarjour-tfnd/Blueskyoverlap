import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Bluesky Overlap — Audience Overlap Analyzer',
  description:
    'Compare Bluesky audiences instantly. Find collaboration partners, measure shared followers, and analyze audience crossover across up to 5 accounts.',
  openGraph: {
    title: 'Bluesky Overlap',
    description: 'Find your Bluesky audience overlap in seconds.',
    type: 'website',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
