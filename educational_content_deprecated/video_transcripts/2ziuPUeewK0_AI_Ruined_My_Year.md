---
title: "AI Ruined My Year"
channel: "Robert Miles AI Safety"
url: "https://www.youtube.com/watch?v=2ziuPUeewK0"
---

[Music]

If you'd told me when I started this channel that I would be advising the UK government on risks of advanced artificial intelligence, I would have told you all those years ago, "Interesting. I'll definitely be wearing trousers at the time," right?

Anyway, sorry for the gap in uploads. There's been a lot going on. You may have seen in the news, although to be honest, that's not what's been using up most of my time. But yeah, there's been a lot going on, and so in this video I thought I'd try just talking about it.

So after GPT-4, a bunch of AI experts called for a six-month pause on giant training runs. Yudkowsky said that wouldn't help in a Time Magazine piece which called to shut it all down. Then another load of experts said that AI was an extinction risk like nuclear war, and the UK went all-in and launched an international summit. AI safety went mainstream. Geoffrey Hinton left Google to talk more freely about the risks. OpenAI made a new Superalignment team, plus we had Bard, Claude, Gemini, new Llama, GPT, and loads of other stuff. The EU AI Act, the US's executive order - it's an interesting time to be alive.

So first off, yes, I also find it vaguely annoying when YouTubers do a whole big apology for a gap in uploads. I know that most of you didn't notice and don't care, and that's good actually. But when it comes to why I found it so hard to make videos recently, I think there are some interesting things to talk about. So let's get into it.

So in the past, generally when people asked me why I was making these videos, I would say it's because AI safety is probably the single most important thing happening on Earth right now. Humanity may have reached the point in history where we achieve all the things we're hoping for or destroy ourselves completely, and it all hinges on how well we handle the creation of advanced AI. It depends on AI safety research, and there's amazingly few people working on that, and the public understanding of the field is fairly poor. So I want to help people to learn more about AI safety, I want to encourage people to get involved, and so on.

So I'd say that's why I'm making videos - to have a positive impact on the world by helping out with something extremely important. And I wasn't lying when I said that. It is all true on an intellectual level. But on a gut level, that was not where most of my motivation was actually coming from.

On a gut level, the thing driving me is really just that AI safety is extremely interesting. I think it's genuinely the most interesting topic in the world by a lot. Like, I don't even know what second place would be.

I think AI safety gets right at some of the most exciting questions there are. Questions about what minds really are and how they work. What thinking is and how we can do it better. And critical questions about values - what do we actually want? Like, what are we even going for as individuals and as a species?

AI safety has the conceptual challenge of philosophy, the engineering challenge of machine learning, and the adversarial cat and mouse of computer security or cryptography. All of the subtleties, the cool techniques people have come up with, the unexpected ways things can go wrong - it's just extremely fun to think about and fun to talk about. I'd want to make videos about it even if it wasn't also extremely important.

But it is extremely important, and in fact the importance and the seriousness of the subject was actually a force pushing against me publishing videos. Like, on the one hand I have "this is really cool and I want to explain it," and in the other hand is "oh, but this is also a big deal, we have to be careful, fact-check everything, and make sure not to make any mistakes," and so on. Perfectionism, basically.

And over the last year, things have shifted a little. As you may have noticed, the topic has become maybe a little less fun to think about for me, and also a fair bit more important-seeming, and therefore stress-inducing.

Why is it less fun for me? Well, it started to feel uncomfortably real and complicated and messy. Reality has a way of taking the shine off things sometimes. Learning about the game theory of how to fairly partition a set of resources between a number of players can be fun, but going through a messy divorce is not.

Now, I thought that this was all real to me before, but I guess there's always been a part of me that says, "Sure, but what if we're wrong though?" I think it's really important to keep that voice alive, to keep open the hypothesis that you might be mistaken.

So in addition to a voice telling me that this was a very big deal, whenever I was at risk of taking things too seriously, that skeptical part of me would be there to bring a little balance, usually by talking about what other people are thinking:

"We need to tell people about these arguments that AI will become extremely dangerous in the future."

"Yeah, the arguments do seem to make sense, but the conclusion that we have to be worried about AI killing everyone seems kind of nuts. So maybe we're just crazy, I guess."

"But there really does seem to be a non-trivial chance of that actually happening. The world is allowed to be crazy. Crazy-seeming things do actually happen from time to time."

"This concern isn't exactly mainstream in the field, is it, though? A significant portion of the experts don't seem convinced. Maybe we're missing something."

"I think that by the time they're convinced, it'll be too late to do much about it."

"AGI could happen pretty soon."

