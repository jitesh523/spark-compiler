import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Spark — A little code. A lot of possibility.',
  description: 'Your no-login coding workspace. Run Python, JavaScript, and TypeScript, fix errors with AI, and understand every line.'
};

export default function RootLayout({children}: Readonly<{children:React.ReactNode}>) {
  return <html lang="en"><body>{children}</body></html>;
}
