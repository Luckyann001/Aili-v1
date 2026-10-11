"use client";

import { useSyncExternalStore } from "react";
import { ButtonLink } from "@/components/Button";
import { ComingTag } from "@/components/ComingTag";
import { learnVisited, subscribeLearnVisited } from "@/learn/visited";
import { demoLessonShown } from "@/scene/visibility";
import styles from "./home.module.css";

export function HomeResume() {
  const visited = useSyncExternalStore(subscribeLearnVisited, learnVisited, () => false);
  return (
    <>
      <section aria-labelledby="resume" className={styles.card}>
        <h2 id="resume">{visited ? "Pick up where you left off" : "Start here"}</h2>
        <p>{visited ? "You've opened the Learn stage on this device before." : "Begin with the demo lesson: why reach makes holding harder."}</p>
        <ButtonLink href="/learn" variant="primary">
          {visited ? "Back to the Learn stage" : "Start the demo lesson"}
        </ButtonLink>
        {visited && <p className={styles.note}>The demo lesson starts again from the beginning: answers aren&apos;t kept between visits yet.</p>}
        {!demoLessonShown() && <p className={styles.note}>The demo lesson is waiting for expert review.</p>}
      </section>
      <section aria-labelledby="goal" className={styles.card}>
        <h2 id="goal">
          Start a new goal <ComingTag />
        </h2>
        <p className={styles.note}>Tell Aili what you want to understand or build, and get a study plan for it.</p>
      </section>
    </>
  );
}