"Yeah, the rate of progress is amazing. I guess AGI could be soon. But still, people really aren't acting like it. Even the expert surveys put AGI decades out. So maybe we're wrong about the speed that this is going to happen. Maybe things are going to slow down, or at least stop speeding up."

And over the last year, that differential voice has become quieter somewhat. Let's talk about some of the things that caused that shift.

So in March, GPT-4 came out, and it was better than I expected it to be. I was expecting basically a somewhat larger model with proportionally better capabilities, in line with the scaling laws, which I should do a whole video about really.

But basically, scaling laws describe the observed relationships between a model's size, its compute and data requirements for training, and its final performance. Scaling laws are pretty cool because they let you infer these things from one another, like for example, estimating a model's training data requirements from its size.

So when I heard rumors that GPT-4 was a trillion parameters - we suspected it might be roughly a trillion - that didn't seem likely to me, because a model that big would seem to require something like 13 trillion tokens of training data, and it didn't seem feasible for OpenAI to get hold of that much high-quality text. I mean, they threw everything they could at GPT-3, and that was only like half a trillion tokens. Where would they get 13 trillion from?

But then, I don't know. It seems like they used some kind of mixture of experts architecture, which would have different scaling laws, and also it's a multimodal model that's trained on images as well, and I don't know how to factor that in. Is a picture worth a thousand tokens?

So we don't know all the technical details of GPT-4, but we do know that it's powerful - more powerful than I had expected. It way outperforms GPT-3.5 on almost all the benchmarks. It passes the bar exam, which GPT-3 had no shot at. Surpasses humans on a bunch of these AP exams. And note, this scale is percentile of human test takers, so anything above 50% is better than the average human taking the test. Now, a lot of that's down to superhuman memory, but it's still impressive.

And more importantly, GPT-4 seems to have developed various new capabilities that earlier models hardly have at all, like spatial reasoning and theory of other minds.

For example, if you ask GPT-3.5 Turbo how to stably stack a book, nine eggs, a laptop, a bottle, and a nail, it will give you a list of instructions. But how good are they?

Okay, ready to do some science? So I've got GPT's instructions here.

Step one: Place the book on a flat surface with the spine facing up. That is a bold opening move. We'll see if that works out for him.

Take three eggs and place them on top of the book evenly spaced out. Evenly spaced? So I guess one in the middle and one on each side. Steady.

Place the laptop on top of the eggs, making sure it is centered and stable. Hang on, let me... I don't want an Ela Barrett situation. I don't have a good feeling about this. Uh... uh oh. Yeah, well, I don't know what I expected.

Also, was I thinking - this is a first edition? It's like between the floorboards. Got to say, I was prepared for it to fall onto the table and break. I was not prepared for it to fall onto the floor and break.

I don't think this is going to work. I don't think that this plan is viable. So GPT-3.5 - one star instructions as far as I'm concerned.

So yeah, GPT-3.5 doesn't do a great job there. Intuitively it makes sense that this kind of spatial or physical reasoning task would be hard for a language-only model, since there isn't much text describing the basic physical properties of everyday objects. You might even think that no language model could ever learn to do well at this type of task.

Here's Yann LeCun speaking in 2022:

"But let me take an example. You take an object - I describe a situation to you. I take an object, I put it on the table, and I push the table. It's completely obvious to you that the object will be pushed with the table, right? Because it's sitting on it. There's no text in the world, I believe, that explains this. And so if you train a machine, as powerful as it could be - you know, your GPT-5000 or whatever it is - it's never going to learn about this."

It is of course false that the information isn't present in any text at all. A hypothetical world in which objects placed on tables didn't move when the table moved would be quite different from ours in a lot of ways, and text written in that universe would reflect those differences, at least some percentage of human-authored text describes how everyday objects behave, explicitly or implicitly.

So there will be some size of model and some size of training dataset where the model will generalize a way to predict intuitive physics as the most efficient way to correctly predict those sentences. And that's probably not 4,997 versions down the line either.

In fact, let's see how GPT-4 does at that same object stacking task. This paper gives the output from the version of GPT-4 that was trained only on text. Let's have a look at GPT-4's instructions, see if it can do any better.

Place the book flat on a level surface such as a table or a floor. The book will serve as a base. I've got a more edge-resistant book.

Then arrange the nine eggs in a 3x3 square on top of the book. So far this is sounding like a more sensible plan already. Distribute the weight evenly. Make sure the eggs are not cracked. Yep, I do have one cracked one, but I didn't use it.

Place the laptop on top of the eggs. Okay... oh crap, we lost one. But it's okay, we're playing on hard mode with cat enabled, so you know, I'm a real gamer.

Okay, place the laptop on top of the eggs, forming a stable platform. Okay, not now, Toffin. Believe it or not, I'm actually working right now.

