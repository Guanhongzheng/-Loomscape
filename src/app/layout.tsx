import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Toaster } from '@/components/ui/toast';
import { ServiceWorker } from '@/components/service-worker';
import { MotionProvider } from '@/components/motion-provider';
import { CursorMode } from '@/components/cursor/cursor-mode';

export const metadata: Metadata = {
  title: {
    default: '织境 Loomscape · 浏览器 AI 光标',
    template: '%s · 织境',
  },
  description:
    '一个看得见、可暂停、可接管的浏览器 AI 光标。找到按钮、填写表单、滚动页面，危险动作先确认。',
  applicationName: 'Loomscape',
  authors: [{ name: 'Loomscape' }],
  keywords: ['创意工具', '工作台', '文本', '图像', '声音', '影像', 'Loomscape'],
  manifest: '/manifest.webmanifest',
  openGraph: {
    title: '织境 Loomscape · 浏览器 AI 光标',
    description: '让 AI 光标，替你在浏览器里做事。',
    type: 'website',
  },
};

export const viewport: Viewport = {
  themeColor: '#efe6d9',
  width: 'device-width',
  initialScale: 1,
};

/**
 * Every route renders per request. The CSP nonce is generated in middleware,
 * and a page built at build time would ship scripts without it — the browser
 * would then refuse to run them. This is the price of dropping
 * `'unsafe-inline'` from `script-src`.
 */
export const dynamic = 'force-dynamic';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-[100dvh] font-sans antialiased">
        <MotionProvider>
          {children}
          <CursorMode />
          <Toaster />
        </MotionProvider>
        <ServiceWorker />
      </body>
    </html>
  );
}
