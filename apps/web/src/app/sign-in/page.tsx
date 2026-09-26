import { SignInScreen } from "@/screens/sign-in/sign-in-screen";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const { error } = await searchParams;
  return <SignInScreen hasError={error !== undefined} />;
}