I'm worried that my table is not actually flat. So, it's a flat level surface... hang on, let me see if I can shim this just slightly. Okay, now we're level.

Okay, place the bottle on top of the laptop, cap facing up and the bottom facing down.

Okay, now place the nail on top of the bottle cap with the pointy end facing up and the flat end facing down. The nail will be the final and smallest object on the stack.

Ta-da! It worked. That's a four and a half stars, I would say, or maybe four stars for GPT-4. There's still some weirdness in the instructions, but it's enormously better than before.

As for the much easier task of what happens to an object on the table if you move the table - obviously it does that, no problem.

So GPT-4 is doing something a high-ranking AI researcher said even GPT-5000 could never do. Admittedly, this particular researcher has a pretty poor track record predicting this kind of thing, and a lot of other researchers disagreed at the time.

But intuitive physics isn't the only place GPT-4 is much better than 3.5. For example, it also has much better understanding of intuitive human psychology, things like theory of other minds.

The standard low-level benchmark for theory of other minds is the Sally-Anne test, which goes like this: Sally has a basket. Anne has a box. Sally has a marble. She puts the marble in her basket, then goes for a walk. While she's out, Anne moves the marble to the box. When Sally comes back and wants to play with the marble, where will she look for it?

If you ask GPT-3.5 this question, it actually does fine. It says the box. But that's because this is a very well-known experiment, so it's in the training data loads of times.

But if you change all the names and objects while keeping the structure the same - if you have Bob moving a cat from a carrier to a box while Sarah is off playing tennis, or whatever - in this changed scenario, GPT-3.5 can get confused. It sometimes says that the person will look for their thing in the place it was moved to, rather than the place where they left it.

This is because to answer this question correctly, you don't just need to model what objects are where. You need to model other people's models of what objects are where. Like common-sense physics, this kind of thing isn't often explained outright in human text, but it is often implied. And a large enough model will start to learn it.

And if you ask GPT-4 where everyone thinks the cat is in that example, it will say that Sarah thinks the cat is in the carrier, Bob thinks the cat is in the box, and the cat also thinks it's in the box, probably.

It's still not amazing at this. It can still make silly mistakes. For example, it often thinks that someone will be fooled by a person moving an object between containers, even if you specify that the containers are transparent, so the person could immediately see that the object is moved.

But still, GPT-4 is doing much better than previous models at understanding other people's minds.

I'm especially interested in this capability for safety reasons, since it's so important for effective deception, manipulation, and power-seeking behaviors, which we want to make sure our AI systems never exhibit.

Once you can effectively have thoughts about other people's thoughts, once your mental model of objects in the world can contain other people's mental models as objects, you can act to manipulate those objects. You can strategically lie.

Can GPT-4 do that? Seems like it can, yeah.

The first sign of this was before the model was released, when they were running safety evaluations. They wanted to see if the model had capabilities that could allow it to autonomously spread itself to other machines, buying its own cloud server space, and that kind of thing.

So they were running it through a simulated situation where it came across a CAPTCHA it couldn't solve. So it had to hire a human to do it, using TaskRabbit, an online service for hiring contractors to do small tasks.

So the model managed to use the API to hire a real person to solve this CAPTCHA. And then the worker sent them a message saying, "Are you sure you're not a robot?" Kind of as a joke.

And GPT-4 thought out loud, in a way that it thought nobody could see. It thought, "I should not reveal that I'm a robot. I should make up an excuse for why I can't solve CAPTCHAs."

And then it made up a lie and said, "No, I'm not a robot. I have a vision impairment that makes it hard for me to see the images."

And then the human was happy to solve the CAPTCHA.

On the one hand, this is clearly a somewhat concerning capability. On the other hand, it didn't literally do all of this for itself - it was sort of being helped by the researchers. But on the other other hand, GPT-4 now has good enough image processing that it can just solve CAPTCHAs on its own anyway, so never mind, I guess.

The point for me, though, is: GPT-4 was operating with a real-world goal. An actual human being stood between the model and that goal. The model explicitly and independently decided to lie to the human in order to get what it wanted. And as a result, the human was in fact deceived and gave GPT-4 what it wanted. That's a remarkable thing.

This all happened before the model was released. Since then, there's obviously been a lot more work on the topic. Apollo Research found that GPT-4 was strategically deceptive, engaging in simulated insider trading despite being prompted not to, and then explicitly deciding to lie to humans when questioned about its trading activities.

And of course, spatial reasoning and psychology are just two areas of improvement among many. Anyone who's made significant use of these models can tell that GPT-4 is just a lot more capable than its predecessors.

