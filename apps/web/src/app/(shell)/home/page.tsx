import type { Metadata } from "next";
import { StatusNote } from "@/components/StatusNote";
import { HomeResume } from "./HomeResume";
import styles from "./home.module.css";

export const metadata: Metadata = { title: "Home · AILI" };

// Home/Resume: resume and start a new goal. Not a dashboard.
export default function HomePage() {
  return (
    <div className={styles.wrap}>
      <h1>Home</h1>
      <StatusNote>Early beta. Lessons are prepared demos; the live professor is not connected yet.</StatusNote>
      <HomeResume />
    </div>
  );
}
