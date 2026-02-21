export const metadata = {
  title: 'LeadGuard Dashboard',
};

export default function RootLayout({ children }) {
  return (
    <html lang="pl">
      <body style={{ fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif', margin: 0 }}>
        {children}
      </body>
    </html>
  );
}
