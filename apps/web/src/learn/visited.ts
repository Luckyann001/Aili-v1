import { readLocal, subscribeLocal, writeLocal } from "@/voice/localValue";

// Home's "Pick up where you left off": only a flag that this browser has opened the Learn stage.
// No answers, no dates, nothing sent anywhere. Real resume needs sign-in (slice 8).
const KEY = "aili.learn.visited";

export const markLearnVisited = () => writeLocal(KEY, "1");
export const learnVisited = () => readLocal(KEY) === "1";
export const subscribeLearnVisited = (l: () => void) => subscribeLocal(KEY, l);