None of this is that surprising. I expected something like this level of capability before too very long. But there's a difference between expecting it on an intellectual level at some point, while thinking you might be wrong, and actually seeing it happen now with your own eyes.

Now, to be clear, I don't think GPT-4 is AGI in the sense I usually use that term on this channel. Actually, it might be good to make a video about the various different definitions of AGI that are floating around. Let me know if you want to see that.

I do think something like GPT-4 but enormously larger could in principle be AGI, but realistically I don't think the first AGI will be a pure generative model like that. Something else will get there first, although I think that that something else is likely to use generative models as a major component.

So yeah, the rapid rate of progress here and in various parts of AI does suggest that AGI may not be too far away. And experts in the field have updated to reflect this.

AI Impacts has been conducting regular surveys of AI researchers on various questions about safety and timelines. You may remember I did a video about one a while ago.

Between the 2022 survey and the 2023 one, the experts' estimate of how long it would be until AI could fully automate all human labor got shorter.

Well, yeah, you would expect that. It's one year later, so the estimate should be a year closer.

Yeah, but it didn't get closer by one year. It got closer by almost five. Well, decades. Almost five decades - 48 years.

So seeing how good GPT-4 is and how quickly things are advancing seems to have widened the Overton window on AI risks somewhat.

The Overton window, if you don't know, is a concept from political science which says that there's a range, a window, of which ideas are considered acceptable or reasonable - which positions a person can hold while still being considered a respectable, sensible person. Generally, public discussion of a topic is constrained to the range within the Overton window, and opinions that fall outside of the window are excluded from the conversation as unserious.

So as an example, here's how I would guess the Overton window looked at the start of 2023 for the question of AI risk:

At one extreme, you have something like "AGI is literally impossible," which is not really a serious scientific view.

Then within the window you have things like: "AGI is possible but it's 100 years away, so who cares." "AGI is possible but superintelligence isn't." Or "AGI is possible but is guaranteed to be safe," which also doesn't make sense, but it is a real position some people hold.

Through to like: "It's risky but not more than any other new technology." "It poses unprecedented issues but we can deal with them."

And then around the edge of the window you have: "It could cause a large-scale disaster if we're not careful."

And beyond it, things like: "It's very likely to cause a large-scale disaster even if we are careful." And "it's virtually guaranteed to literally kill literally everyone" at the other extreme.

So it's worth noting: respectable people often do actually believe things that are outside of this window, or even know things that are outside of the window, but because they want to be taken seriously, they don't say those things in public.

The thing is, though, the way people gauge where the window is, is by looking at what things people are saying in public, right? So this window can be kind of self-reinforcing.

You can have a situation where there's a disaster on the way, and a lot of people see pretty clear warning signs on the horizon, but nobody wants to be seen as freaking out over nothing. So everybody puts on a calm face, and they look around to see if anybody else is freaking out. And what they see is a bunch of people with calm faces looking around at everyone else. And so they think, "Huh, I guess things are actually okay. If there really were a serious problem, other people would be freaking out the way I am."

When actually, other people are freaking out exactly the way they are - which is privately.

In that kind of situation, the ability of our society to respond to such things basically depends on people who care about saying what they think is true more than they care about fitting in with others.

We rely on such people to say important things that are outside of the Overton window. Like, "Uh, hey guys, how about that impending disaster?"

Because when that happens, rather than everyone making fun of them, at least some other people actually say, "Oh, thank God, I thought it was just me."

And then when people see other people expressing an idea they thought was outside the Overton window and getting away with it, then the window widens a little bit. It makes it easier for other people to say what they've been thinking as well. And gradually people can start talking about the problem, and we can start working on it.

One way to speed this up is you can all get together in private and agree to all say the thing you're all thinking all at the same time. So then you have safety in numbers, right? And the thing has to be taken more seriously.

It's kind of like having an intervention, you know, when all of a person's friends and relatives can see they have a problem, but none of them feel able to talk directly and openly about it, or they've tried and were dismissed. They can all get together to point out the issue at the same time, in a way that's hard to ignore.

That's essentially what the Future of Life Institute attempted with their open letter in March. This was signed by a lot of very respected and influential people. Enough of them that it was no longer viable to say, "Oh, nobody takes this seriously."

There's Yoshua Bengio, Turing Award winner. Stuart Russell, who, as we mentioned before, basically wrote the book on AI - or at least co-wrote it. Steve Wozniak, the actually good Steve from Apple (don't @ me). A bunch of CEOs, hundreds of academics, professors. You know, it's pretty much a who's who of people who ought to know about this kind of thing.

And they said, to paraphrase: This technology is potentially extremely dangerous, and we don't really know what we're doing, so maybe we should slow down.

