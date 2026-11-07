'use client';

/**
 * The root layout itself crashed. Without this Next falls back to its own
 * error page, which is a blank white screen with no way back — for a
 * local-first app the useful action is reload, not a stack trace.
 */
export default function GlobalError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="zh-CN">
      <body
        style={{
          minHeight: '100dvh',
          margin: 0,
          display: 'grid',
          placeItems: 'center',
          background: '#f6f2ea',
          color: '#1b1814',
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
        }}
      >
        <main style={{ maxWidth: 420, padding: 24, textAlign: 'center' }}>
          <h1 style={{ fontSize: 18, fontWeight: 500, margin: 0 }}>界面没能加载出来</h1>
          <p style={{ fontSize: 13.5, lineHeight: 1.7, opacity: 0.75, margin: '10px 0 18px' }}>
            本地数据（作品、记忆、模型权重）都还在浏览器里，刷新不会丢。
          </p>
          <p
            style={{
              fontSize: 11,
              lineHeight: 1.6,
              opacity: 0.55,
              margin: '0 0 18px',
              wordBreak: 'break-word',
            }}
          >
            {error.message}
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              height: 36,
              padding: '0 18px',
              borderRadius: 999,
              border: '1px solid #1e3f3a',
              background: '#1e3f3a',
              color: '#fffdf8',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            重试
          </button>
        </main>
      </body>
    </html>
  );
}
