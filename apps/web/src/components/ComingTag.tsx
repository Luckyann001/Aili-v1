import styles from "./ComingTag.module.css";

/** "Coming" marker for unbuilt features: a word in an outlined tag, never colour alone. */
export function ComingTag() {
  return <span className={styles.tag}>Coming</span>;
}
