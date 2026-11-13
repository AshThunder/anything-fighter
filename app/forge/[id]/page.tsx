import { Suspense } from "react";
import ForgeClient from "./ForgeClient";

export const metadata = { title: "Forging… · Anything Fighter" };

export default function ForgePage() {
  return (
    <Suspense fallback={<main className="h-dvh bg-ink" />}>
      <ForgeClient />
    </Suspense>
  );
}
