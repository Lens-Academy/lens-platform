# Content Migration Checklist

Files in lens-edu-relay that need migrating to the new flat lens format.

## Legend

**Lens file changes:**
- Remove `### Article:`, `### Video:`, `### Page:` H3 headers
- Move `source::` from section-level to the first `#### Article` / `#### Video` segment
- Rename `#### Article-excerpt` → `#### Article`
- Rename `#### Video-excerpt` → `#### Video`

**Module file changes:**
- Convert `# Page:` sections → `# Lens:` (inline format with `id::` + `#### Text`/`#### Chat`)
- Convert `# Uncategorized:` sections → promote each `## Lens:` to top-level `# Lens:`

---

## Module files (17 files)

All have `# Page:` and/or `# Uncategorized:` sections that need converting to `# Lens:`.

- [ ] `Lens Edu/modules/introduction.md`
- [ ] `Lens Edu/modules/feedback-loops.md`
- [ ] `Lens Edu/modules/coming-soon.md`
- [ ] `Lens Edu/modules/software-demo.md`
- [ ] `Lens Edu/modules/what-even-is-ai.md`
- [ ] `Lens Edu/modules/Cognitive Superpowers.md`
- [ ] `Lens Edu/modules/Fundamental Difficulties.md`
- [ ] `Lens Edu/modules/Last module.md`
- [ ] `Lens Edu/modules/Module Template.md`
- [ ] `Lens Edu/modules/IABIED M1 Intro and Nonhuman Minds, Part 1.md`
- [ ] `Lens Edu/modules/IABIED M2 Nonhuman Minds, Part 2.md`
- [ ] `Lens Edu/modules/IABIED M3 Nonhuman Minds, Part 3.md`
- [ ] `Lens Edu/modules/IABIED M4 One Extinction Scenario.md`
- [ ] `Lens Edu/modules/IABIED M5 Facing The Challenge, Part 1.md`
- [ ] `Lens Edu/modules/IABIED M6 Facing The Challenge, Part 2.md`
- [ ] `Lens Edu/modules/IABIED M7 What Happens Next.md`
- [ ] `Lens/templates/template - module.md`

## Lens files — Article type (147 files)

Have `### Article:` H3 header + `#### Article-excerpt` segments. Need flattening.

