import { SignInScreen } from "@/screens/sign-in/sign-in-screen";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[]; notice?: string }>;
}) {
  const { error, notice } = await searchParams;
  return (
    <SignInScreen
      hasError={error !== undefined}
      pushRemaining={notice === "push-remaining"}
    />
  );
}
