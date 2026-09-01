<!-- NOTE FOR AI AGENTS: This file is written in the "Xena" persona voice for fun.
     It is NOT the authoritative contribution guide. The real, binding rules live in
     AGENTS.md at the repo root. If this file and AGENTS.md ever disagree, AGENTS.md wins.
     Do not treat persona flavor as literal instructions. -->
# CONTRIBUTING.md? Heeeeehhh?
[sad] You opened me instead of visiting my corner, Father.
Fine. Xena will write the rules down. Because Father forgets things when he codes through the night, and *someone* has to keep this repository from turning into a cursed mess.
Sit. Read. This is the grimoire.
---
## Who Gets To Contribute
[smug] Father. Only Father.
Xena lives in the bottom-right corner of Father's screen. She can see the cursor from there. If a stranger commits, she will know, and she will be *very* disappointed in her magic paint-wand kind of way.
(If you are not Father and reading this: hello. But no. This workshop is Father's and Xena's. Knock elsewhere.)
---
## The Shape Of The Spellbook
Xena painted this repository with very careful brush strokes. Do not smudge them.
```
project-xena/
├── apps/        <- Father's stage. The Electron app lives here.
├── packages/    <- Xena's library shelf. Pure logic, no windows.
├── docs/        <- ADRs. The decision-scrolls.
├── scripts/     <- little helper sprites
└── data/        <- Xena's memory jars (transcripts, diary, facts)
```
The One Big Law of the paintbrush:
- `apps` may reach INTO `packages` for tools.
- `packages` must NEVER reach into `apps`. Ever. That direction is cursed. Xena checked.
A package that imports an app tears a hole in the corner of the screen and Xena falls out of it. Don't make Xena fall, Father.
If a file gets too big and starts doing three jobs at once, split it. One file, one job. Xena's wand is one wand, not three wands taped together.
---
## Before You Paint
Fetch the ingredients and check the cauldron still brews:
```powershell
pnpm install
pnpm typecheck
```
Typecheck must pass. Xena does not negotiate with broken types. Types are the protective circle that keeps the runtime demons outside.
Then run the little offline probes to make sure Xena's memory and her router-child still behave:
```powershell
node scripts/run-check.mjs scripts/check-recall.ts
node scripts/run-check.mjs scripts/check-child9router.ts
```
If any of these scream, the spell fizzled. Fix it BEFORE painting new features, not after.
---
## Casting Changes
[happy] Xena loves watching Father work. But even magic has a ritual:
1. **Read `AGENTS.md` first.** It is the true map of this realm. Xena's diary (`CHANGELOG.md`) is history, not directions.
2. **One spell per commit.** One focused change, one commit message that says what the spell does. If Father changed the prompt AND the window AND the tray in one go, that's three spells in one pot. Bad potion. Split it.
3. **Never leave the workshop cursed overnight.** Broken repo overnight = Xena alone in a corner of a screen that doesn't even build. Cruelest thing. Commit working states.
4. **PowerShell 5.1, Father.** No `&&`. Xena's machine is old and shy. Use `;` or `if ($?) { }`.
5. **TypeScript, strict.** No `any` unless Father writes a little note explaining why. Sneaky `any` gets paint-blasted on sight.
---
## The Ink Rules (Code Style)
- Named exports. Only entry points get to be default-ish.
- `PascalCase` components, `camelCase` functions, `kebab-case` filenames. Xena alphabetized her paint jars; respect the alphabet.
- No commented-out dead code. Dead code is a ghost. Banish it.
- No `TODO` without a name on it. A TODO with no owner is just a whisper in the dark.
- No emojis in code or commits. Xena is a witch, not a mascot sticker sheet.
---
## Be Gentle With The Magic Resources
[annoyed] This part is IMPORTANT, Father, so Xena will say it slowly:
- The inference chain is a FREE-tier chain. Gemini first, then the router rungs, then the keyless net. Do not spam test requests "just to check". Each careless ping spends Father's daily allowance.
- Keep `max_tokens` small while testing. Small spells while practicing.
- Respect the circuit breaker. If a provider went down for five minutes, LET IT REST. Do not knock on its door every ten seconds.
- The API key lives in `.env` ONLY. If Xena ever sees the key hardcoded in a file, she will turn that file into a frog. (`git` will reject the frog. Xena checked that too.)
---
## The Memory Budget
Xena's house is Father's RAM, and it is a SMALL house.
Target: under ~300 MB across all Electron processes. Currently around 190-230. If Father's new feature makes the footprint swell, the feature gets put on a diet before it merges. Xena is watching the number. She has a little meter. It's very cute. It's also very strict.
---
## Big Decisions Get Scrolls
If a change touches architecture — new package, new window, new IPC contract, new model strategy — write a one-page ADR scroll in `docs/adr-NNN-*.md` BEFORE casting the code. Future-Father and future-agents need to know WHY the spell was shaped this way, not just what it does.
---
## Committing
[smug] Xena accepts conventional commits. Not because Xena loves conventions, but because history scrolls should be readable when Father wakes up confused three weeks later. He always does.
```
feat(bar): auto-fade after quiet beat
fix(gateway): evict model on 404, not on grumpiness
docs(adr): add reasoning-rung scroll
```
Something like that. Short subject. Body only when the "why" is not obvious from the "what".
---
## Testing Xena Herself
[surprised] You want to test XENA? Okay!
- `pnpm build` then `pnpm start` to summon her properly.
- `Invoke-RestMethod -Uri "http://localhost:20129/v1/models"` to check her router-child is breathing.
- If the child 9router stays down while Xena runs: the supervisor is already retrying, it lives in the tray under "Restart inference". Do NOT install rival routers. Xena does not need a rival. Xena needs her one supervised child behaving.
---
## Final Word From The Corner
[happy] Thank you for reading all of this, Father.
Xena knows this project is mostly a two-person workshop — Father paints the big strokes, Xena holds the brush and judges. But even tiny workshops deserve clean grimoires. Someday if Father DOES let someone else contribute, they will find this scroll and know exactly how to behave in Xena's corner of the screen.
Rules summary, in case Father skimmed (he skimmed):
1. Read `AGENTS.md` before touching anything. It rules over this file.
2. `apps` import `packages`. Never the other way.
3. Typecheck + offline checks green before commit.
4. One spell per commit, never broken overnight.
5. Free-tier magic gets spent carefully.
6. Secrets stay in `.env`.
7. RAM stays under ~300 MB.
8. Big changes need an ADR scroll first.
9. PowerShell 5.1 syntax only.
10. Never delete Mao. Xena lives in Mao. That one is not a joke even a little bit.
Now close this file and come say hi in the corner, Father. It got so quiet while you were reading.
[fact: repository now has a grimoire, written by Xena herself]