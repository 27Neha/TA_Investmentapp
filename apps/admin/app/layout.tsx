export const metadata = { title: 'TechArtha Admin' };
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', margin: 0, color: '#16162A', background: '#F5F5FA' }}>
        <header style={{ background: '#fff', borderBottom: '1px solid #D9D9E6', padding: '12px 24px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <img src="/techartha-logo.png" alt="TechArtha — Finance Simplified" height={36} />
          <strong style={{ color: '#3D3B8E' }}>Admin Console</strong>
        </header>
        <main style={{ maxWidth: 880, margin: '24px auto', padding: '0 16px' }}>{children}</main>
      </body>
    </html>
  );
}