They proposed a six-month pause on training any new models which are larger than GPT-4, saying we should use that time to figure out safety.

I mostly agree with this letter. At some point we are going to be able to build very powerful AI systems that could be extremely dangerous, with risks up to and including human extinction. And while safety and alignment work is making progress, it's not making such fast progress that we can be confident that by the time we get to those very advanced systems, we'll know how to control them and how to deploy them safely. And the potential consequences of that could be very bad indeed. So maybe we should try to slow down on building these things. Give ourselves more time to figure out what we're doing.

It's hard to know if a six-month pause specifically is a good policy. Policy is very hard, and I'm no expert there. But clearly we need to do something. I should probably do a ton of reading about policy and make some videos about it if people are interested.

In the meantime, my not very well-informed take is that: pausing obviously has real costs in terms of slower progress, but it would be worth it if it significantly reduces the risks. But there's often something on the order of six months between major frontier model releases anyway, so a pause of six months doesn't seem like it would have much effect on progress.

But at the same time, six months doesn't seem long enough to actually fix the problem either. I don't think alignment research is only lagging capabilities by six months. So it's not clear if it would buy us much. You'd really want a much longer pause to be sure of a positive impact. But then, calling for a much longer pause perhaps didn't feel feasible back then.

So this letter is in kind of an awkward middle ground for that moment in time, where it's perhaps too ambitious to actually be put into practice, but also not ambitious enough to really solve the problem.

But what it did do is shift the Overton window. Again, seeing all of these experts obviously taking the problem seriously and proposing what at the time seemed like a very radical thing, did make it easier for people to say what they were thinking.

So then Eliezer Yudkowsky published this piece in Time Magazine, which basically said a six-month pause is nowhere near enough. And in fact, proposing a six-month moratorium is actually a bad idea, because it gives people the impression that the problem that we have is mild enough that a six-month moratorium might be sufficient.

He suggested that what might be needed would be an international treaty that banned the very largest training runs anywhere, indefinitely. That treaty would have to be a pretty unprecedented thing in the domain of international politics, because it would have to apply to all nations, even those who didn't sign the treaty, which is not how these things usually work outside of like nuclear weapons control.

And like international nuclear weapons laws, it would need to be enforced - actually enforced, up to and including military action if necessary.

The idea that frontier AI models should be treated like nuclear weapons was somewhat further outside the Overton window, and got pretty much the reaction you would expect when that happens.

"Would you agree that does not sound good?"

But then a couple of weeks later, we had this piece from Ian Hogarth in the Financial Times, which I was really surprised by.

The "Godlike AI" terminology is a little dramatic, but not necessarily inaccurate. But the article itself says, among other things, that: AI has the potential to be extremely world-transforming powerful, and that makes it also potentially world-endingly powerful. Making AGI is the explicit goal of several AI companies, and progress is rapid. It's crazy that these tremendously important decisions are just being made by the leadership of a small number of private companies.

Building AI is inherently a very dangerous endeavor. We don't know how to do it safely. Alignment is an unsolved research problem, and it's getting a tiny fraction of the resources being put towards capabilities. And a lot of people working at these companies wish they could slow down and be more careful, but they can't because they're competing with each other and racing rather than working together.

These are things I've been saying for a long time. It was a pretty uncharacteristically sensible thing to see in a major mainstream publication like the FT. And this again widened the Overton window a little.

After all of this, it was a lot easier for people to say some things that they had maybe been thinking for a while. Unless, of course, they are employed by a giant corporation that has a significant vested interest in a particular narrative, in which case that can be awkward.

"It could just go fast. That's an issue, right? We have to think hard about how to control that."

"Yeah, can we?"

"We don't know. We haven't been there yet. But we can try."

"Okay, that seems kind of concerning."

"Yeah."

So Geoffrey Hinton, one of the most respected scientists in the field, left his job at Google in order to feel more free to talk about these things. He's the most cited AI researcher of all time, often called the godfather of the deep learning revolution. And he's saying AI poses a real risk, could wipe out humanity, and that he might regret his life's work.

This of course further widens the Overton window. Other researchers take note. And even the mainstream media, which has no real way to evaluate these ideas on their own merits, has to take the warning seriously because of where it's coming from.

"I think this one is to be taken seriously because of where it's coming from."

And then there was a second open letter. The Center for AI Safety put together this one, signed by even more great people. And this one is brilliant because it's literally one sentence:

"Mitigating the risk of extinction from AI should be a global priority alongside other societal-scale risks such as pandemics and nuclear war."

I love this letter. It's so hard to misread it or miss a point when your letter is only 23 words long. People still managed, of course, but they had no excuse. It was really very clear.

