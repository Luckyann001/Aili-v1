import type { Metadata } from "next";
import { VoiceSettings } from "./VoiceSettings";
import styles from "./settings.module.css";

export const metadata: Metadata = { title: "Settings · AILI" };

// Minimal Settings: only what the voice notice promises can be changed here.
export default function SettingsPage() {
  return (
    <div className={styles.wrap}>
      <h1>Settings</h1>
      <VoiceSettings />
    </div>
  );
}
