---
title: "Intelligence Explosion: Evidence and Import"
author: Luke Muehlhauser, Anna Salamon
source_url: https://intelligence.org/files/IE-EI.pdf
---

## Abstract

In this chapter we review the evidence for and against three claims: that (1) there is a substantial chance we will create human-level AI before 2100, that (2) if human-level AI is created, there is a good chance vastly superhuman AI will follow via an "intelligence explosion," and that (3) an uncontrolled intelligence explosion could destroy everything we value, but a controlled intelligence explosion would benefit humanity enormously if we can achieve it. We conclude with recommendations for increasing the odds of a controlled intelligence explosion relative to an uncontrolled intelligence explosion.

> The best answer to the question, "Will computers ever be as smart as humans?" is probably "Yes, but only briefly."
>
> —Vernor Vinge

## 1. Introduction
Humans may create human-level1 artificial intelligence (AI) this century. Shortly there-
after, we may see an “intelligence explosion” or “technological singularity”—a chain of
events by which human-level AI leads, fairly rapidly, to intelligent systems whose capa-
bilities far surpass those of biological humanity as a whole.
How likely is this, and what will the consequences be? Others have discussed these
questions previously (Turing 1950, 1951; Good 1959, 1965, 1970, 1982; von Neumann
1966; Minsky 1984; Solomonoff1985; Vinge 1993; Yudkowsky 2008a; Nilsson 2009,
chap. 35; Chalmers 2010; Hutter 2012); our aim is to provide a brief review suitable
both for newcomers to the topic and for those with some familiarity with the topic but
expertise in only some of the relevant fields.
For a more comprehensive review of the arguments, we refer our readers to Chalmers
(2010, 2012) and Bostrom (forthcoming). In this short chapter we will quickly survey
some considerations for and against three claims:
1. There is a substantial chance we will create human-level AI before 2100;
2. If human-level AI is created, there is a good chance vastly superhuman AI will
follow via an intelligence explosion;
3. An uncontrolled intelligence explosion could destroy everything we value, but a
controlled intelligence explosion would benefit humanity enormously if we can
achieve it.
Because the term “singularity” is popularly associated with several claims and approaches
we will not defend (Sandberg 2010), we will first explain what we are not claiming.
First, we will not tell detailed stories about the future. Each step of a story may be
probable, but if there are many such steps, the whole story itself becomes improbable
(Nordmann 2007; Tversky and Kahneman 1983). We will not assume the continu-
ation of Moore’s law, nor that hardware trajectories determine software progress, nor
that faster computer speeds necessarily imply faster “thought” (Proudfoot and Copeland
2012), nor that technological trends will be exponential (Kurzweil 2005) rather than “S-
curved” or otherwise (Modis 2012), nor indeed that AI progress will accelerate rather
1. We will define “human-level AI” more precisely later in the chapter.
than decelerate (Plebe and Perconti 2012). Instead, we will examine convergent out-
comes that—like the evolution of eyes or the emergence of markets—can come about
through any of several different paths and can gather momentum once they begin. Hu-
mans tend to underestimate the likelihood of outcomes that can come about through
many different paths (Tversky and Kahneman 1974), and we believe an intelligence ex-
plosion is one such outcome.
Second, we will not assume that human-level intelligence can be realized by a classical
Von Neumann computing architecture, nor that intelligent machines will have internal
mental properties such as consciousness or human-like “intentionality,” nor that early
AIs will be geographically local or easily “disembodied.” These properties are not re-
quired to build AI, so objections to these claims (Lucas 1961; Dreyfus 1972; Searle
1980; Block 1981; Penrose 1994; van Gelder and Port 1995) are not objections to AI
(Chalmers 1996, chap. 9; Nilsson 2009, chap. 24; McCorduck 2004, chap. 8 and 9;
Legg 2008; Heylighen 2012) or to the possibility of intelligence explosion (Chalmers
2012).2 For example: a machine need not be conscious to intelligently reshape the world
according to its preferences, as demonstrated by goal-directed “narrow AI” programs
such as the leading chess-playing programs.
We must also be clear on what we mean by “intelligence” and by “AI.” Concern-
ing “intelligence,” Legg and Hutter (2007) found that definitions of intelligence used
throughout the cognitive sciences converge toward the idea that “Intelligence measures
an agent’s ability to achieve goals in a wide range of environments.” We might call this
the “optimization power” concept of intelligence, for it measures an agent’s power to
optimize the world according to its preferences across many domains. But consider two
agents which have equal ability to optimize the world according to their preferences,
one of which requires much more computational time and resources to do so. They
2. Chalmers (2010) suggested that AI will lead to intelligence explosion if an AI is produced by an
“extendible method,” where an extendible method is “a method that can easily be improved, yielding
more intelligent systems.” McDermott (2012a, 2012b) replies that if P̸=NP (see Goldreich [2010] for an
explanation) then there is no extendible method. But McDermott’s notion of an extendible method is not
the one essential to the possibility of intelligence explosion. McDermott’s formalization of an “extendible
method” requires that the program generated by each step of improvement under the method be able
to solve in polynomial time all problems in a particular class—the class of solvable problems of a given
(polynomially step-dependent) size in an NP-complete class of problems. But this is not required for an
intelligence explosion in Chalmers’ sense (and in our sense). What intelligence explosion (in our sense)
would require is merely that a program self-improve to vastly outperform humans, and we argue for the
plausibility of this in section 3 of our chapter. Thus while we agree with McDermott that it is probably
true that P̸=NP, we do not agree that this weighs against the plausibility of intelligence explosion. (Note
that due to a miscommunication between McDermott and the editors, a faulty draft of McDermott
[2012a] was published in Journal of Consciousness Studies. We recommend reading the corrected version
at http://cs-www.cs.yale.edu/homes/dvm/papers/chalmers-singularity-response.pdf.)
have the same optimization power, but one seems to be optimizing more intelligently.
For this reason, we adopt a description of intelligence as optimization power divided
by resources used (Yudkowsky 2008b).3 For our purposes, “intelligence” measures an
agent’s capacity for efficient cross-domain optimization of the world according to the
agent’s preferences. Using this definition, we can avoid common objections to the use
of human-centric notions of intelligence in discussions of the technological singularity
(Greenfield 2012), and hopefully we can avoid common anthropomorphisms that often
arise when discussing intelligence (Muehlhauser and Helm 2012).
By “AI,” we refer to general AI rather than narrow AI. That is, we refer to “systems
which match or exceed the [intelligence] of humans in virtually all domains of interest”
(Shulman and Bostrom 2012). By this definition, IBM’s Jeopardy!-playing computer
Watson is not an “AI” (in our sense) but merely a narrow AI, because it can only solve
a narrow set of problems. Drop Watson in a pond or ask it to do original science, and it
would be helpless even if given a month’s warning to prepare. Imagine instead a machine
that could invent new technologies, manipulate humans with acquired social skills, and
otherwise learn to navigate many new social and physical environments as needed to
achieve its goals.
Which kinds of machines might accomplish such feats? There are many possible
types. A whole brain emulation (WBE) would be a computer emulation of brain struc-
tures sufficient to functionally reproduce human cognition. We need not understand
the mechanisms of general intelligence to use the human intelligence software already
invented by evolution (Sandberg and Bostrom 2008). In contrast, “de novo AI” requires
inventing intelligence software anew. There is a vast space of possible mind designs for
de novo AI (Dennett 1996; Yudkowsky 2008a). De novo AI approaches include the sym-
bolic, probabilistic, connectionist, evolutionary, embedded, and other research programs
(Pennachin and Goertzel 2007).
## 2. From Here to AI
When should we expect the first creation of AI? We must allow for a wide range of
possibilities. Except for weather forecasters (Murphy and Winkler 1984), and success-
ful professional gamblers, nearly all of us give inaccurate probability estimates, and in
particular we are overconfident of our predictions (Lichtenstein, Fischhoff, and Phillips
3. This definition is a useful starting point, but it could be improved. Future work could produce
a definition of intelligence as optimization power over a canonical distribution of environments, with a
penalty for resource use—e.g. the “speed prior” described by Schmidhuber (2002). Also see Goertzel
(2006, 48; 2010) and Hibbard (2011).
1982; Griffin and Tversky 1992; Yates et al. 2002). This overconfidence affects profes-
sional forecasters, too (Tetlock 2005), and we have little reason to think AI forecasters
have fared any better.4 So if you have a gut feeling about when AI will be created, it is
probably wrong.
But uncertainty is not a “get out of prediction free” card (Bostrom 2007). We still
need to decide whether or not to encourage WBE development, whether or not to help
fund AI safety research, etc. Deciding either way already implies some sort of prediction.
Choosing not to fund AI safety research suggests that we do not think AI is near, while
funding AI safety research implies that we think AI might be coming soon.
### 2.1. Predicting AI
How, then, might we predict when AI will be created? We consider several strategies below.

**By gathering the wisdom of experts or crowds.** Many experts and groups have tried to predict the creation of AI. Unfortunately, experts' predictions are often little better
than those of laypeople (Tetlock 2005), expert elicitation methods have in general not
proven useful for long-term forecasting,5 and prediction markets (ostensibly drawing
on the opinions of those who believe themselves to possess some expertise) have not yet
been demonstrated useful for technological forecasting (Williams 2011). Still, it may
be useful to note that none to few experts expect AI within five years, whereas many
experts expect AI by 2050 or 2100.6

**By simple hardware extrapolation.** The novelist Vernor Vinge (1993) based his own predictions about AI on hardware trends, but in a 2003 reprint of his article, Vinge notes
the insufficiency of this reasoning: even if we acquire hardware sufficient for AI, we may
not have the software problem solved.7
Hardware extrapolation may be a more useful method in a context where the intelli-
gence software is already written: whole brain emulation. Because WBE seems to rely
4. To take one of many examples, Simon (1965, 96) predicted that “machines will be capable, within
twenty years, of doing any work a man can do.” Also see Crevier (1993).
5. Armstrong (1985), Woudenberg (1991), and Rowe and Wright (2001). But, see Parente and
Anderson-Parente (2011).
6. Bostrom (2003), Bainbridge and Roco (2006), Legg (2008), Baum, Goertzel, and Goertzel (2011),
Sandberg and Bostrom (2011), and Nielsen (2011).
7. A software bottleneck may delay AI but create greater risk. If there is a software bottleneck on AI,
then when AI is created there may be a “computing overhang”: large amounts of inexpensive computing
power which could be used to run thousands of AIs or give a few AIs vast computational resources. This
may not be the case if early AIs require quantum computing hardware, which is less likely to be plentiful
and inexpensive than classical computing hardware at any given time.
mostly on scaling up existing technologies like microscopy and large-scale cortical sim-
ulation, WBE may be largely an “engineering” problem, and thus the time of its arrival
may be more predictable than is the case for other kinds of AI.
Several authors have discussed the difficulty of WBE in detail (Kurzweil 2005; Sand-
berg and Bostrom 2008; de Garis et al. 2010; Modha et al. 2011; Cattell and Parker
2012). In short: The difficulty of WBE depends on many factors, and in particular
on the resolution of emulation required for successful WBE. For example, proteome-
resolution emulation would require more resources and technological development than
emulation at the resolution of the brain’s neural network. In perhaps the most likely
scenario,
WBE on the neuronal/synaptic level requires relatively modest increases in
microscopy resolution, a less trivial development of automation for scanning
and image processing, a research push at the problem of inferring functional
properties of neurons and synapses, and relatively business-as-usual develop-
ment of computational neuroscience models and computer hardware. (Sand-
berg and Bostrom 2008, 83)

**By considering the time since Dartmouth.** We have now seen more than 50 years of work toward machine intelligence since the seminal Dartmouth conference on AI, but AI
has not yet arrived. This seems, intuitively, like strong evidence that AI won’t arrive in
the next minute, good evidence it won’t arrive in the next year, and significant but far
from airtight evidence that it won’t arrive in the next few decades. Such intuitions can
be formalized into models that, while simplistic, can form a useful starting point for
estimating the time to machine intelligence.8
8. We can make a simple formal model of this evidence by assuming (with much simplification) that
every year a coin is tossed to determine whether we will get AI that year, and that we are initially unsure
of the weighting on that coin. We have observed more than 50 years of “no AI” since the first time
serious scientists believed AI might be around the corner. This “56 years of no AI” observation would
be highly unlikely under models where the coin comes up “AI” on 90% of years (the probability of our
observations would be 10−56), or even models where it comes up “AI” in 10% of all years (probability
0.3%), whereas it’s the expected case if the coin comes up “AI” in, say, 1% of all years, or for that matter
in 0.0001% of all years. Thus, in this toy model, our “no AI for 56 years” observation should update
us strongly against coin weightings in which AI would be likely in the next minute, or even year, while
leaving the relative probabilities of “AI expected in 200 years” and “AI expected in 2 million years” more
or less untouched. (These updated probabilities are robust to choice of the time interval between coin
flips; it matters little whether the coin is tossed once per decade, or once per millisecond, or whether
one takes a limit as the time interval goes to zero.) Of course, one gets a different result if a different
“starting point” is chosen, e.g. Alan Turing’s seminal paper on machine intelligence (Turing 1950), or the
inaugural conference on artificial general intelligence (Wang, Goertzel, and Franklin 2008). For more
on this approach and Laplace's rule of succession, see Jaynes (2003, chap. 18). We suggest this approach

**By tracking progress in machine intelligence.** Some people intuitively estimate the time until AI by asking what proportion of human abilities today's software can match, and
how quickly machines are catching up.9 However, it is not clear how to divide up the
space of “human abilities,” nor how much each one matters. We also don’t know if
progress in machine intelligence will be linear, exponential, or otherwise. Watching an
infant’s progress in learning calculus might lead one to infer the child will not learn it
until the year 3000, until suddenly the child learns it in a spurt at age 17. Still, it may be
worth asking whether a measure can be found for which both: (a) progress is predictable
enough to extrapolate; and (b) when performance rises to a certain level, we can expect
AI.

**By extrapolating from evolution.** Evolution managed to create intelligence without using intelligence to do so. Perhaps this fact can help us establish an upper bound on
the difficulty of creating AI (Chalmers 2010; Moravec 1976, 1998, 1999), though this
approach is complicated by observation selection effects (Shulman and Bostrom 2012).

**By estimating progress in scientific research output.** Imagine a man digging a
ten-kilometer ditch. If he digs 100 meters in one day, you might predict the ditch
will be finished in 100 days. But what if 20 more diggers join him, and they are all
given backhoes? Now the ditch might not take so long. Analogously, when predicting
progress toward AI it may be useful to consider not how much progress is made per year,
but instead how much progress is made per unit of research effort, and how many units
of research effort we can expect to be applied to the problem in the coming decades.
Unfortunately, we have not yet discovered demonstrably reliable methods for long-
term technological forecasting. New methods are being tried (Nagy et al. 2010), but
until they prove successful we should be particularly cautious when predicting AI time-
lines. Below, we attempt a final approach by examining some plausible speed bumps and
accelerators on the path to AI.
### 2.2. Speed Bumps
Several factors may decelerate our progress toward the first creation of AI. For example:
**An end to Moore's law.** Though several information technologies have progressed at an exponential or superexponential rate for many decades (Nagy et al. 2011), this trend may not hold for much longer (Mack 2011).

**Depletion of low-hanging fruit.** Scientific progress is not only a function of research
effort but also of the ease of scientific discovery; in some fields there is pattern of in-
creasing difficulty with each successive discovery (Arbesman 2011; Jones 2009). AI may
prove to be a field in which new discoveries require far more effort than earlier discov-
eries.

**Societal collapse.** Various political, economic, technological, or natural disasters may lead to a societal collapse during which scientific progress would not continue (Posner 2004; Bostrom and Ćirković 2008).

**Disinclination.** Chalmers (2010) and Hutter (2012) think the most likely speed bump
in our progress toward AI will be disinclination, including active prevention. Perhaps
humans will not want to create their own successors. New technologies like “Nanny AI”
(Goertzel 2012), or new political alliances like a stable global totalitarianism (Caplan
2008), may empower humans to delay or prevent scientific progress that could lead to
the creation of AI.
### 2.3. Accelerators

Other factors, however, may accelerate progress toward AI:

**More hardware.** For at least four decades, computing power10 has increased exponentially, roughly in accordance with Moore's law.11 Experts disagree on how much longer
Moore’s law will hold (Mack 2011; Lundstrom 2003), but even if hardware advances
more slowly than exponentially, we can expect hardware to be far more powerful in a few
decades than it is now.12 More hardware doesn’t by itself give us machine intelligence,
but it contributes to the development of machine intelligence in several ways:
Powerful hardware may improve performance simply by allowing existing
“brute force” solutions to run faster (Moravec 1976). Where such solutions
do not yet exist, researchers might be incentivized to quickly develop them
given abundant hardware to exploit. Cheap computing may enable much
more extensive experimentation in algorithm design, tweaking parameters or
using methods such as genetic algorithms. Indirectly, computing may enable
10. The technical measure predicted by Moore’s law is the density of components on an integrated
circuit, but this is closely tied to the price-performance of computing power.
11. For important qualifications, see Nagy et al. (2010) and Mack (2011).
12. Quantum computing may also emerge during this period. Early worries that quantum computing
may not be feasible have been overcome, but it is hard to predict whether quantum computing will con-
tribute significantly to the development of machine intelligence because progress in quantum computing
depends heavily on relatively unpredictable insights in quantum algorithms and hardware (Rieffel and
Polak 2011).
the production and processing of enormous datasets to improve AI perfor-
mance (Halevy, Norvig, and Pereira 2009), or result in an expansion of the
information technology industry and the quantity of researchers in the field.
(Shulman and Sandberg 2010)

**Better algorithms.** Often, mathematical insights can reduce the computation time of a program by many orders of magnitude without additional hardware. For example,
IBM’s Deep Blue played chess at the level of world champion Garry Kasparov in 1997
using about 1.5 trillion instructions per second (TIPS), but a program called Deep Junior
did it in 2003 using only 0.015 TIPS. Thus, the computational efficiency of the chess
algorithms increased by a factor of 100 in only six years (Richards and Shaw 2004).

**Massive datasets.** The greatest leaps forward in speech recognition and translation software have come not from faster hardware or smarter hand-coded algorithms, but
from access to massive data sets of human-transcribed and human-translated words
(Halevy, Norvig, and Pereira 2009). Datasets are expected to increase greatly in size
in the coming decades, and several technologies promise to actually outpace “Kryder’s
law” (Kryder and Kim 2009), which states that magnetic disk storage density doubles
approximately every 18 months (Walter 2005).

**Progress in psychology and neuroscience.** Cognitive scientists have uncovered many of the brain's algorithms that contribute to human intelligence (Trappenberg 2009; Ashby
and Helie 2011). Methods like neural networks (imported from neuroscience) and re-
inforcement learning (inspired by behaviorist psychology) have already resulted in sig-
nificant AI progress, and experts expect this insight-transfer from neuroscience to AI to
continue and perhaps accelerate (Van der Velde 2010; Schierwagen 2011; Floreano and
Mattiussi 2008; de Garis et al. 2010; Krichmar and Wagatsuma 2011).

