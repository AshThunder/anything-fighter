import { Suspense } from "react";
import FightClient from "./FightClient";

export const metadata = { title: "Fight · Anything Fighter" };

export default function FightPage() {
  return (
    <Suspense fallback={<main className="h-dvh bg-[#0d0b09]" />}>
      <FightClient />
    </Suspense>
  );
}
