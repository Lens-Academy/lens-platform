---
title: "AI Safety Career Advice! (And So Can You!)"
channel: "Robert Miles AI Safety"
url: "https://www.youtube.com/watch?v=OpufM6yK4Go"
---

Hi, I get a lot of people asking me for advice about how to work in AI safety research. How do you get started in an AI safety career? Rob, you should do a video about AI safety research careers. Oh, here comes one now. Rob, you should do a video about AI safety research careers. And my answer is generally the same. Easy. There's a great careers advice organization called 80,000 Hours. They've written a detailed guide about it. You can also book one-on-one career coaching calls with them for free. Link in the description.

But doctor, I am careers advice organization 80,000 Hours.

Oh, you want me to make a video? Can't people just read your career guide? I don't know. People don't really like to read, huh? Do you think maybe people should learn to enjoy reading before they try to embark on a highly intellectual career path?

Can we just do the video? Yeah.

[Music]

If you watch this channel, then you know that AI safety research is important. AI is having increasingly large impacts on the world. We don't really understand what we're doing. And there remains a distinct possibility that AI systems at some point in the future totally disempower humanity and maybe drive us extinct in a way which probably destroys almost all value in the universe. It's not at all clear how likely that is, but it's very obviously a lot more likely than we would want it to be.

It would be nice to have some well-founded technical assurances that that kind of thing won't happen. In the same way, you'd probably want some reasonable assurances that a plane won't crash before you load your entire family into it. Getting that kind of confidence in the safety of AI systems is hard.

Now, there's obviously a lot of different things we could do to improve our chances of survival, including things like policy and governance work. You know, trying to figure out ways for our society to coordinate to navigate this new situation. Well, in the plane metaphor, that's like trying to set up the FAA or something. There's also advocacy and communication, field building, ops, organizing, all sorts of things. And there are good career guides about those things as well. Links in the description. That's very important work.

But what we're focusing on in this video is technical safety research. This is like the engineers who designed the airplane safety systems, the air traffic control protocols, and so on. There's not a clear boundary here. Governance and policy work obviously needs technical people as well. Pretty urgently actually. But yeah, in this video I'm specifically talking about people who might be interested in doing technical AI safety research.

If that's you, stick around. If that might be you, but you're not sure, like, you know, is this right for me? Am I good enough? Then for sure stick around, because we'll talk about that and you might be surprised. And if that's not you, then maybe stick around anyway, because this script ended up a little spicier than my usual. I don't know. I have some opinions in this one.

But yeah, technical AI safety research. What does that involve? What jobs are out there?

So, there's a lot of different types of technical safety work. Some people are trying to understand how trained neural networks actually operate by taking them apart and looking closely at their internal mechanisms. Some people are studying the dynamics of the training process to design training processes that are less likely to produce scheming or misaligned models. Others are designing post-training and fine-tuning schemes like RLHF, reinforcement learning from human feedback, to try to get current systems to be more likely to do what we want. And other people are designing ways to test and evaluate those kinds of training schemes.

Some people are demonstrating the circumstances under which current models display behaviors that would be very dangerous for more advanced systems to do and others are designing monitoring protocols to spot when that kind of thing is happening and control protocols that might allow us to get useful work out of those kinds of systems anyway.

Some people are designing ways to evaluate how capable current models are at the dangerous capabilities we're concerned about them eventually developing. And other people are trying to formally prove things about neural networks. But that's probably impossible. So they're trying to come up with some kind of relaxed notion of a proof that still lets us make meaningful principled theoretical claims about the behavior of these things. Whereas some people are simply studying models the same way a psychiatrist studies people, just talking to them and seeing how they react.

For a while, people were trying to resolve a load of fundamental confusions that we almost certainly have about what it means to be a thinking agent that wants things and is physically embedded in the world. We've mostly given up on that because it's hard and we've kind of run out of time. So, we're mostly just going to have to try to do our best while being kind of confused. But, there is still work being done on just trying to clarify things and help us get less confused about this mess, and plus a ton of other stuff that I haven't mentioned. It's a lot.

There are a few ways I might try to organize it. One important axis along which it varies goes from conceptual and theoretical to practical and empirical. This is kind of similar to applied and theoretical physics. So, on one end of the spectrum, you've got stuff which is so theoretical and abstract that there's no way to know if it'll even ever be useful, all the way to the other end where you've got stuff which is basically just standard ML engineering on current systems that people would probably be doing anyway and which doesn't deal with any of the things that actually make the alignment problem hard, and everything in between.

