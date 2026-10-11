import Link from 'next/link';
import { env } from '@/lib/env';

export default function PrivacyPage() {
  return (
    <main className="mx-auto min-h-screen max-w-3xl px-6 py-12 text-cordly-text">
      <Link href="/" className="text-sm text-cordly-accent hover:underline">Back to {env.APP_NAME}</Link>
      <h1 className="mt-8 text-3xl font-bold">Privacy Policy</h1>
      <p className="mt-3 text-sm text-cordly-muted">Information handled by {env.APP_NAME}</p>
      <div className="mt-8 space-y-6 text-sm leading-7 text-cordly-secondary">
        <section>
          <h2 className="text-base font-semibold text-cordly-text">Information stored</h2>
          <p className="mt-2">The application stores account details, profile and preference settings, community membership, friend relationships, messages, reactions, and files you submit. Active session records may include sign-in time, expiry, browser user-agent, and IP address to support session management and security.</p>
        </section>
        <section>
          <h2 className="text-base font-semibold text-cordly-text">How it is used</h2>
          <p className="mt-2">This information is used to authenticate accounts, deliver chat and community features, enforce access controls, show your selected profile and presence, and provide account security features. Authenticator secrets are encrypted before storage; backup codes are stored as hashes.</p>
        </section>
        <section>
          <h2 className="text-base font-semibold text-cordly-text">Your controls</h2>
          <p className="mt-2">You can change profile and privacy settings, revoke active sessions, export account data, and disable your account in settings. Community members can see information needed to use the communities and profiles you participate in; your time-zone identifier is not exposed to other members.</p>
        </section>
        <section>
          <h2 className="text-base font-semibold text-cordly-text">Deployment operator</h2>
          <p className="mt-2">The operator of this {env.APP_NAME} deployment manages its database, hosting, retention, and contact process. Contact that operator for privacy requests or questions about how this deployment handles data.</p>
        </section>
      </div>
      <Link href="/terms" className="mt-8 inline-block text-sm text-cordly-accent hover:underline">Terms of Service</Link>
    </main>
  );
}
