import type { Metadata } from "next";
import { LearnStage } from "./LearnStage";

export const metadata: Metadata = { title: "Learn · AILI" };

export default function LearnPage() {
  return <LearnStage />;
}
