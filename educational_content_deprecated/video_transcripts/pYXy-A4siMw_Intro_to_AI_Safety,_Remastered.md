---
title: "Intro to AI Safety, Remastered"
channel: "Robert Miles AI Safety"
url: "https://www.youtube.com/watch?v=pYXy-A4siMw"
---

Hi. This video is a recording of a talk that I gave a while back. I already published a version of it on my second channel, but did you even know I had a second channel? Most people don't. I thought more people should see it, so I remastered it. I cleaned it up, improved the graphics, and yeah, this is that. Enjoy.

Right. Hello everyone. My name is Robert Miles. I am usually doing this on YouTube. I'm not really used to public speaking. I'm not used to not being able to edit out my mistakes. There may be mistakes. Also I may go too quickly. Sorry not sorry.

So, when it comes to AI safety, you can kind of divide it up into four areas along two axes. You've got your short term and your long term, and you've got accident risks and misuse risks. And that's kind of a useful way to divide things up. AI safety covers everything. The area that interests me most is the long-term accident risks. I think once you have very powerful AI systems, it almost doesn't matter if they're being used by the right people or the wrong people, or what you're trying to do with them. The difficulty is in keeping them under control at all. So that's what I'm going to be talking about. What is AI safety? Why is it important?

So I want to start by asking the question which I think everybody needs to be asking themselves: What is the most important problem in your field? Take a second to think of it.

And why are you not working on that? For me, I think the most important problem in the field of AI is AI safety. This is the problem specifically that I'm worried about: that we will sooner or later build an artificial agent with general intelligence. So I'm going to go into a bunch of these terms. The first thing is, what do I mean when I say "sooner or later"?

This is a little bit washed out, but this is a graph of a survey, a large survey of AI experts. These are people who published in major AI conferences, and they were asked when they thought we would achieve high-level machine intelligence, which is defined as an agent which is able to carry out any tasks humans can, as well as or better than humans. And they say that 50% chance of having achieved that, we hit that about 45 years from 2016. But then of course we hit like 10% chance nine years from now. So it's not immediate, but it's happening.

This is definitely worth taking with a pinch of salt, because if you ask the question slightly differently, you get an estimate of 120 years rather than 45. There's a lot of uncertainty in this area. But the point is, it's going to happen, as I said, sooner or later, because at the end of the day, general intelligence is possible. The brain implements it, and the brain is not magic. Sooner or later we'll figure it out.

So what do I mean when I say "an artificial agent"? Well, so an agent is a term from economics mostly, but basically agents have goals. They choose actions to further their goals. This is the simplest expression of what an agent is.

So the simplest thing that you might call an agent would be something like a thermostat. It has a goal, which is to have the room be at a particular temperature. It has actions it can take. It can turn on the heating. It could turn on the air conditioning. It chooses its actions to achieve its goal of maintaining the room at a steady temperature. Extremely simple agent.

A more complex agent might be something like a chess AI, which has a goal of, like, if it's playing white, it has a goal of the black king being in checkmate, and it takes actions in the form of moving pieces on the board in order to achieve its goal. So you see how this idea of an agent is a very useful way of thinking about lots of different intelligence systems.

And of course, humans can be modeled as agents as well. This is how it's usually done in economics. Individuals or companies could be considered to have a goal of, you know, maximizing their income or maximizing their profits, and making decisions in order to achieve that.

So when I'm talking about intelligence - intelligence has a lot of... as a term it's a heavily loaded term. It has a lot of different... people put their own definitions on it. In this context, what I mean when I say intelligence is just the thing that lets an agent choose effective actions. It's whatever it is that's in our brains, or that's in the programming of these systems, that means that the actions they choose tend to get them closer to their goals.

And so then you could say that an agent is more intelligent if it's more effective at achieving its goals, whatever those goals are. If you have two agents in an environment with incompatible goals, like let's say the environment is the chess board, and one agent wants white to win and one agent wants black to win, then generally the more intelligent agent will be the one that gets what it wants. The better AI will win the chess game.

And finally, general intelligence. This is where it becomes interesting, in my opinion. So generality is the ability to behave intelligently in a wide range of domains. If you take something like a chess AI, it's extremely narrow. It only knows how to play chess. And even though you might say that it's more intelligent than a thermostat because it's more sophisticated, it's more complicated, it couldn't do the thermostat's job. There's no position on the chessboard that corresponds to the room being a good temperature. There's no move that corresponds to turning on an air conditioner. The chess AI can only think in terms of chess. It's extremely narrow.