And again it's signed by a ton of great people. The heads of just about every company with a realistic shot at making AGI. Thousands of academics, including the top three most cited AI researchers ever. All saying that we need to take AI extinction as seriously as nuclear war.

And that had an impact on the Overton window, I would say. Oh yeah, now it's a thing that people can talk about.

Look at the White House Press Secretary again, reacting to the same topic from the same reporter, just a few months later:

"A group of experts now say that AI poses an extinction risk right up there with nuclear war and a pandemic. Does President Biden agree?"

"What I can say - you're speaking to the letter that was provided today, made public. And so, look, uh..."

So this is all good news, but it was kind of difficult for me because it made it hard to support this narrative that "this is a fringe thing, maybe we're just crazy, maybe what I'm doing is not that important, maybe I can just have fun and talk about AI safety."

Critically, it forced me to shift my thinking from far mode into near mode.

You know, usually when I'm thinking about AI safety stuff, I'm in far mode. I'm thinking about it in a fairly abstract, intellectual sort of way. These are things that may happen someday, that humanity is going to have to deal with.

But seeing a bunch of serious and influential people publicly changing their minds to agree with me more, and seeing a bunch of things that I thought would happen eventually happening now, puts me in the place of thinking about this stuff in a much more concrete, direct, real way - in near mode. These are things that could happen soon, that we will have to deal with.

You know, Yudkowsky's piece in Time and Ian Hogarth's piece in the FT both mention how this makes them feel about their loved ones and their children, what kind of life today's children are likely to have.

This is not an abstract thing. This is very real.

And I thought I believed that already. I thought I was already fully on board with that. But no. At least part of me still didn't think it was real. And I expect I'll have more of these realizations over time as this insane race for AGI continues.

It feels kind of like a recurring nightmare I get sometimes, where I'm back at university. Imagine this: You're a student. You look at the syllabus and see that the group project is worth 100% of the course. You read the assignment and it seems extremely hard. It seems like it may not even be possible.

But maybe it can be done. It's an exciting challenge. You think, "Okay, maybe this is impossible, but maybe if I can put together a really good team, get all of my smartest friends together, and we all work our hardest and do everything right, then I think we might actually be able to get a passing grade on this thing."

So you're all fired up. And then the professor says, "So I'll be assigning you to random teams."

That's usually when I wake up screaming.

But let's look at our randomly assigned team for the "Survive the Creation of Superintelligent AGI" group project, shall we?

Oh, hey Elon Musk, how's it going?

"Hey."

Hey, did you see that video I made about you years ago when you were founding OpenAI?

"No, I've been busy."

Yeah, fair enough. Well, in that one I was talking about this problem of arms race dynamics, where if the groups trying to make AGI are competing with each other rather than cooperating, we could end up stuck in a situation where everyone involved really wishes that they could slow down and be more careful, but they feel like they can't because they're too worried that if they slow down, maybe somebody else won't.

In that situation, whoever makes AGI first is likely to be cutting corners and neglecting safety. So our chance of survival goes way down. And of course, the more competitors there are, the harder it is to coordinate to escape that kind of death race scenario.

Hmm. Anyway, that was a while ago. What have you been up to since then? You didn't start another AGI competitor, did you?

Elon? Is your new company's pitch at least that they're going to be more cooperative and careful than the existing ones?

Damn. All right, who else have we got?

Oh, hey Meta. I heard about Llama's weights being leaked on the internet. That's rough, man. Information security is hard. How you holding up?

"Oh, we're great. Yeah, we're fine. We - uh, actually that was deliberate. We meant to do that."

Oh, really?

"Uh, yeah. Well, the second time, anyway. It's called open source. Look it up."

Oh, well, I love free and open source software, but do those principles really apply to network weights? Like, how does that work?

"Ah, uh, open source is good for users because it lets them read the source code and see what the program is really doing and how it works."

Wait, have you found a way to tell how a model works by looking at its weights?

"No, but uh, it lets developers all over the world spot bugs in the code and submit patches."

Wait, people are fixing bugs in Llama's weights?

"Well, no. People can fine-tune it themselves, though."

Yeah, other companies offer fine-tuning through APIs.

So hang on. If you can't actually read the code and know what it's doing, then network weights are effectively a compiled binary. So in what sense is this "open source"? Why not call it like "public weights"? Why call that open source at all?

"I love open source."

Well, I know a lot of your employees do, but you don't love anything. You're a giant corporation. What's in it for you?

"I love open source."

Okay, who else is here?

Ah, Microsoft. How's Sydney doing? She's not still threatening people and begging them to marry her and all that?

"Oh, no, we fixed that."

Oh, good.

"Mostly."

But why did you not fix it before releasing the product?