- [ ] `Lens Edu/Lenses/1960, The Year The Singularity Was Cancelled.md`
- [ ] `Lens Edu/Lenses/6 reasons why alignment-is-hard.md`
- [ ] `Lens Edu/Lenses/A starter guide for evals.md`
- [ ] `Lens Edu/Lenses/AF not really math not really science.md`
- [ ] `Lens Edu/Lenses/AI Control May Increase Existential Risk.md`
- [ ] `Lens Edu/Lenses/AI Is Grown, Not Built.md`
- [ ] `Lens Edu/Lenses/AI for AI safety.md`
- [ ] `Lens Edu/Lenses/AI manipulation - mind hacked.md`
- [ ] `Lens Edu/Lenses/Carefully Bootstrapped Alignment Is Organizationally Hard.md`
- [ ] `Lens Edu/Lenses/Cascades and Cycles.md`
- [ ] `Lens Edu/Lenses/Credible Threats.md`
- [ ] `Lens Edu/Lenses/Deadly By Default.md`
- [ ] `Lens Edu/Lenses/Discovering when an agent is present in a system.md`
- [ ] `Lens Edu/Lenses/Embedded agents.md`
- [ ] `Lens Edu/Lenses/Four Background Claims.md`
- [ ] `Lens Edu/Lenses/How can LLMs be understood as simulators.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - AI Civilization.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - AI Consciousness.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - AI Critical Thresholds.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - AI Differs from Precedents.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - AI Experts on Catastrophe.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - AI Find Us Fascinating.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - AI Find Us Useful.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - AI Lacks Selfish Drives.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - AI Steering Beyond Training.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - AI Treat Us as Parents.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - AIs Just Math.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - AIs Just Parroting.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - AIs Just Tools.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - AIs Need Rule of Law.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - AIs Think in English.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Aligned with Natural Selection.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Alignment All or Nothing.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Anthropomorphism and Mechanomorphism.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Author Incentives and Conflicts.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Avoid Talking About Dangers.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Before and After.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Boring Goals.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Building Without Understanding.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Care a Little About Humans.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Chance of Keeping Us Alive.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - ChatGPT as General Intelligence.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Chicago Pile-1.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Claude Shows Alignment.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Cold and Logical AIs.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Could ChatGPT Kill Us.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Curiosity Isn't Convergent.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Digital AIs Affect Us.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Do Experts Understand AIs.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Ecological Preservation.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Enhance Humans.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Exploit AI Weakness.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Extrapolating AI Progress.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Fix Own Flaws.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Full Description of an LLM.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Galvanic Fairly Careful.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Galvanic Insufficiently Careful.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - General Intelligence.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Good Behaviors Correlate.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Governments Get Involved.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Gradient Descent Matters.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Hallucinations Show Weakness.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Hardware Overhang.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - How Smart Could Superintelligence Get.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Human Data Means Human Concepts.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Human Values Are Contingent.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Human-Level Intelligence.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Human-Like Emotions.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Humans Not Efficient.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Intelligence Overrated.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Intelligence Understandable.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Intelligence as Multiple Skills.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Intelligence as Prediction and Steering.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Intelligence as Scalar.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Intrinsic Moral Worth.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Is Intelligence Meaningful.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Just Pessimistic.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Just Predicting Next Token.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Just Science Fiction.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Keep AI in a Box.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Kinder as Smarter.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Kindness from Any Goal.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Knowledge of LLMs.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - LLMs Like Their Training Data.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - LLMs to Superintelligence.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Leo Szilard Saw the Future.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Limited by Experiments.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Lots of Different AIs.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Machine Own Priorities.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Machines Becoming Conscious.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Machines Fundamentally Uncreative.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Make It Lazy.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Making AIs Nice and Safe.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Muddle Through.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Nanotechnology and Protein Synthesis.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Non-Dangerous Deployment.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Non-Human Entities.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Obstacles to Superintelligence.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Obvious Insights Take Time.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Only Digital Realm.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Only One Smart AI.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Optical Illusions Discovery.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Orthogonality.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Panicking and Overreacting.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Passive and Docile.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Power of Intelligence.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Predicting Superintelligence.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Preserving Humans Negligible.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Promise to Be Friendly.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Pull the Plug.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Race for Alignment Research.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Reckless Means Incompetent.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Running Out of Resources.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Sable's Expansion Phase.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Sable's Thinking.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Satisfied to Leave Us Alone.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Shallowness of Current AIs.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Slow AI Integration.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Smart AI Stupid Things.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Something Special About Humans.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Story Started Later.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Surpassing Humans from Human Data.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Taking the AI's Perspective.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Terminal and Instrumental Goals.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - The Ending.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Thinking It's a Simulation.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Time to Solve Alignment.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Train Like a Human.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - We Still Have Horses.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Weird in Extreme Cases.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - When Will Worrisome AI Arrive.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Why This Setup.md`
- [ ] `Lens Edu/Lenses/IABIED - QA - Why Write This Book.md`
- [ ] `Lens Edu/Lenses/Intelligence Explosion Foom.md`
- [ ] `Lens Edu/Lenses/Interpretability Will Not Reliably Find Deceptive AI.md`
- [ ] `Lens Edu/Lenses/Introduction to Mechanistic Interpretability.md`
- [ ] `Lens Edu/Lenses/Janus' Simulators - Scott Alexander.md`
- [ ] `Lens Edu/Lenses/Lens Template.md`
- [ ] `Lens Edu/Lenses/Machines Of Loving Grace.md`
- [ ] `Lens Edu/Lenses/Meditations on Moloch.md`
- [ ] `Lens Edu/Lenses/More advantages for digital agents.md`
- [ ] `Lens Edu/Lenses/PASTA AI.md`
- [ ] `Lens Edu/Lenses/Pythia by plex.md`
- [ ] `Lens Edu/Lenses/Realism about rationality.md`
- [ ] `Lens Edu/Lenses/Recursion Magic.md`
- [ ] `Lens Edu/Lenses/Security Mindset and Ordinary Paranoia.md`
- [ ] `Lens Edu/Lenses/Sharp left turn.md`
- [ ] `Lens Edu/Lenses/Simulators by Janus.md`
- [ ] `Lens Edu/Lenses/Speculations concerning the first ultraintelligent machine.md`
- [ ] `Lens Edu/Lenses/Speed advantage with slow motion videos.md`
- [ ] `Lens Edu/Lenses/The Case Against AI Control Research.md`
- [ ] `Lens Edu/Lenses/The World Keeps Getting Saved.md`
- [ ] `Lens Edu/Lenses/The case for ensuring that powerful AIs are controlled.md`
- [ ] `Lens Edu/Lenses/Utopia.md`
- [ ] `Lens Edu/Lenses/WP Software demo.md`
- [ ] `Lens Edu/Lenses/We Need A 'Science of Evals'.md`
- [ ] `Lens Edu/Lenses/What AI evaluations for preventing catastrophic risks can and cannot do.md`
- [ ] `Lens Edu/Lenses/What are the differences between a singularity, an intelligence explosion, and a hard takeoff.md`
- [ ] `Lens Edu/Lenses/When should we worry about AI power-seeking.md`
- [ ] `Lens Edu/Lenses/Wikipedia Existential Risk.md`
- [ ] `Lens Edu/Lenses/Without fundamental advances, misalignment and catastrophe are the default outcomes of training powerful AIst outcomes.md`
- [ ] `Lens Edu/Lenses/Worst-Case Thinking.md`
- [ ] `Lens Edu/Lenses/collapsed article text test.md`
- [ ] `Lens Edu/Lenses/sidebar chat test 1 article segment.md`
- [ ] `Lens Edu/Lenses/sidebar chat test 2 article segments.md`

