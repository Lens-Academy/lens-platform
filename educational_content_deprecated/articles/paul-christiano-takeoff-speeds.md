---
title: "Takeoff speeds"
author: Paul Christiano
date: 2018-02-24
source_url: https://sideways-view.com/2018/02/24/takeoff-speeds/
---

Futurists have argued for years about whether the development of AGI will look more like a breakthrough within a small group ("fast takeoff"), or a continuous acceleration distributed across the broader economy or a large firm ("slow takeoff").

I currently think a slow takeoff is significantly more likely. This post explains some of my reasoning and why I think it matters. Mostly the post lists arguments I often hear for a fast takeoff and explains why I don't find them compelling.

(Note: this is _not_ a post about whether an intelligence explosion will occur. That seems very likely to me. Quantitatively I expect it to go [along these lines](https://sideways-view.com/2017/10/04/hyperbolic-growth/). So e.g. while I disagree with many of the claims and assumptions in [Intelligence Explosion Microeconomics](https://intelligence.org/files/IEM.pdf), I don't disagree with the central thesis or with most of the arguments.)

(See also: [AI Impacts page](https://aiimpacts.org/likelihood-of-discontinuous-progress-around-the-development-of-agi/) on the same topic.)

### Slow takeoff

#### Slower takeoff means faster progress

Fast takeoff is often justified by pointing to the incredible transformative potential of intelligence; by enumerating the many ways in which AI systems will outperform humans; by pointing to historical examples of rapid change; _etc._

This gives the impression that people who expect a slow takeoff think AI will have a smaller impact, or will take longer to transform society.

But I think that's backwards. The main disagreement is not about what will happen once we have a superintelligent AI, it's about what will happen _before_ we have a superintelligent AI. So slow takeoff seems to mean that AI has a larger impact on the world, sooner.

![Image 1: TakeoffImage.001](https://sideways-view.com/wp-content/uploads/2018/02/takeoffimage-0011.png?w=748)

In the fast takeoff scenario, weaker AI systems may have significant impacts but they are nothing compared to the "real" AGI. Whoever builds AGI has a decisive strategic advantage. Growth accelerates from 3%/year to 3000%/year without stopping at 30%/year. And so on.

In the slow takeoff scenario, pre-AGI systems have a transformative impact that's only slightly smaller than AGI. AGI appears in a world where everything already happens incomprehensibly quickly and everyone is incredibly powerful. Being 12 months ahead in AGI might get you a decisive strategic advantage, but the world has accelerated so much that that's just about as hard as getting to airplanes 30 years before anyone else.

#### Operationalizing slow takeoff

_There will be a complete 4 year interval in which world output doubles, before the first 1 year interval in which world output doubles. (Similarly, we'll see an 8 year doubling before a 2 year doubling, etc.)_

At some point there will be incredibly powerful AI systems. They will have many consequences, but one simple consequence is that world output will grow much more quickly. I think this is a good barometer for other transformative effects, including large military advantages.

I believe that before we have incredibly powerful AI, we will have AI which is merely _very_ powerful. This won't be enough to create 100% GDP growth, but it will be enough to lead to (say) 50% GDP growth. I think the likely gap between these events is years rather than months or decades.

In particular, this means that incredibly powerful AI will emerge in a world where crazy stuff is already happening (and probably everyone is already freaking out). If true, I think it's an important fact about the strategic situation.

(Operationalizing takeoff speed in terms of economic doublings may seem weird, but I do think it gets at the disagreement: proponents of fast takeoff don't seem to expect the 4 year doubling before takeoff, or at least their other beliefs about the future don't seem to integrate that expectation.)

#### The basic argument

The _prima facie_ argument for slow takeoff is pretty straightforward:

* Before we have an incredibly intelligent AI, we will probably have a slightly worse AI.
  * Lots of people will be trying to build powerful AI.
  * For most X, it is easier to figure out how to do a slightly worse version of X than to figure out how to do X.
    * The worse version may be more expensive, slower, less reliable, less general… (Usually there is a tradeoff curve, and so you can pick which axes you want the worse version to be worse along.)
  * If many people are trying to do X, and a slightly worse version is easier and almost-as-good, someone will figure out how to do the worse version before anyone figures out how to do the better version.
  * This story seems consistent with the historical record. Things are usually preceded by worse versions, even in cases where there are weak reasons to expect a discontinuous jump.
    * The best counterexample is probably nuclear weapons. But in that case there were several very strong reasons for discontinuity: physics has an inherent gap between chemical and nuclear energy density, nuclear chain reactions require a large minimum scale, and the dynamics of war are very sensitive to energy density.
* A slightly-worse-than-incredibly-intelligent AI would radically transform the world, leading to growth (almost) as fast and military capabilities (almost) as great as an incredibly intelligent AI.

This simple argument pushes towards slow takeoff. But there are several considerations that could push towards fast takeoff, which we need to weigh against the basic argument.

Obviously this is a quantitative question. In this post I'm not going to get into the numbers because the substance of the disagreement seems to be about qualitative models.

### Reasons to expect fast takeoff

People have offered a variety of reasons to expect fast takeoff. I think that many of these arguments make sense, but I don't think they support the kind of highly concentrated, discontinuous progress which fast takeoff proponents seem to typically have in mind.

I expect there are other arguments beyond these, or that I've misunderstood some of these, and look forward to people pointing out what I'm missing.

#### Humans vs. chimps

_Summary of my response: chimps are nearly useless because they aren't optimized to be useful, not because evolution was trying to make something useful and wasn't able to succeed until it got to humans_.

Chimpanzees have brains only ~3x smaller than humans, but are much worse at making technology (or doing science, or accumulating culture…). If evolution were selecting primarily or in large part for technological aptitude, then the difference between chimps and humans would suggest that tripling compute and doing a tiny bit of additional fine-tuning can radically expand power, undermining the continuous change story.

But chimp evolution is not primarily selecting for making and using technology, for doing science, or for facilitating cultural accumulation. The task faced by a chimp is largely independent of the abilities that give humans such a huge fitness advantage. It's not completely independent-the overlap is the only reason that evolution eventually produces humans-but it's different enough that we should not be surprised if there are simple changes to chimps that would make them much better at designing technology or doing science or accumulating culture.

If we compare humans and chimps at the tasks chimps are optimized for, humans are clearly much better but the difference is not nearly as stark. Compare to the difference between chimps and gibbons, gibbons and lemurs, or lemurs and squirrels.

Relatedly, evolution _changes_ what it is optimizing for over evolutionary time: as a creature and its environment change, the returns to different skills can change, and they can potentially change very quickly. So it seems easy for evolution to shift from "not caring about X" to "caring about X," but nothing analogous will happen for AI projects. (In fact a similar thing often _does_ happen while optimizing something with SGD, but it doesn't happen at the level of the ML community as a whole.)

If we step back from skills and instead look at outcomes we could say: "Evolution is _always_ optimizing for fitness, and humans have now taken over the world." On this perspective, I'm making a claim about the limits of evolution. First, evolution is theoretically optimizing for fitness, but it isn't able to look ahead and identify which skills will be most important for your children's children's children's fitness. Second, human intelligence is incredibly good for the fitness of _groups_ of humans, but evolution acts on individual humans for whom the effect size is much smaller (who barely benefit at all from passing knowledge on to the next generation). Evolution really is optimizing something quite different than "humanity dominates the world."

So I don't think the example of evolution tells us much about whether the continuous change story applies to intelligence. This case is potentially missing the key element that drives the continuous change story-optimization for performance. Evolution changes continuously on the narrow metric it is optimizing, but can change extremely rapidly on other metrics. For human technology, features of the technology that aren't being optimized change rapidly all the time. When humans build AI, they _will_ be optimizing for usefulness, and so progress in usefulness is much more likely to be linear.

Put another way: the difference between chimps and humans stands in stark contrast to the normal pattern of human technological development. We might therefore infer that intelligence is very unlike other technologies. But the difference between evolution's optimization and our optimization seems like a much more parsimonious explanation. To be a little bit more precise and Bayesian: the prior probability of the story I've told upper bounds the possible update about the nature of intelligence.

#### AGI will be a side-effect

_Summary of my response: I expect people to see AGI coming and to invest heavily._

AI researchers might be optimizing for narrow forms of intelligence. If so we could have the same dynamic as with chimps-we see continuous progress on accomplishing narrow tasks in a narrow way, leading eventually to a jump in general capacities _as a side-effect_. These general capacities then also lead to much better progress on narrow tasks, but there is no reason for progress to be continuous because no one is optimizing for general intelligence.

I don't buy this argument because I think that researchers probably _will_ be optimizing aggressively for general intelligence, if it would help a lot on tasks they care about. If that's right, this argument only implies a discontinuity if there is _some other reason_ that the usefulness of general intelligence of general intelligence is discontinuous.

However, if researchers greatly underestimate the impact of general intelligence and so don't optimize for it, I agree that a fast takeoff is plausible. It could turn out that "will researchers adequately account for the impact of general intelligence and so try to optimize it?" is a crux. My intuition is based on a combination of (weak) adequacy intuitions and current trends in ML research.

#### Finding the secret sauce

_Summary of my response: this doesn't seem common historically, and I don't see why we'd expect AGI to be more rather than less like this (unless we accept one of the other arguments)_

Another common view is that there are some number of key insights that are needed to build a generally intelligent system. When the final pieces fall into place we may then see a large jump; one day we have a system with enough raw horsepower to be very smart but critical limitations, and the next day it is able to use all of that horsepower.

I don't know exactly how to respond to this view because I don't feel like I understand it adequately.

I'm not aware of many historical examples of this phenomenon (and no really good examples)-to the extent that there have been "key insights" needed to make something important work, the first version of the insight has almost always either been discovered long before it was needed, or discovered in a preliminary and weak version which is then iteratively improved over a long time period.

To the extent that fast takeoff proponent's views are informed by historical example, I would love to get some canonical examples that they think best exemplify this pattern so that we can have a more concrete discussion about those examples and what they suggest about AI.

Note that a really good example should be on a problem that many people care about. There are lots of examples where no one is thinking about X, someone uncovers an insight that helps a lot with X, and many years later that helps with another task Y that people do care about. That's certainly interesting, but it's not really surprising at all on the slow-change view unless it actually causes surprisingly fast progress on Y.

Looking forward to AGI, it seems to me like if anything we should have a somewhat smaller probability than usual that a final "key insight" making a huge difference.

* AGI was built by evolution, which is more likely if it can be built by iteratively improving simple ingredients.
* It seems like we already have a set of insights that are sufficient for building an autopoetic AGI so we won't be starting from 0 in any case.
* Historical AI applications have had a relatively small loading on key-insights and seem like the closest analogies to AGI.

The example of chimps or dumb humans seems like one of the best reasons to expect a key insight, but I've already discussed why I find that pretty unconvincing.

In this case I don't yet feel like I understand where fast takeoff proponents are coming from, so I think it is especially likely that my view will change based on further discussion. But I would really like to see a clearer articulation of the fast takeoff view here as an early step of that process.

#### Universality thresholds

_Summary of my response: it seems like early AI systems will cross universality thresholds pre-superintelligence, since (a) there are tradeoffs between universality and other desirable properties which would let people build universal AIs early if the returns to universality are large enough, (b) I think we can already build universal AIs at great expense._

Some cognitive processes get stuck or "run out of steam" if you run them indefinitely, while others are able to deliberate, improve themselves, design successor systems, and eventually reach arbitrarily high capability levels. An AI system may go from being weak to being very powerful as it crosses the threshold between these two regimes.

It's clear that some humans are above this universality threshold, while chimps and young children are probably below it. And if you take a normal human and you inject a bunch of noise into their thought process (or degrade it) they will also fall below the threshold.

It's easy to imagine a weak AI as some kind of handicapped human, with the handicap shrinking over time. Once the handicap goes to 0 we know that the AI will be above the universality threshold. Right now it's below the universality threshold. So there must be sometime in between where it crosses the universality threshold, and that's where the fast takeoff is predicted to occur.

But AI _isn't_ like a handicapped human. Instead, the designers of early AI systems will be trying to make them as useful as possible. So if universality is incredibly helpful, it will appear as early as possible in AI designs; designers will make tradeoffs to get universality at the expense of other desiderata (like cost or speed).

So now we're almost back to the previous point: is there some secret sauce that gets you to universality, without which you can't get universality however you try? I think this is unlikely for the reasons given in the previous section.

There is another reason I'm skeptical about hard takeoff from universality secret sauce: I think we _already_ could make universal AIs if we tried (that would, given enough time, learn on their own and converge to arbitrarily high capability levels), and the reason we don't is because it's just not important to performance and the resulting systems would be really slow. This inside view argument is too complicated to make here and I don't think my case rests on it, but it is relevant to understanding my view.

#### "Understanding" is discontinuous

_Summary of my response: I don't yet understand this argument and am unsure if there is anything here._

It may be that understanding of the world tends to _click_, from "not understanding much" to "understanding basically everything."

You might expect this because everything is entangled with everything else. If you only understand 20% of the world, then basically every sentence on the internet is confusing, so you can't make heads or tails of everything. This seems wrong to me for two reasons. First, information is really not that entangled even on the internet, and the (much larger) fraction of its knowledge that an AI generates for itself is going to be even less entangled. Second, it's not right to model the AI as having a gradually expanding domain that it understands at all, with total incomprehension everywhere else. Unless there is some other argument for a discontinuity, then a generalist AI's understanding of each domain will just continuously improve, and so taking the minimum across many domains doesn't make things particularly discontinuous.

People might instead expect a _click_ because that's what they experience. That's very unlike my experience, but maybe other people differ-it would be very interesting if this was a major part of where people were coming from. Or that may be how they perceive others' thought processes as working. But when I look at others' understanding, it seems like it is common to have a superficial or weak understanding which transitions gradually into a deep understanding.

Or they might expect a _click_ because the same progress which lets you understand one area will let you understand many areas. But that doesn't actually explain anything: you'd expect partial and mediocre understanding before a solid understanding.

Of course all the arguments in other sections (e.g. secret sauce, chimps vs. humans) can also be arguments about why understanding will be discontinuous. In the other sections I explain why I don't find those arguments convincing.

#### Deployment lag

_Summary of my response: current AI is slow to deploy and powerful AI will be fast to deploy, but in between there will be AI that takes an intermediate length of time to deploy._

When AI improves, it takes a while for the world to actually benefit from the improvement. For example, we need to adjust other processes to take advantage of the improvement and tailor the new AI system to the particular domains where it will be used. This seems to be an artifact of the inflexibility of current technology, and e.g. humans can adapt much more quickly to be useful in new settings.

Eventually, powerful AI will become useful in new situations even faster than people. So we may have a jump from narrow AI, that takes a long time to deploy, to general AI that is easily deployed.

I've heard this argument several times over the last few months, but don't find the straightforward version convincing: without some other argument for discontinuity, I don't see why "time to deploy" jumps from a large number to a small number. Instead, I'd expect deployment to become continuously easier as AI improves.

A slight variant that I think of as the "sonic boom" argument goes like this: suppose each month of AI research makes AI a little bit easier to deploy. Over time AI research gradually accelerates, and so the deployment time shrinks faster and faster. At some point, a month of AI research decreases deployment time by more than a month. At this point, "deploy AI the old-fashioned way" becomes an unappealing strategy: you will get to market faster by simply improving AI. So even if all of the dynamics are continuous, the quality of deployed AI would jump discontinuously.

This phenomenon only occurs if it is very hard to make tradeoffs between deployment time and other features like cost or quality. If there is any way to tradeoff other qualities against deployment time, then people will more quickly push worse AI products into practice, because the benefits of doing so are large. I strongly expect it to be possible to make tradeoffs, because there are so many obvious-seeming ways to trade off deployment time vs. usefulness (most "deployment time" is really just spending time improving the usefulness of a system) and I haven't seen stories about why that would stop.

#### Recursive self-improvement

_Summary of my response: Before there is AI that is great at self-improvement there will be AI that is mediocre at self-improvement._

Powerful AI can be used to develop better AI (amongst other things). This will lead to runaway growth.

This on its own is not an argument for discontinuity: before we have AI that radically accelerates AI development, the slow takeoff argument suggests we will have AI that _significantly_ accelerates AI development (and before that, _slightly_ accelerates development). That is, an AI is just another, faster step in the [hyperbolic growth we are currently experiencing](https://sideways-view.com/2017/10/04/hyperbolic-growth/), which corresponds to a further increase in rate but not a discontinuity (or even a discontinuity in rate).

The most common argument for recursive self-improvement introducing a new discontinuity seems be: some systems "fizzle out" when they try to design a better AI, generating a few improvements before running out of steam, while others are able to autonomously generate more and more improvements. This is basically the same as the universality argument in a previous section.

#### Train vs. test

_Summary of my response: before you can train a really powerful AI, someone else can train a slightly worse AI_.

Over the course of training, ML systems typically go quite quickly from "really lame" to "really awesome"-over the timescale of days, not months or years.

But the training curve seems almost irrelevant to takeoff speeds. The question is: how much better is your AGI then the AGI that you were able to train 6 months ago?

If you are able to raise $X to train an AGI that could take over the world, then it was almost certainly worth it for someone 6 months ago to raise $X/2 to train an AGI that could merely radically transform the world, since they would then get 6 months of absurd profits. Likewise, if your AGI would give you a decisive strategic advantage, they could have spent less earlier in order to get a pretty large military advantage, which they could then use to take your stuff.

In order to actually get a discontinuity, it needs to be the case that either scaling up the training effort slightly, or waiting a little while longer for better AI technology, leads to a discontinuity in usefulness. So we're back to the other arguments.

#### Discontinuities at 100% automation

_Summary of my response: at the point where humans are completely removed from a process, they will have been modestly improving output rather than acting as a sharp bottleneck that is suddenly removed._

Consider a simple model in which machines are able to do a _p_ fraction of the subtasks of some large task (like AGI design), with constantly increasing efficiency, and humans are needed to perform the final (1-_p_). If humans are the dominant cost, and we hold fixed the number of humans as _p_ increases, then total output grows like 1 / (1-_p_). As we approach 0, productivity rapidly to the machine-only level. In the past I found this argument pretty compelling.

Suppose that we removed the humans altogether from this process. On the naive model, productivity would jump from 0 (since machines can't do the task) to some very large value. I find that pretty unlikely, and it's precisely what we've discussed in the previous sections. It seems much more likely that at the first point when machines are able to do a task on their own, they are able to do it extremely poorly-and growth thereafter seems like it ought to accelerate gradually.

Adding humans to the picture only seems to make the change more gradual: at early times humans accelerate progress a lot, and as time goes on they provide less and less advantage (as machines replace them), so totally replacing humans seems to reduce acceleration.

Ultimately it seems like this comes down to whether you already expect discontinuous progress based on one of the other arguments, especially the secret sauce or universality threshold arguments. Phasing out humans seems to decrease, rather than increase, the abruptness of those changes.

This argument is still an important one, and it is true that if one of the other arguments generates a discontinuity then that discontinuity will probably be around the same time as 100% automation. But this argument is mostly relevant as a response to certain counterarguments about complementarity that I didn't actually make in any of the other sections.

#### The weight of evidence

We've discussed a lot of possible arguments for fast takeoff. Superficially it would be reasonable to believe that no individual argument makes fast takeoff look likely, but that in the aggregate they are convincing.

However, I think each of these factors is perfectly consistent with the continuous change story and continuously accelerating hyperbolic growth, and so none of them undermine that hypothesis at all. This is not a case of a bunch of weak signs of fast takeoff providing independent evidence, or of a bunch of weak factors that can mechanically combine to create a large effect.

(The chimps vs. humans case is an exception-it does provide Bayesian evidence for fast takeoff that could be combined with other factors. But it's just one.)

I could easily be wrong about any one of these lines of argument. So I do assign a much higher probability to fast takeoff than I would if there were fewer arguments (I'm around 30% of fast takeoff). But i f I change my mind, it will probably be because one of these arguments (or another argument not considered here) turns out to be compelling on its own. My impression is that other people in the safety community have more like a 70% or even 90% chance of fast takeoff, which I assume is because they _already_ find some of these arguments compelling.

### Why does this matter?

Sometimes people suggest that we should focus on fast takeoff even if it is less likely. While I agree that slow takeoff improves our probability of survival overall, I don't think either: (a) slow takeoff is so safe that it's not important to think about, or (b) plans designed to cope with fast takeoff will also be fine if there is a slow takeoff.

Neither takeoff speed seems unambiguously easier-to-survive than the other:

* If takeoff is slow: it will become quite obvious that AI is going to transform the world well _before_ we kill ourselves, we will have some time to experiment with different approaches to safety, policy-makers will have time to understand and respond to AI, _etc._ But this process will take place over only a few years, and the world will be changing very quickly, so we could easily drop the ball unless we prepare in advance.
* If takeoff is fast: whoever develops AGI first has a massive advantage over the rest of the world and hence great freedom in choosing what to do with their invention. If we imagine AGI being built in a world like today, it's easy to imagine pivotal actions that are easier than the open-ended alignment problem. But in slow takeoff scenarios, other actors will already have nearly-as-good-AGI, and a group that tries to use AGI in a very restricted or handicapped way won't be able to take any pivotal action. So we either need to coordinate to avoid deploying hard-to-control AGI, or we need to solve a hard version of AI alignment (e.g. with very good [security / competitiveness / scalability](https://ai-alignment.com/directions-and-desiderata-for-ai-control-b60fca0da8f4)).

These differences affect our priorities:

* If takeoff is more likely to be slow:
  * We should have policy proposals and institutions in place which can take advantage of the ramp-up period, because coordination is more necessary and more feasible.
  * We can afford to iterate on alignment approaches, but we need to solve a relatively hard version of the alignment problem.
* If takeoff is more likely to be fast:
  * We shouldn't expect state involvement or large-scale coordination.
  * We'll have less time at the last minute to iterate on alignment, but it might be OK if our solutions aren't competitive or have limited scalability (they only have to scale far enough to take a pivotal action).

Beyond the immediate strategic implications, I often feel like I have a totally different world in mind than other people in the AI safety community. Given that my career is aimed at influencing the future of AI, significantly changing my beliefs about that future seems like a big win.
