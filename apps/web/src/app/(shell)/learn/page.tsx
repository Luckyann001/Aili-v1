import type { Metadata } from "next";
import { ContentBadge } from "@/components/ContentBadge";
import styles from "../placeholder.module.css";

export const metadata: Metadata = { title: "Learn · AILI" };

// Placeholder. The Learn stage layout is M1 slice 2.
export default function LearnPage() {
  return (
    <div className={styles.wrap}>
      <h1>Learn stage</h1>
      <p>
        <ContentBadge kind="prepared" />
      </p>
      <p className={styles.note}>The stage, voice, captions, text panel and Library arrive in the next M1 slices.</p>
    </div>
  );
}
