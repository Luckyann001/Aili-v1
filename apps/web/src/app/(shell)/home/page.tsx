import type { Metadata } from "next";
import styles from "../placeholder.module.css";

export const metadata: Metadata = { title: "Home · AILI" };

// Placeholder. Home/Resume is M1 slice 7.
export default function HomePage() {
  return (
    <div className={styles.wrap}>
      <h1>Home</h1>
      <p className={styles.note}>Resume and start-a-goal arrive in a later M1 slice.</p>
    </div>
  );
}
