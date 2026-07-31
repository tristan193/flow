import { passcodesConfigured } from "@/lib/auth";

import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const configured = passcodesConfigured();

  return (
    <main className="flex flex-1 items-center justify-center px-5 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight">Flow</h1>
          <p className="text-ink-dim mt-1 text-sm">Nails &amp; Mercy deal flow</p>
        </div>

        {configured ? (
          <LoginForm next={next} />
        ) : (
          <div className="border-line bg-surface rounded-xl border p-4 text-sm">
            <p className="text-flag font-medium">Not configured yet</p>
            <p className="text-ink-dim mt-2 leading-relaxed">
              No passcodes are set on the server. Add{" "}
              <code className="text-ink font-mono text-xs">FLOW_PASSCODE_TRISTAN</code> and{" "}
              <code className="text-ink font-mono text-xs">FLOW_PASSCODE_PARTNER</code> to the
              environment, then reload.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