Theoretical work has been somewhat neglected recently in my opinion because we now have all these cool models to play with and it's easy to get legible results that way. Whereas theoretical work doesn't depend as much on any specific model. It's mostly mathematics and philosophy, which actually, can we take a second to talk about what mathematics and philosophy really are? Because I feel like school doesn't do a great job of getting that across.

In my mind, the job of philosophy is to tackle questions that we don't know how to think about, to grapple with the ineffable and see if we might not be able to eff it after all.

Point being, once you've done good enough philosophy on a question, you've figured out how to think about it effectively. So, it stops being philosophy. Like, the question of how objects move around was once philosophy. Aristotle had some ideas. They didn't work very well. You had philosophers dropping cannonballs off the Leaning Tower of Pisa, that kind of thing. Not physicists, not at the time, philosophers. You know, Isaac Newton, we think of him as a physicist, but he thought of himself as a philosopher. He took these philosophical questions about motion and he thought about them clearly enough that it became possible to do mathematics to them. And that approach turned out to be so effective that it became its own field separate from philosophy. And so when we learn about Newton's work on motion, we learn about it in physics classes, even though at the time he was doing philosophy.

So what ends up being left in philosophy is all of the things that we're still kind of confused about. If you only think of philosophy as that, you're kind of leaving out the field's biggest successes, which are most of the other subjects you study at school, right? Mathematics, the sciences, economics, even history is largely applied epistemology.

So yeah, I think of the job of philosophy as being to take things that we don't know how to think about and think about them until they become something that isn't philosophy. And there are clearly a lot of things in advanced AI that we're not sure how to think clearly about. So we need this kind of work.

Excuse me. Um, why is there a long digression on the nature of mathematics and philosophy in the middle of a careers advice video?

I think it's important and interesting. Anyway, it's not like you're paying me.

Okay. But so mathematics, the thing they call mathematics in school, that's mostly just how to do calculations. It doesn't really get to the core of what mathematics is. In my opinion, mathematics is the study of precisely imagined things. It's about imagining something so precisely that your imagined version of it is actually fully defined. There's no space for opinion or interpretation. You know, two mathematicians thinking about the same mathematical object defined the same way are not thinking about two different versions of the same thing. They're actually considering exactly the same object, right? They don't call this an empty set. That's the empty set. There's only one.

Now, precisely imagining things and then reasoning about their properties and behaviors turns out to be an unreasonably effective way to think about a lot of the world. Critically, the fact that it lets you have multiple people thinking about the same thing, not subtly different things, allows you to build and verify much longer chains of reasoning than you could get away with in any other paradigm. And that's basically a necessity if you want to do highly complex and impactful things. At least if you want to do highly complex and impactful things while having any idea what the fuck you're doing.

And so often theoretical alignment research involves taking philosophical ideas about minds and goals and agency and safety and trying to pin them down, trying to imagine them so precisely that they become mathematics. And if they can't be expressed well with our current mathematics, then the task becomes one of figuring out what new mathematics needs to be invented and then inventing it.

Imagine you're starting from scratch trying to safely fly a rocket to the moon. What would it take for you to realize that in order to understand orbital maneuvering, you need something like calculus and then go on to invent calculus? That's the kind of thing theoretical alignment research aspires to be. It's not easy, but there has been some interesting work done. Some of which I've talked about on Computerphile, some of which I've talked about on this channel. You know, my videos on eliciting latent knowledge or mesa-optimization. This is fairly theoretical work. At least it was at the time before some of it started just actually happening. We're getting less theoretical by the day. But the theory work is not done yet. So maybe give us a hand.

But the classic problem with theoretical work is okay, you've developed these beautiful mathematical constructs and learned a lot about their properties. Why do we believe that these particular precisely imagined things will importantly correspond to any particular not imagined thing? Why this mathematical construct instead of another one? There's a lot of existing evidence available in the world that you can use to guide your theoretical work. But you might want to do some experiments to collect more evidence, which is where empirical work comes in.

Day-to-day, the empirical work is mostly ML engineering. It's figuring out how current systems actually work under the hood, conducting experiments to test safety and alignment techniques, and so on.

For example, some safety problems emerge from the opaqueness of current AI techniques. You know, our cutting-edge AI models are arguably the most complex artifacts humanity has ever created, but we kind of grew them rather than built them. We don't really understand how they do what they do. It's a lot like the human brain in that way.