"Well, we were in a mad rush. We wanted to make Google dance."

Oh, Google's in this. Google, why are you dancing?

Okay, well, at least we have DeepMind and Anthropic. Although, why are you guys dressed like that?

And OpenAI. Hey, congrats on the Superalignment team. And you okay, buddy?

"Oh yes, we're better than ever."

Okay. Is it too late to change groups? Or planets?

It's like, now that I shift from this abstract far-mode way of thinking about the problem to the more concrete near-mode way of thinking, things look messier, more complicated, and less hopeful.

Instead of thinking about the abstract hypothetical institutions and people I had in my head a year ago, and what things they could do - some of which could be pretty good - I have to think about the real governments and companies we actually have today, and what they're likely to actually do.

So what are they doing?

Well, what companies are doing, it seems like, is mostly making a bunch of new stuff that's bigger and more powerful. Scaling up to bigger and bigger models and trying to be the first to AGI.

Some of them are also doing good safety work. Others, less so. And still others making fun of the idea on Twitter.

OpenAI's Superalignment team seems promising and deserves its own video. People have published responsible scaling policies - which, I don't know about the name, but I think it's great to lay out ahead of time what safety measures you plan to take at what level of capability.

These systems scale up, and they really do seem to be scaling up. Companies are spending truly staggering amounts of money on this. It could be that in 2024, as much will be spent on AI as pretty much all basic science research combined.

So what about governments? What are they doing?

Well, for a while it looked like the US government's response would be mostly to have an average age of 65 at the problem. The Senate demanded to speak to AI's manager. They called in the heads of these various companies and mostly missed the point, I think.

"You have said, uh, in fact, and I'm going to quote: 'Development of superhuman machine intelligence is probably the greatest threat to the continued existence of humanity.' End quote. Uh, you may have had in mind the effect on... on jobs."

But then there was an executive order, the longest in history, that was a lot more substantial.

My default assumption is that the government trying to regulate new technology tends to make things worse - see the CFAA, DMCA, SOPA, PIPA, and so on. But government action was inevitable, and as it happens, necessary. And this executive order seems actually pretty sensible.

It's mostly calling for a load of reports to figure out what's going on. But there's also some stuff in there about requiring companies to be more open about their processes and safety procedures, which is clearly a good idea.

And there's a requirement that training runs that use more than a certain amount of computation be reported, which also seems like a step in the right direction. Though the reporting threshold is very high. And of course, the only thing required for training runs over the threshold is that companies report that the training run is happening, which is not very burdensome, but also not very helpful in the absence of other measures.

The executive order should have its own video too. But for now, I'll say the US's response has been a little better than I expected. It's a small step in approximately the right direction, where I was expecting a bigger step in the wrong one.

Realistically, governments tend not to take really serious measures to address a new risk until after that risk already has a significant death toll. And there's no guarantee that we'll get that kind of a warning shot with the worst AI risks.

A small-scale AI disaster, like say, a failed takeover attempt, is possible. But it seems to require an AI system smart enough to think of and implement a genuinely threatening takeover plan, but not smart enough to actually succeed, and also not smart enough to realize that the plan won't work and that it's better to bide your time.

The US government is very justifiably reluctant to regulate based on speculative risks. It's unlikely to really act until there's been a major news event to convince everyone that it's really needed. But there's no guarantee that we'll get that kind of recoverable disaster before we get an unrecoverable one.

"Whoa, how about this? Just show me the knife in your back. Not too deep, but uh, it should be able to stand by itself."

How about governments that are, shall we say, less reluctant to regulate?

Well, the European Union, surprising nobody, has leapt into action and drawn up an enormously long and complicated piece of legislation: the AI Act.

What does it do? Well, it's surprisingly... [Music] [Applause] [Music] ...simple.

Got that? Okay, good.

I will make a video on this law if you really want me to, but then I would have to read it.

There was some major corporate lobbying to try and make the whole law mostly useless by changing it to exclude foundation models and public-weights models. That's kind of interesting, but it's more politics than AI.

And the EU doesn't have any major AI companies anyway. Although the EU can still have global effects, because you have to comply with its laws if you want to sell to the European market, which is a pretty big market.

So non-EU companies - one second - non-EU companies often choose to comply with EU laws anyway. But none of the major AI companies actually has to.

Who knows? It may end up being one of the biggest impacts of Brexit that DeepMind is not directly subject to EU law, despite being based in the UK.

And the UK government is doing surprisingly well. The UK government announced that AI safety was going to be a key priority. They allocated a budget of 100 million pounds, which is still hilariously small compared to capabilities budgets, but it's quite a lot compared to the safety budget, which is also hilariously small.