Generality is a continuous spectrum. So if you write a program that can play an Atari game, that's very narrow. DeepMind, one of their early triumphs was that they made a program that could play dozens of different Atari games. Single program that could learn all of these different games. And so it's more general, because it's able to act across a wider variety of domains.

The most general intelligence that we're aware of right now is human beings. Human beings are very general. We're able to operate across a very wide range of domains, including - and this is important - we're able to learn domains which evolution did not and could not prepare us for. We can, for example, drive a car. Evolution did not prepare us for that. We invented cars. They're very recent. We can, you know, invent rockets and go to the moon, and then we can operate on the moon, which is a completely different environment.

And this is kind of the power of general intelligence. Really the power of general intelligence is, we can build a car, we can build a rocket, we can put the car on the rocket, take the car to the moon, drive the car on the moon. And there's nothing else that can do that. Yet. But sooner or later, right?

So this is what I'm talking about. I'm talking about what you might call "true AI," "real AI," the sci-fi stuff. An agent which has goals in the real world and is able to intelligently choose actions in the real world to achieve those goals.

Now, that sounds... I've said, "what's the biggest problem?" This doesn't sound like a problem, right? On the surface of it, this sounds like a solution. You just tell the thing, you know, "cure cancer" or "maximize the profits of my company" or whatever, and it takes whatever actions are necessary in the real world to achieve that goal.

But it is a problem. So the big problem is... this should be auto-playing and it isn't. The big problem is, it's difficult to choose good goals.

So this is an AI made by OpenAI. It's playing a game called CoastRunners, which is actually a racing game. They trained it on the score, which you probably can't see down here. It's currently a thousand. What the system learned is that if it goes around in a circle here and crashes into everything and catches fire, these little turbo pickups - they respawn at just the right rate that if it just flings itself around in a circle, it can pick up the turbo, and that gives you a few points every time you do that. And it turns out that this is a much better way of getting points than actually racing around the track.

And the important point here is that this is not unusual. This is not OpenAI doing anything unusually stupid. This is kind of the default. Picking objectives is surprisingly hard, and you will find that the strategy or the behavior that maximizes your objective is probably not the thing you thought it was. It's probably not what you were aiming for.

There's loads of examples, actually. Victoria has a great list on her blog, Deep Safety. There's like 30 of them, different things going wrong. There was one - they had... they were trying to teach... they were trying to evolve systems that would run quickly. So they trained them on the... I'm going to pause this because it's distracting as hell.

Where's my mouse? Yeah, pause. Pause please.

They were training like agents that were supposed to run. So they simulated them for a particular period of time and measured how far their center of mass moved, which seems perfectly sensible. What they found was that they developed a bunch of these creatures which were extremely tall and thin with a big mass on the end, that then fell over. Because they weren't simulating them for long enough. You could go the fastest just by falling over, rather than actually running. That moved your center of mass the furthest.

There's a lot of these. There was a Tetris bot which would play reasonably well, and then just when it was about to lose, would pause the game and sit there indefinitely. Because it lost points for losing, but didn't lose any points for just sitting on the pause screen indefinitely. This is like the default of how these systems behave.

I have no memory what my next slide is. Oh yeah, right. So we have problems specifying even simple goals in simple environments, like Atari games or basic evolutionary algorithms, things like that. When it comes to the real world, things get way more complicated.

This is a quote from Stuart Russell, who sort of wrote the book on AI: "When a system is optimizing a function of n variables, where the objective depends on a subset of size k, which is less than n, it will often set the remaining unconstrained variables to extreme values. If one of those unconstrained variables is something that we care about, the solution found may be highly undesirable."

In the real world, we have a very large number of variables, and so we're talking about very large values for n here.

So let's say you've got your robot and you've given it a goal which you think is very simple. You want it to get you a cup of tea. So you've managed to specify what a cup of tea is and that you want one to be on the desk in front of you. So far so good. But suppose there is a... there's a priceless vase on a narrow stand, sort of in front of where the kitchen is. So the robot immediately plows into the vase and destroys it on its way to make you a cup of tea. Because you only gave it one variable to keep track of in the goal, which is the tea. It doesn't care about the vase. You never told it to care about the vase. It destroys the vase. This is a problem.