So imagine being a neuroscientist. Well, maybe you are a neuroscientist, in which case you shouldn't have to tax your imagination too hard. Except imagine that instead of brains being these fragile, precious, delicate things where your access to them is inconveniently blocked by so-called ethics committees and skulls, instead you have total freedom. You can take them apart and poke and prod them however you want. You can, with perfect reproducibility, run whatever experiments you like, taking whatever measurements you want at any time during any task, and the cops can't do a damn thing about it. That's called interpretability research and it's one of the more popular types of empirical work.

We've talked about a lot of empirical work on this channel. Things like scalable oversight, gridworlds, reward modeling, the control video, a lot of other stuff that we haven't covered as well.

The trouble with the more empirical stuff is that you can only study systems that actually exist. And there's a limit to what that can tell you about the systems that will exist in the future. For example, a lot of the biggest problems with AI safety only happen when the system has enough situational awareness to understand its training setup and enough strategic reasoning ability to consider the possibility of deception and so on. And it's only recently that AI systems have been anywhere close to that. So, it's hard to empirically study that kind of thing. But there's some interesting engineering to be done in trying to figure out ways to augment current models to make them able to carry out these dangerous behaviors in order to study them. We talked about some of that in the previous video.

Of course, as models get more powerful, the empirical work gets more useful, but the less time we have left to do it.

So, yeah, that's a little of what technical safety research is about. What do you think?

Are you interested in pushing the boundaries of humanity's understanding of understanding itself, our understanding of what it means to be a thinking, deciding agent embodied in the world? Are you interested in pinning those things down fully, in transforming them from philosophy into mathematics, and then solving that mathematics? Are you interested in probing the depths of the most complex artifacts humanity has ever created and understanding them so profoundly that you can design systems such that you can be confident ahead of time that they'll behave in ways beneficial to humanity? Are you interested in thereby avoiding a global catastrophe and ushering in a new age of human flourishing that staggers the imagination and makes the modern world look medieval?

Ah, cool. Me too.

But do you have what it takes?

First off, do you have the skills? Now, what skills you need depends somewhat on what role you want to play. Do you want to be a research lead or research scientist who designs experiments and writes papers? Or do you want to be a research engineer or contributor who actually implements and runs experiments and works on papers without setting the research agenda? This is kind of a spectrum as well. Lots of people are doing some combination.

Either way, you'll need skills in software engineering and probably ML engineering. The empirical stuff needs more software engineering. The theoretical stuff needs more mathematics.

You might want to get a PhD, but I would generally recommend against it. Research leads often have PhDs, but you don't strictly need one, and engineers and contributors generally don't have one. I would say if you know that the research you'll do for your PhD is actually the research that you would want to be doing anyway, then go for it. But if you're treating a PhD as a stepping stone to the work you really want to be doing, then there are probably quicker and mentally healthier ways to get there. But if you're already about to complete a doctorate in mathematics or computer science, then cool.

And actually, you don't need to already be studying maths or computer science. You could be doing physics or other quantitative subjects as varied as neuroscience or economics can all work. The thing is deep learning is just not that deep actually. You know, ML is a pretty new field. So, compared to something like physics, it's surprisingly easy to get to the frontier. So, it's pretty common to come into the field sideways as it were from another field. A lot of people do this. If you have expertise in something scientific and mathematical, it shouldn't take you too long to get good enough at AI to make meaningful contributions.

How good do you have to be? Well, it's hard to quantify this kind of thing, but some of the companies have put out exactly what they're looking for. So, if you pass that bar, you're definitely good enough. A hiring manager at Anthropic said that if you could, with a few weeks' work, write a new feature or fix a serious bug in a major ML library, they'd want to interview you straight away. And the DeepMind team said, "If you can reproduce a typical ML paper in a few hundred hours and your interests align with ours, we're probably interested in interviewing you."

That "interests align with ours" part seems important for safety roles. The good teams are especially interested in people who are up to date on the safety literature and have their own thoughts about it as well as being technically competent.

Are you that kind of person? Oh, you are. You're already the kind of person who can replicate ML papers for fun and you already know a lot about AI safety. What are you doing watching YouTube for? Go apply for some positions. Link in the description.

Okay, that was like five people. Realistically, I probably already know four of you. Hi, Neil. Thanks for watching my videos. Get back to work.