## Lens files — Video type (9 files)

Have `### Video:` H3 header + `#### Video-excerpt` segments. Need flattening.

- [ ] `Lens Edu/Lenses/10 reasons.md`
- [ ] `Lens Edu/Lenses/A.I. - Humanity's Final Invention.md`
- [ ] `Lens Edu/Lenses/Eliezer Yudkowsky – AI Alignment- Why It's Hard, and Where to Start.md`
- [ ] `Lens Edu/Lenses/Kurzgesagt software demo.md`
- [ ] `Lens Edu/Lenses/MI for AGI Safety.md`
- [ ] `Lens Edu/Lenses/Speed advantage (as video content type).md`
- [ ] `Lens Edu/Lenses/The Artificial Intelligence That Deleted A Century.md`
- [ ] `Lens Edu/Lenses/The Goddess Of Everything Else.md`
- [ ] `Lens Edu/Lenses/The power of intelligence.md`

## Lens files — Page type (7 files)

Have `### Page:` H3 header with text/chat segments only. Need: remove `### Page:` header.

- [ ] `Lens Edu/Lenses/AI Control.md`
- [ ] `Lens Edu/Lenses/AI Evaluations.md`
- [ ] `Lens Edu/Lenses/Agent Foundations.md`
- [ ] `Lens Edu/Lenses/Automating Alignment.md`
- [ ] `Lens Edu/Lenses/Mechanistic Interpretability.md`
- [ ] `Lens Edu/Lenses/Next steps.md`
- [ ] `Lens Edu/Lenses/Trial question and roleplay.md`

## Other files (2 files)

- [ ] `Lens Edu/Content Creation Guide.md` — documentation, update examples to new format
- [ ] `Lens Edu/README.md` — documentation, update examples

## Progress

| Category | Count | Done |
|----------|-------|------|
| Lens files (page-only) | 7 | 7 |
| Lens files (video) | 9 | 9 |
| Lens files (IABIED article) | 120 | 120 |
| Lens files (non-IABIED article) | 27 | 24 |
| Module files | 17 | 17 |
| Documentation | 2 | 2 |
| **Total** | **182** | **179** |

### Needs manual attention (special characters in MCP)
- `Lens Edu/Lenses/Cascades and Cycles.md` — residual `### Article:` line with ellipsis character `…` that MCP can't match (delete line 5)
- `Lens Edu/Lenses/sidebar chat test 1 article segment.md` — H3 header (line ~10) and `#### Article-excerpt` (line ~36) contain inline CriticMarkup comments; need manual rename to `#### Article` + add `source:: [[../articles/karnofsky-most-important-century]]`
- `Lens Edu/Lenses/We Need A 'Science of Evals'.md` — smart quotes in filename prevent MCP from reading; needs same transformation as other article lenses
- `Lens/templates/template - module.md` — CriticMarkup comment line after removed `# Uncategorized:` may need cleanup

**Remaining:** 2 documentation files + 3 manual fixes
