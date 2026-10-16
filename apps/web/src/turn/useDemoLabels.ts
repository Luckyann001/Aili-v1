"use client";

import { DEMO_CONTENT } from "aili-demo-content";
import { DEMO_NOTE_NOT_REVIEWED, DEMO_NOTE_REVIEWED, FOUNDER_DEMO, demoLabelsFor, type DemoLabels } from "./contentMode";
import { useStageContent } from "./stageContent";

/** The servo lesson's scene: the live note speaks for it before any scene is on stage. */
const LESSON_SCENE = "fx-servo-arm";

/** Founder demo mode: the labels for the fixture scene a live turn put on stage; null otherwise. */
export function useDemoLabels(): DemoLabels | null {
  const sceneId = useStageContent((s) => s.sceneId);
  const fixture = useStageContent((s) => s.fixture);
  return fixture ? demoLabelsFor(DEMO_CONTENT, sceneId) : null;
}

/** Founder demo mode: the live note, true to the review records of what is (or will be) on stage; null otherwise. */
export function useDemoNote(): string | null {
  const sceneId = useStageContent((s) => s.sceneId);
  if (!FOUNDER_DEMO || !DEMO_CONTENT) return null;
  const l = demoLabelsFor(DEMO_CONTENT, sceneId ?? LESSON_SCENE) ?? demoLabelsFor(DEMO_CONTENT, LESSON_SCENE);
  return l?.reviewed ? DEMO_NOTE_REVIEWED : DEMO_NOTE_NOT_REVIEWED;
}

/** Founder demo mode: a live turn put demo content on stage, so the scene shows without the drafts flag. */
export const useDemoSceneOnStage = () => useDemoLabels() !== null;