Okay, everyone else, the people who aren't quite the kind of person who could just jump into this work straight away. Could you become that kind of person? Could you imagine a rocky training montage that could get you there? Because if you feel like you might be able to get there, it's probably worth trying.

So, how do you actually do the training montage? Well, if you don't have a solid background knowledge of coding, maths, and deep learning, that's where to start if you're starting from scratch. There's a lot of great resources to help with that. I'm not going to talk through all of them, but you can see the section of the career guide for that. There's a link in the description, and there's a bunch of courses you can take as well. I'll talk about those later.

For empirical work, you might want to practice doing ML engineering by replicating existing papers. Learn about safety and alignment techniques by reproducing the results of some safety papers.

So, all of that should help you get the skills you need. But just having the skills isn't enough. Good safety research also requires a particular mindset which not everyone has.

First thing is are you able to take this seriously. Now that doesn't mean not making jokes. In fact, a sense of humor is becoming increasingly important. It means appreciating the magnitude of what's at stake and the level of the challenge facing us. Acting with the gravitas appropriate for what we're building. The future may be much better or much worse than most people are willing to seriously consider. Some people claim to realize this, but many of them don't seem to have really internalized that this is not a game. This is for keeps and it requires serious thought.

If your approach to the future of humanity is mostly based on vibes, I would advise you to experiment with actual thinking. Takes a lot more work, but it can be very rewarding.

If you're constitutionally opposed to serious and careful thought, then well, I mean, you can do what you like, I guess. I just ask that you do it quietly because grown-ups are talking.

You also need something that I might call conceptual clarity or big picture thinking. It's very easy to get sucked into a mindset where someone has given you a number that you're meant to make go up and if number go up then good. This is psychologically comfortable, but that kind of thinking really won't cut it if you want to do good safety research because the actual number you're trying to make go up is like the overall expected goodness of humanity's future or something like that, which your manager is not going to tell you in your performance reviews because one, they aren't paid to care about how good your work is for humanity's future, and two, they don't know, and nor do you.

But you still need to make decisions about your work in spite of the lack of easy proxies for what matters. And that means you need clear and accurate mental models of the overall situation, not just your own narrow part of it. And you need to be able to think carefully and decide what's best and not just run in whatever hamster wheel you happen to find yourself in. This is part of what makes safety research so interesting. You're not just making tweaks to make the number go up. You have more interesting and challenging things to think about. And in fact, we may not even have a working paradigm, right? Our current approaches may be fundamentally confused. So it's important to be able to think big and try to deeply understand the whole problem.

But Rob, that sounds hard. I'd actually prefer a psychologically comfortable job. I like making number go up.

Okay, fair. And good self-awareness. It is totally possible to do good and useful work just solving engineering problems for a good safety team. But you have to pick the right team because something that it's vital to keep in mind over your career is the fact that not everything labeled as safety is any good.

Some work that calls itself safety is mainly about making systems more capable in a way that doesn't really make them any less likely to cause catastrophes. Some work that calls itself safety is kind of thought of by upper management as basically coming out of the marketing or public relations budget. It's there to make the company look good rather than to really improve the safety of the systems.

If what you're asked to do is stop language models from saying bad words, it's possible that you're doing fundamental science to learn important things about the nature of alignment that will be helpful to us in future once AI systems become, you know, actually dangerous. But it's more likely that you're just doing engineering to make a product more marketable and that is making the world better in a way. But is that why you got into this? Is that what you plan to do with your one wild and precious life?

At the end of the day, your boss is not your friend. The company is not a family. And it will try to take your enthusiasm for improving the world and turn it into enthusiasm for improving products which is not quite the same thing.

You can of course go into academia or government or a nonprofit and in each of those you'll face a different set of pressures on your work. What gets you publications and citations? What gets you funding? What wins awards? None of these is quite the same thing as what best solves the problem. So don't fall prey to Goodhart. Keep your eyes on the prize. Remember that the right thing to do might look different from what the people around you are doing. The right thing to do might not also be the most prestigious thing or the best compensated thing. Try to do the right thing anyway.

Some people can remain master of their fate and captain of their soul and do good work within an organizational structure that isn't designed to support it. You may be one such person, but it's not the only way to do things. You may be able to sidestep the problem by getting sufficient slack in your life to be a free agent. In other words, by finding a source of income which might not be related to the work you really want to do, but which leaves you with enough free time and mental energy to work on AI safety without getting paid for it.