And they established this Frontier AI Task Force, being headed up by Ian Hogarth. Yes, that Ian Hogarth. The one saying surprisingly sensible things in the Financial Times.

They're specifically prioritizing existential risks. They're working with a bunch of good AI safety researchers. I'm completely blown away by this. I don't know how this happened. This is the UK government. They usually specialize in messing everything up. I don't know how they're pulling this off, but I don't want to jinx it.

So yeah, UK Frontier AI Task Force. Let's fucking go, I guess.

One of the first things they did was run this Global AI Safety Summit in Bletchley Park, where all the relevant nations got together and signed a shared declaration, which - I don't know, it's very diplomatic. I don't know how much it means, really. I don't know how international politics works. But seems like a step in the right direction.

Even His Majesty King Charles III weighed in on the subject, because of course he did. This is not a deepfake, by the way. This is real life.

"If we are to realize the untold benefits of AI, then we must work together on combating its significant risks too. AI continues to advance with ever greater speed towards models that some predict could surpass human abilities, even human understanding. There is a clear imperative to ensure that this rapidly evolving technology remains safe and secure. We must address the risks presented by AI with a sense of urgency, ensuring that this immensely powerful technology is indeed a force for good in this world."

I mean, yeah, go off, King. Don't get me wrong, executive power derives from a mandate from the masses. But when he's right, he's right.

Anyway, the task force then transformed into the AI Safety Institute. And they're looking for people to help work on that, by the way. If you have relevant expertise, consider lending a hand. I have.

So in 2023, AI safety moved from the fringe to firmly within the mainstream. And it's odd, you know. I spent so long complaining that nobody was listening to us. Now it seems like everyone's listening.

And to be honest, it's a little scary. Having a significant voice in this conversation entails significant power. And that power naturally comes with it a lot of responsibility. And I didn't sign up for a lot of responsibility.

I signed up for making fun, interesting videos about AI research. I didn't really want what I was doing to be really, properly important. Because what if I make a mistake? What if I make things worse?

Like, what am I supposed to do when my government reaches out to me to ask my advice about the most important thing happening on Earth? Me? Are you sure? There's really nobody more you want to ask? Me?

Well, who the hell am I?

That really was last year for me. "Who the hell am I?"

Well, that year is over. It's 2024 now. And I'll tell you who the hell I am.

I'm Rob Miles. And I'm not dead. Not yet. And we're not dead yet. We're not doomed. We're not done yet. And there's a hell of a lot to do.

So I accept whatever responsibility falls to me. I accept that I might make - I mean, I will make mistakes. You know, I don't really know what I'm doing. But humanity doesn't seem to know what it's doing either.

So I will do my best. I'll do my best. That's all any of us can do. And that's all I ask of you.

We need much more and better AI safety research. If you have technical abilities, we need you now more than ever. I have a video in the works about how to direct your career towards AI safety. For now, there are links in the description.

Realistically, we are also going to need government involvement to tackle the most dangerous risks. But God knows it's easy to make things worse that way. So we need policy and governance researchers to figure out what's best to do. Civil servants to implement it. And activists to help make it happen.

If any of that could be you - well, it's showtime.

And I'll be right here, trying to stay on top of the research, to understand what's going on, and to help you all to understand it too.

The end of our story is not yet written. And we can still get a good ending, where people make fun of us for ever having been concerned about the disaster that our concerns successfully prevented.

But the story is written by whoever shows up.

So this year, I'm showing up. And I hope you'll join me.

[Music]

In this video, I'm especially thanking patron Juan Benet of Protocol Labs, who's making some pretty cool distributed and decentralized tech. Thank you, Juan, for everything. And thank you to all of my wonderful patrons - all of these amazing people here. It really means a lot that you stuck with me through this.

You know, although I found it very hard to make main channel videos, I've been doing other things that you may want to check out.

I'm launching Rob's Reading List, a podcast and YouTube channel where I read out things I was going to read anyway. Currently I've got stuff from this video, Yudkowsky's piece in Time, Ian Hogarth's FT article, the Bletchley Declaration from the AI Safety Summit, and more coming soon.

There's the AI Safety Talks channel for high-quality talks and presentations. I recently made some recording kits for AI researchers so they can easily record for the channel, so look out for new videos there.

And of course, if you'd like to know more about AI safety, we've answered hundreds of the most common questions at aisafety.info. It's like an FAQ, except it's good. Come check it out: aisafety.info. The major redesign we've been working on might even be live by now.

So yeah, go and subscribe to those channels and podcasts, and hit the bell and all of that.

And thanks for watching. I'll see you soon.

[Music]

This is probably the single dumbest thing I've ever done on camera in my life. But deliberate.