So okay, now you can, you know, shut it down, modify it and say, "Okay, give me a cup of tea, but also don't knock over the vase." But then there will be a third thing. There is always another thing. Because when you're making decisions in the real world, you're always making trade-offs. You're always taking various things that you value and deciding how much of one you're willing to trade for how much of another. You know, "I could do this quicker, but it increases the risk of me making a mistake," or "I could do this cheaper, but it won't be as reliable," "I could do this faster, but it'll be more expensive." You're always trading these things off against one another.

And so an agent like this, which only cares about a limited subset of the variables in the system, will be willing to trade off arbitrarily large amounts of any of the variables that aren't part of its goal for arbitrarily tiny increases in any of the things which are in its goal.

So it will happily... let's say now, for example, now it values the vase, and those are the only things that it values. It might reason something like, "Okay, there's a human in the environment. The human moves around. The human may accidentally knock over the vase, and I care about the vase, so I have to kill the human." Right? And this is totally ridiculous. But if you didn't tell it that you value being alive, it doesn't care. And anything that it doesn't value is going to be lost.

If you manage to come up with... if you have a sufficiently powerful agent and you manage to come up with a really good objective function which covers the top 20 things that humans value, the 21st thing that humans value is probably gone forever. Because the smarter, the more powerful the agent is, the better it will be at figuring out ways to make these trade-offs, to gain a millionth of a percent better at one thing while sacrificing everything of some other variable.

So this is a problem. But actually, that scenario I gave was unrealistic in many ways. But one important way that it was unrealistic is that I had the system go wrong and then you just turn it off and fix it. But in fact, if the thing has a goal of getting you a cup of tea, this is not like a chess AI where you can just turn it off, because it has no concept of itself or being turned off. Its world model contains you. It contains itself. It contains the possibility of being turned off. And it's fully aware that if you turn it off because it knocked over the vase, it won't be able to get you any tea, which is the only thing it cares about. So it's not going to just let you turn it off. It will fight you. Or if it's slightly smarter, it will deceive you so that you believe it's working correctly, so that you don't want to change it, until it's in a position where you can't turn it off. And then it will go after its actual objective.

So this is a problem. And the thing is, this is a convergent instrumental goal. Which means it sort of doesn't matter what the goal is. It doesn't matter what your goal is as an agent. If you're destroyed, you can't achieve that goal. So it almost doesn't matter what goal we give it. There is only a very tiny fraction of possible goals that will involve it actually allowing itself to be turned off and modified. And that's quite complicated.

There are some other convergent instrumental goals. So we had self-preservation, goal preservation, resource acquisition. This is the kind of thing we can expect these kinds of systems to do. Most plans, you can do them better if you have more resources, whether that's money, computational resources, just free energy, matter, whatever.

The other one is self-improvement. Whatever you're trying to do, you can probably do it better if you're smarter. And AI systems potentially have the capacity to improve themselves, either just by acquiring more hardware to run on, or changing, you know, improving their software to run faster or better, or so on.

So there's a whole bunch of behaviors which intelligent systems, intelligent agents, generally intelligent agents, we would expect them to do by default. And that's really my core point. Artificial general intelligence is dangerous by default. It's much, much easier to build these kinds of agents which try to do ridiculous things and trick you and try to deceive you, or will fight you when you try to turn them off or modify them, on the way to doing some ridiculous thing which you don't want. Much easier to build that kind of agent than it is to build something which actually reliably does what you want it to do.

And that's why we have a problem. Because we have 45 to 120 years to figure out how to do it safely, which is a much harder problem. And we may only get one shot. It's entirely possible that the first true artificial general intelligence will manage to successfully achieve whatever its stupid goal is. And that could be truly a disaster on a global scale. So we have to beat this challenge on hard mode before anyone beats it on easy mode.

So are we screwed? No. We're only probably screwed.

There are things we can do. Safe general artificial intelligence is totally possible. It's just a very difficult technical challenge. And there are people working very hard on it right now, trying to solve a whole range of difficult technical challenges, so that we can figure out how to do this safely.

Thanks.

[Applause]

[Music]

You may have noticed in the intro and this outro that the image quality has improved since the last video. That's largely thanks to my excellent patrons. Thank you to all of these people here for helping me to get this new camera.

In this video I'm especially thanking James Pets, who's been hanging out with us on the Discord server, helping answer questions from the YouTube comments and so on. And actually, that last video about mesa-optimizers has had a lot of really good questions, so the next video will be answering some of those. That's coming up soon.

So thanks again to James and to all my patrons, to everyone who asked questions, and to you for watching. I'll see you next time.
