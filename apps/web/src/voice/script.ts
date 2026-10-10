// Prepared demo reply (no AI yet). It says plainly that it is prepared, and is badged "Prepared".
export const PREPARED_REPLY = [
  "This is a prepared demo line, not a live answer.",
  "Live replies from Aili arrive in a later build.",
  "You can stop me at any time with the stop button or the Escape key.",
  "What would you like to look at first?",
];

/** Quick replies offered after the prepared reply's closing question. */
export const PREPARED_CHIPS = ["Show me inside", "Why?", "Use another example"];

/** Pause between the learner's input and the prepared reply, so "thinking" is visible. */
export const THINKING_MS = 700;
