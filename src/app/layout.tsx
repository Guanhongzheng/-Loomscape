import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Toaster } from '@/components/ui/toast';

export const metadata: Metadata = {
  title: {
    default: '织境 Loomscape · 多模态创意工作台',
    template: '%s · 织境',
  },
  description:
    '把文字、画面、声音与时间放进同一张工作台。从一句提纲到一支成片，本地优先，配置与作品留在浏览器。',
  applicationName: 'Loomscape',
  authors: [{ name: 'Loomscape' }],
  keywords: ['创意工具', '工作台', '文本', '图像', '声音', '影像', 'Loomscape'],
  openGraph: {
    title: '织境 Loomscape',
    description: '把散落的材料，织成一件作品。',
    type: 'website',
  },
};

export const viewport: Viewport = {
  themeColor: '#edf0f4',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-[100dvh] font-sans antialiased">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