**Accelerated science.** A growing First World will mean that more researchers at well-funded universities will be conducting research relevant to machine intelligence. The
world’s scientific output (in publications) grew by one third from 2002 to 2007 alone,
much of this driven by the rapid growth of scientific output in developing nations like
China and India (Royal Society 2011).13 Moreover, new tools can accelerate particu-
lar fields, just as fMRI accelerated neuroscience in the 1990s, and the effectiveness of
scientists themselves can potentially be increased with cognitive enhancement pharma-
ceuticals (Bostrom and Sandberg 2009), and brain-computer interfaces that allow direct
neural access to large databases (Groß 2009). Finally, new collaborative tools like blogs
13. On the other hand, some worry (Pan et al. 2005), that the rates of scientific fraud and publication
bias may currently be higher in China and India than in the developed world.
and Google Scholar are already yielding results such as the Polymath Project, which is
rapidly and collaboratively solving open problems in mathematics (Nielsen 2011).14

**Economic incentive.** As the capacities of "narrow AI" programs approach the capacities of humans in more domains (Koza 2010), there will be increasing demand to replace
human workers with cheaper, more reliable machine workers (Hanson 2008, 1998; Kaas
et al. 2010; Brynjolfsson and McAfee 2011).

**First-mover incentives.** Once AI looks to be within reach, political and private actors will see substantial advantages in building AI first. AI could make a small group more
powerful than the traditional superpowers—a case of “bringing a gun to a knife fight.”
The race to AI may even be a “winner take all” scenario. Thus, political and private actors
who realize that AI is within reach may devote substantial resources to developing AI
as quickly as possible, provoking an AI arms race (Gubrud 1997).
### 2.4. How Long, Then, Before AI?
So, when will we create AI? Any predictions on the matter must have wide error bars.
Given the history of confident false predictions about AI (Crevier 1993), and AI’s po-
tential speed bumps, it seems misguided to be 90% confident that AI will succeed in the
coming century. But 90% confidence that AI will not arrive before the end of the century
also seems wrong, given that: (a) many difficult AI breakthroughs have now been made,
(b) several factors, such as automated science and first-mover incentives, may well accel-
erate progress toward AI, and (c) whole brain emulation seems to be possible and have
a more predictable development than de novo AI. Thus, we think there is a significant
probability that AI will be created this century. This claim is not scientific—the field of
technological forecasting is not yet advanced enough for that—but we believe our claim
is reasonable.
The creation of human-level AI would have serious repercussions, such as the dis-
placement of most or all human workers (Brynjolfsson and McAfee 2011). But if AI is
likely to lead to machine superintelligence, as we argue next, the implications could be
even greater.
14. Also, a process called “iterated embryo selection” (Uncertain Future 2012), could be used to produce
an entire generation of scientists with the cognitive capabilities of Albert Einstein or John von Neumann,
thus accelerating scientific progress and giving a competitive advantage to nations which choose to make
use of this possibility.
## 3. From AI to Machine Superintelligence
It seems unlikely that humans are near the ceiling of possible intelligences, rather than
simply being the first such intelligence that happened to evolve. Computers far outper-
form humans in many narrow niches (e.g. arithmetic, chess, memory size), and there is
reason to believe that similar large improvements over human performance are possible
for general reasoning, technology design, and other tasks of interest. As occasional AI
critic Jack Schwartz (1987) wrote:
If artificial intelligences can be created at all, there is little reason to believe
that initial successes could not lead swiftly to the construction of artificial su-
perintelligences able to explore significant mathematical, scientific, or engi-
neering alternatives at a rate far exceeding human ability, or to generate plans
and take action on them with equally overwhelming speed. Since man’s near-
monopoly of all higher forms of intelligence has been one of the most basic
facts of human existence throughout the past history of this planet, such de-
velopments would clearly create a new economics, a new sociology, and a new
history.
Why might AI “lead swiftly” to machine superintelligence? Below we consider some
reasons.
### 3.1. AI Advantages
Below we list a few AI advantages that may allow AIs to become not only vastly more
intelligent than any human, but also more intelligent than all of biological humanity
(Sotala 2012; Legg 2008). Many of these are unique to machine intelligence, and that
is why we focus on intelligence explosion from AI rather than from biological cognitive
enhancement (Sandberg 2011).
**Increased computational resources.** The human brain uses 85–100 billion neurons. This
limit is imposed by evolution-produced constraints on brain volume and metabolism.
In contrast, a machine intelligence could use scalable computational resources (imagine
a “brain” the size of a warehouse). While algorithms would need to be changed in order
to be usefully scaled up, one can perhaps get a rough feel for the potential impact here by
noting that humans have about 3.5 times the brain size of chimps (Schoenemann 1997),
and that brain size and IQ correlate positively in humans, with a correlation coefficient
of about 0.35 (McDaniel 2005). One study suggested a similar correlation between
brain size and cognitive ability in rats and mice (Anderson 1993).15
15. Note that given the definition of intelligence we are using, greater computational resources would
not give a machine more “intelligence” but instead more “optimization power.”
**Communication speed.** Axons carry spike signals at 75 meters per second or less (Kan-
del, Schwartz, and Jessell 2000). That speed is a fixed consequence of our physiology.
In contrast, software minds could be ported to faster hardware, and could therefore pro-
cess information more rapidly. (Of course, this also depends on the efficiency of the
algorithms in use; faster hardware compensates for less efficient software.)
**Increased serial depth.** Due to neurons’ slow firing speed, the human brain relies on
massive parallelization and is incapable of rapidly performing any computation that re-
quires more than about 100 sequential operations (Feldman and Ballard 1982). Perhaps
there are cognitive tasks that could be performed more efficiently and precisely if the
brain’s ability to support parallelizable pattern-matching algorithms were supplemented
by support for longer sequential processes. In fact, there are many known algorithms
for which the best parallel version uses far more computational resources than the best
serial algorithm, due to the overhead of parallelization.16
**Duplicability.** Our research colleague Steve Rayhawk likes to describe AI as “instant
intelligence; just add hardware!” What Rayhawk means is that, while it will require ex-
tensive research to design the first AI, creating additional AIs is just a matter of copying
software. The population of digital minds can thus expand to fill the available hardware
base, perhaps rapidly surpassing the population of biological minds.
Duplicability also allows the AI population to rapidly become dominated by newly
built AIs, with new skills. Since an AI’s skills are stored digitally, its exact current state
can be copied,17 including memories and acquired skills—similar to how a “system state”
can be copied by hardware emulation programs or system backup programs. A human
who undergoes education increases only his or her own performance, but an AI that
becomes 10% better at earning money (per dollar of rentable hardware) than other AIs
can be used to replace the others across the hardware base—making each copy 10% more
efficient.18
**Editability.** Digitality opens up more parameters for controlled variation than is pos-
sible with humans. We can put humans through job-training programs, but we can’t
perform precise, replicable neurosurgeries on them. Digital workers would be more
editable than human workers are. Consider first the possibilities from whole brain em-
ulation. We know that transcranial magnetic stimulation (TMS) applied to one part of
16. For example see Omohundro (1987).
17. If the first self-improving AIs at least partially require quantum computing, the system states of
these AIs might not be directly copyable due to the no-cloning theorem (Wootters and Zurek 1982).
18. Something similar is already done with technology-enabled business processes. When the phar-
macy chain CVS improves its prescription-ordering system, it can copy these improvements to more than
4,000 of its stores, for immediate productivity gains (McAfee and Brynjolfsson 2008).
the prefrontal cortex can improve working memory (Fregni et al. 2005). Since TMS
works by temporarily decreasing or increasing the excitability of populations of neurons,
it seems plausible that decreasing or increasing the “excitability” parameter of certain
populations of (virtual) neurons in a digital mind would improve performance. We
could also experimentally modify dozens of other whole brain emulation parameters,
such as simulated glucose levels, undifferentiated (virtual) stem cells grafted onto par-
ticular brain modules such as the motor cortex, and rapid connections across different
parts of the brain.19 Secondly, a modular, transparent AI could be even more directly
editable than a whole brain emulation—possibly via its source code. (Of course, such
possibilities raise ethical concerns.)
**Goal coordination.** Let us call a set of AI copies or near-copies a “copy clan.” Given
shared goals, a copy clan would not face certain goal coordination problems that limit
human effectiveness (J. W. Friedman 1994). A human cannot use a hundredfold salary
increase to purchase a hundredfold increase in productive hours per day. But a copy clan,
if its tasks are parallelizable, could do just that. Any gains made by such a copy clan, or
by a human or human organization controlling that clan, could potentially be invested
in further AI development, allowing initial advantages to compound.
**Improved rationality.** Some economists model humans as Homo economicus: self-
interested rational agents who do what they believe will maximize the fulfillment of
their goals (M. Friedman 1953). On the basis of behavioral studies, though, Schneider
(2010) points out that we are more akin to Homer Simpson: we are irrational beings
that lack consistent, stable goals (Schneider 2010; Cartwright 2011). But imagine if you
were an instance of Homo economicus. You could stay on a diet, spend the optimal amount
of time learning which activities will achieve your goals, and then follow through on an
optimal plan, no matter how tedious it was to execute. Machine intelligences of many
types could be written to be vastly more rational than humans, and thereby accrue the
benefits of rational thought and action. The rational agent model (using Bayesian prob-
ability theory and expected utility theory) is a mature paradigm in current AI design
(Hutter 2005; Russell and Norvig 2010, ch. 2).
These AI advantages suggest that AIs will be capable of far surpassing the cognitive
abilities and optimization power of humanity as a whole, but will they be motivated to
do so? Though it is difficult to predict the specific motivations of advanced AIs, we can
make some predictions about convergent instrumental goals—instrumental goals useful
for the satisfaction of almost any final goals.
19. Many suspect that the slowness of cross-brain connections has been a major factor limiting the
usefulness of large brains (Fox 2011).
### 3.2. Instrumentally Convergent Goals
Omohundro (2007, 2008, 2012) and Bostrom (forthcoming) argue that there are several
instrumental goals that will be pursued by almost any advanced intelligence because
those goals are useful intermediaries to the achievement of almost any set of final goals.
For example:
1. An AI will want to preserve itself because if it is destroyed it won’t be able to act
in the future to maximize the satisfaction of its present final goals.
2. An AI will want to preserve the content of its current final goals because if the
content of its final goals is changed it will be less likely to act in the future to
maximize the satisfaction of its present final goals.20
3. An AI will want to improve its own rationality and intelligence because this will
improve its decision-making, and thereby increase its capacity to achieve its goals.
4. An AI will want to acquire as many resources as possible, so that these resources
can be transformed and put to work for the satisfaction of the AI’s final and in-
strumental goals.
Later we shall see why these convergent instrumental goals suggest that the default out-
come from advanced AI is human extinction. For now, let us examine the mechanics of
AI self-improvement.
### 3.3. Intelligence Explosion
The convergent instrumental goal for self-improvement has a special consequence. Once
human programmers build an AI with a better-than-human capacity for AI design, the
instrumental goal for self-improvement may motivate a positive feedback loop of self-
enhancement.21 Now when the machine intelligence improves itself, it improves the
intelligence that does the improving. Thus, if mere human efforts suffice to produce
machine intelligence this century, a large population of greater-than-human machine
intelligences may be able to create a rapid cascade of self-improvement cycles, enabling
20. Bostrom (2012) lists a few special cases in which an AI may wish to modify the content of its final
goals.
21. When the AI can perform 10% of the AI design tasks and do them at superhuman speed, the
remaining 90% of AI design tasks act as bottlenecks. However, if improvements allow the AI to perform
99% of AI design tasks rather than 98%, this change produces a much larger impact than when improve-
ments allowed the AI to perform 51% of AI design tasks rather than 50% (Hanson 1998). And when the
AI can perform 100% of AI design tasks rather than 99% of them, this removes altogether the bottleneck
of tasks done at slow human speeds.
a rapid transition to machine superintelligence. Chalmers (2010) discusses this process
in some detail, so here we make only a few additional points.
The term “self,” in phrases like “recursive self-improvement” or “when the machine
intelligence improves itself,” is something of a misnomer. The machine intelligence
could conceivably edit its own code while it is running (Schmidhuber 2007; Schaul
and Schmidhuber 2010), but it could also create new intelligences that run indepen-
dently. Alternatively, several AIs (perhaps including WBEs) could work together to
design the next generation of AIs. Intelligence explosion could come about through
“self”-improvement or through other-AI improvement.
Once sustainable machine self-improvement begins, AI development need not pro-
ceed at the normal pace of human technological innovation. There is, however, sig-
nificant debate over how fast or local this “takeoff” would be (Hanson and Yudkowsky
2008; Loosemore and Goertzel 2011; Bostrom, forthcoming), and also about whether
intelligence explosion would result in a stable equilibrium of multiple machine superin-
telligences or instead a machine “singleton” (Bostrom 2006). We will not discuss these
complex issues here.
## 4. Consequences of Machine Superintelligence
If machines greatly surpass human levels of intelligence—that is, surpass humanity’s
capacity for efficient cross-domain optimization—we may find ourselves in a position
analogous to that of the apes who watched as humans invented fire, farming, writing,
science, guns and planes and then took over the planet. (One salient difference would be
that no single ape witnessed the entire saga, while we might witness a shift to machine
dominance within a single human lifetime.) Such machines would be superior to us in
manufacturing, harvesting resources, scientific discovery, social aptitude, and strategic
action, among other capacities. We would not be in a position to negotiate with them,
just as neither chimpanzees nor dolphins are in a position to negotiate with humans.
Moreover, intelligence can be applied in the pursuit of any goal. As Bostrom (2012)
argues, making AIs more intelligent will not make them want to change their goal
systems—indeed, AIs will be motivated to preserve their initial goals. Making AIs more
intelligent will only make them more capable of achieving their original final goals,
whatever those are.22
This brings us to the central feature of AI risk: Unless an AI is specifically pro-
grammed to preserve what humans value, it may destroy those valued structures (in-
22. This may be less true for early-generation WBEs, but Omohundro (2007) argues that AIs will
converge upon being optimizing agents, which exhibit a strict division between goals and cognitive ability.
cluding humans) incidentally. As Yudkowsky (2008a) puts it, “the AI does not love you,
nor does it hate you, but you are made of atoms it can use for something else.”
### 4.1. Achieving a Controlled Intelligence Explosion
How, then, can we give AIs desirable goals before they self-improve beyond our ability to
control them or negotiate with them?23 WBEs and other brain-inspired AIs running on
human-derived “spaghetti code” may not have a clear “slot” in which to specify desirable
goals (Marcus 2008). The same may also be true of other “opaque” AI designs, such as
those produced by evolutionary algorithms—or even of more transparent AI designs.
Even if an AI had a transparent design with a clearly definable utility function,24 would
we know how to give it desirable goals? Unfortunately, specifying what humans value
may be extraordinarily difficult, given the complexity and fragility of human preferences
(Yudkowsky 2011; Muehlhauser and Helm 2012), and allowing an AI to learn desirable
goals from reward and punishment may be no easier (Yudkowsky 2008a). If this is
correct, then the creation of self-improving AI may be detrimental by default unless we
first solve the problem of how to build an AI with a stable, desirable utility function—a
“Friendly AI” (Yudkowsky 2001).25
But suppose it is possible to build a Friendly AI (FAI) capable of radical self-
improvement. Normal projections of economic growth allow for great discoveries rel-
evant to human welfare to be made eventually—but a Friendly AI could make those
discoveries much sooner. A benevolent machine superintelligence could, as Bostrom
(2003) writes, “create opportunities for us to vastly increase our own intellectual and
emotional capabilities, and it could assist us in creating a highly appealing experiential
world in which we could live lives devoted [to] joyful game-playing, relating to each
other, experiencing, personal growth, and to living closer to our ideals.”
23. Hanson (2012) reframes the problem, saying that “we should expect that a simple continuation of
historical trends will eventually end up [producing] an ‘intelligence explosion’ scenario. So there is little
need to consider [Chalmers’] more specific arguments for such a scenario. And the inter-generational
conflicts that concern Chalmers in this scenario are generic conflicts that arise in a wide range of past,
present, and future scenarios. Yes, these are conflicts worth pondering, but Chalmers offers no reasons
why they are interestingly different in a ‘singularity’ context.” We briefly offer just one reason why the
“inter-generational conflicts” arising from a transition of power from humans to superintelligent machines
are interestingly different from previous the inter-generational conflicts: as Bostrom (2002) notes, the
singularity may cause the extinction not just of people groups but of the entire human species. For a
further reply to Hanson, see Chalmers (2012).
24. A utility function assigns numerical utilities to outcomes such that outcomes with higher utilities
are always preferred to outcomes with lower utilities (Mehta 1998).
25. It may also be an option to constrain the first self-improving AIs just long enough to develop a
Friendly AI before they cause much damage.
Thinking that FAI may be too difficult, Goertzel (2012) proposes a global “Nanny
AI” that would “forestall a full-on Singularity for a while, . . . giving us time to figure out
what kind of Singularity we really want to build and how.” Goertzel and others working
on AI safety theory would very much appreciate the extra time to solve the problems
of AI safety before the first self-improving AI is created, but your authors suspect that
Nanny AI is “FAI-complete,” or nearly so. That is, in order to build Nanny AI, you may
need to solve all the problems required to build full-blown Friendly AI, for example the
problem of specifying precise goals (Yudkowsky 2011; Muehlhauser and Helm 2012),
and the problem of maintaining a stable utility function under radical self-modification,
including updates to the AI’s internal ontology (de Blanc 2011).
The approaches to controlled intelligence explosion we have surveyed so far attempt
to constrain an AI’s goals, but others have suggested a variety of “external” constraints
for goal-directed AIs: physical and software confinement (Chalmers 2010; Yampolskiy
2012), deterrence mechanisms, and tripwires that shut down an AI if it engages in dan-
gerous behavior. Unfortunately, these solutions would pit human intelligence against
superhuman intelligence, and we shouldn’t be confident the former would prevail.
Perhaps we could build an AI of limited cognitive ability—say, a machine that only
answers questions: an “Oracle AI.” But this approach is not without its own dangers
(Armstrong, Sandberg, and Bostrom 2012).
Unfortunately, even if these latter approaches worked, they might merely delay AI
risk without eliminating it. If one AI development team has successfully built either
an Oracle AI or a goal-directed AI under successful external constraints, other AI de-
velopment teams may not be far from building their own AIs, some of them with less
effective safety measures. A Friendly AI with enough lead time, however, could perma-
nently prevent the creation of unsafe AIs.
### 4.2. What Can We Do About AI Risk?
Because superhuman AI and other powerful technologies may pose some risk of hu-
man extinction (“existential risk”), Bostrom (2002) recommends a program of differen-
tial technological development in which we would attempt “to retard the implementation
of dangerous technologies and accelerate implementation of beneficial technologies, es-
pecially those that ameliorate the hazards posed by other technologies.”
But good outcomes from intelligence explosion appear to depend not only on differ-
ential technological development but also, for example, on solving certain kinds of prob-
lems in decision theory and value theory before the first creation of AI (Muehlhauser
2011). Thus, we recommend a course of differential intellectual progress, which includes
differential technological development as a special case.
Differential intellectual progress consists in prioritizing risk-reducing intellectual
progress over risk-increasing intellectual progress. As applied to AI risks in particular,
a plan of differential intellectual progress would recommend that our progress on the
scientific, philosophical, and technological problems of AI safety outpace our progress
on the problems of AI capability such that we develop safe superhuman AIs before we
develop (arbitrary) superhuman AIs. Our first superhuman AI must be a safe super-
human AI, for we may not get a second chance (Yudkowsky 2008a). With AI as with
other technologies, we may become victims of “the tendency of technological advance
to outpace the social control of technology” (Posner 2004).
## 5. Conclusion
We have argued that AI poses an existential threat to humanity. On the other hand, with
more intelligence we can hope for quicker, better solutions to many of our problems. We
don’t usually associate cancer cures or economic stability with artificial intelligence, but
curing cancer is ultimately a problem of being smart enough to figure out how to cure
it, and achieving economic stability is ultimately a problem of being smart enough to
figure out how to achieve it. To whatever extent we have goals, we have goals that
can be accomplished to greater degrees using sufficiently advanced intelligence. When
considering the likely consequences of superhuman AI, we must respect both risk and
opportunity.26