Taking this path means you're not beholden to a boss and you can choose to work on what you think is most promising. This is valuable because not every agenda that needs studying is already being covered. Working outside of the existing organizations allows you to find one of those gaps and fill it.

However, this path requires its own type of mental fortitude without which you may navigate away from the Scylla of conformity right into the Charybdis of crackpottery. Am I being too poetic? Yes.

My point is there's a serious danger here, which is that without the structure of a research organization, you end up doing work that's no good and worse, never realizing that your work is no good. You can waste a whole career this way, but it is avoidable by making sure to publish often and by frequently soliciting feedback and peer review and then actually listening to it, which is not always psychologically easy. Just remember that if people don't understand your ideas, it is almost certainly not because your ideas are too brilliant. It's much more likely that you're communicating poorly and you should prioritize fixing that.

Make sure that you're contributing to the field in a way that the field recognizes. Otherwise, all of your work will have zero practical effect on the world, unless you're going to try to build the AGI on your own, which—don't try to build the AGI on your own, please.

So, if all of that sounds like not a career you would enjoy, yeah, maybe it's not for you. There are lots of ways to help, and technical research is not the only game in town. This is important to bear in mind because success is heavy-tailed. By which I mean, in research, generally, most of the advances come from relatively few people. Someone who's amazing at their job can be many times better than the average. So, how good it is for you to do technical safety work ends up mostly being determined by how likely you are to be really great at it.

This means that when picking between jobs, even if technical research feels in some sense more valuable or important than some other job you're considering, if you think you might be really great at that other job, that might be the better choice because being excellent at that other job is better than being a mediocre researcher.

This is tough to talk about because different people need to hear different things. If you're thinking, "Oh, cool. Okay, I can just work on whatever I'm most excited about." Then no. The thing you're most excited about probably doesn't matter much, you should think about impact more. But if you're thinking, "Ah, damn. I got to work on the most important thing, even if I'm not cut out for it." Then also, no. If you try that, you're most likely going to have a miserable time and burn out and not do much good for anyone.

Frustratingly, the advice that feels less appealing to you is probably the advice you most need to hear.

You have to balance these things. You want to find something that seems like it might be really important and useful and that you have a chance of being great at. But also, you don't have to decide your whole career in one go. You can try things and see how it works out. You can just have a go at getting into technical AI safety research. You might find it easier or more fun than you expected, or you might not. You're not locked into a single path. You can always pivot if it's not working out. People tend to underestimate that.

Even if it turns out technical safety research isn't for you, you're not going to say, "Oh, damn. I gained a load of expertise about this extremely influential technology for nothing." You know, you may as well give it a go.

So, what can you do right now? Well, it'll be different for everyone, but if you got this far, you should probably apply for 80,000 Hours advising. It's free. You chat one-on-one with a professional careers adviser, and they'll help you think through your next steps. Of course, they're limited in the number of people they can talk to, especially since everyone who watches this video is going to apply. Yeah, they might be busy, but it's worth applying anyway because even just the application process itself, which only takes about 10 minutes, will help you start thinking about your career. Link in the description. Tell them I sent you. Or don't. Again, not sponsored. Other careers advice services are available.

In fact, we put together a page at aisafety.com/advisor with several different organizations you could talk to. Or without talking to anyone, you can work through 80,000 Hours' career guide. And you can also check out their job board, which lists open positions you can apply to. Or you can see courses that you might want to take at aisafety.com/courses. I think BlueDot's AI fundamentals course is particularly good.

And there are too many things in this call to action. Okay, the main thing is apply to advising. Okay, just do that. Yeah, there's not that much time left. We are not on track. We need all the help we can get. So, please help. Thanks. Bye.

[Music]

I didn't take any money from 80,000 Hours for this video to make sure I would be free to say whatever I wanted. So, I want to thank my wonderful patrons for making that possible. That's all these amazing people here and in particular this guy, Maxim. Thank you so much. I feel so lucky to not have to take sponsorships.

Also, I don't know if you noticed, but I don't run any YouTube ads on any of my videos because I think your time is worth more than that. But I think YouTube might prefer to promote videos that have ads since that's how they make money. So, I'm considering turning them on just to reach more people. I don't know. If I do that, obviously, you should feel free to use an ad blocker. But, what do you think? I'm obviously especially interested to hear from patrons, but let me know in the comments.

[Music]
