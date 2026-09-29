/** Wraps the sign-up and log-in pages: plain white page, no app sidebar (mockups 02, 03). */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-card">{children}</div>;
}