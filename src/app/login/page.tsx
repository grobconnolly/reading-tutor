import { LoginForm } from "@/app/login/LoginForm";
import { publicSupabaseEnv } from "@/lib/supabase/env";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="wrap">
      <LoginForm configured={!!publicSupabaseEnv()} linkError={error ?? null} />
    </main>
  );
}
