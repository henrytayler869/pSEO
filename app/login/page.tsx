import { LoginForm } from "@/components/login-form";

/**
 * The one page outside the gate (see middleware.ts).
 *
 * Rendered dynamically so it never gets prerendered and cached: a login page
 * served from a cache is the kind of thing that hands one person's session
 * state to the next visitor.
 */
export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  // Only a path from our own site is carried through. A caller-supplied
  // absolute URL here is how a login form turns into an open redirect, so the
  // value is filtered on the way in as well as on the way out.
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";

  return (
    <div className="flex min-h-[70vh] items-center justify-center p-6">
      <LoginForm next={safeNext} />
    </div>
  );
}
