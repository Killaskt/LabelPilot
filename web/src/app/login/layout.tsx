// Overrides the root layout so the login page has no nav
export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
