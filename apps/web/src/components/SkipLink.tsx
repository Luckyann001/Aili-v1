import styles from "./SkipLink.module.css";

export function SkipLink({ target = "main" }: { target?: string }) {
  return (
    <a href={`#${target}`} className={styles.skip}>
      Skip to content
    </a>
  );
}
