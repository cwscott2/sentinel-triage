export const metadata = {
  title: "Sentinel Triage",
  description: "Vendor AI governance triage — citation-backed risk register entries",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif", margin: 0, background: "#fafaf9", color: "#1c1917" }}>
        {children}
      </body>
    </html>
  );
}
