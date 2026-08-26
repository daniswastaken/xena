# ADR-003: Replies render as a speech bubble in the avatar window

Date: 2026-08-26
Status: Accepted
Supersedes: the independent chat window (0.2.1 split, commit 2134204)

## Context

0.2.1 moved replies out of the summon bar into a dedicated translucent
chat window anchored bottom-left. Functional, but it split Xena's
presence across two surfaces: the character lives bottom-right, her
words appear bottom-left. Neuro-sama reads as one coherent presence;
AIRI's stage keeps avatar and utterance in one visual field.

## Decision

User directive: drop the chat window. All reply events (stream tokens,
thinking, provider badge, done, errors, proactive comments, glances)
render in a comic speech bubble anchored to Mao's head inside the
avatar window.

Consequences taken on purpose:

- Avatar window enlarged 188x188 -> 460x400. The avatar stays pinned
  bottom-right via CSS; the extra space exists only for the bubble.
- The window is click-through everywhere except the bubble surface;
  hover over the bubble flips `setIgnoreMouseEvents` so long answers
  can be scrolled, selected, and copied.
- One reply surface means no dual-render fan-out: main sends chat
  events to a single target (the avatar window).
- Reading-time fade (8s + 20ms/char, cap 28s) supersedes the 12s
  idle leash on reply completion; proactive one-shots keep the leash.

## Alternatives rejected

- Keep both surfaces (bubble + chat window): duplicate rendering,
  double the memory for a second webContents, split attention.
- Render the bubble inside the bar window: the bar is an input, and
  its position follows the cursor on shake-summon; the bubble must
  stay anchored to the character.
