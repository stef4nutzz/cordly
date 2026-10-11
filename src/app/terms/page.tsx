import Link from 'next/link';
import { env } from '@/lib/env';

export default function TermsPage() {
  return (
    <main className="mx-auto min-h-screen max-w-3xl px-6 py-12 text-cordly-text">
      <Link href="/" className="text-sm text-cordly-accent hover:underline">Back to {env.APP_NAME}</Link>
      <h1 className="mt-8 text-3xl font-bold">Terms of Service</h1>
      <p className="mt-3 text-sm text-cordly-muted">Using {env.APP_NAME}</p>
      <div className="mt-8 space-y-6 text-sm leading-7 text-cordly-secondary">
        <section>
          <h2 className="text-base font-semibold text-cordly-text">Using the service</h2>
          <p className="mt-2">Use your account lawfully and do not interfere with the service, attempt unauthorized access, or use the service to harass, threaten, or harm others. You are responsible for activity performed through your account and for keeping your sign-in credentials secure.</p>
        </section>
        <section>
          <h2 className="text-base font-semibold text-cordly-text">Your content</h2>
          <p className="mt-2">You retain responsibility for the messages, files, and profile information you submit. You must have the rights needed to share that content. The service processes and stores submitted content so it can provide chat, profile, and attachment features.</p>
        </section>
        <section>
          <h2 className="text-base font-semibold text-cordly-text">Availability and accounts</h2>
          <p className="mt-2">Features may change as the application is maintained. Accounts may be disabled when required to protect the service or address misuse. You can export your account data and disable your account from account settings.</p>
        </section>
        <section>
          <h2 className="text-base font-semibold text-cordly-text">Contact</h2>
          <p className="mt-2">For questions about these terms, contact the operator of this {env.APP_NAME} deployment.</p>
        </section>
      </div>
      <Link href="/privacy" className="mt-8 inline-block text-sm text-cordly-accent hover:underline">Privacy Policy</Link>
    </main>
  );
}
