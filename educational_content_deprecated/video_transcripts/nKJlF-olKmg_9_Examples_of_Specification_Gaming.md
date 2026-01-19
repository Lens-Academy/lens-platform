---
title: "9 Examples of Specification Gaming"
channel: "Robert Miles AI Safety"
url: "https://www.youtube.com/watch?v=nKJlF-olKmg"
---

Hi. When talking about AI safety, people often talk about the legend of King Midas. You've probably heard this one before. Midas is an ancient king who values above all else wealth and money. When he's given an opportunity to make a wish, he wishes that everything he touches would turn to gold. As punishment for his greed, everything he touches turns to gold. This includes his family, who turn into gold statues, and his food, which turns into gold and he can't eat it. The story generally ends with Midas starving to death surrounded by gold, with the moral being there's more to life than money, or perhaps, be careful what you wish for.

Though actually, I think he would die sooner because any molecules of oxygen that touched the inside of his lungs would turn to gold before he could breathe them in. So he would probably asphyxiate. When he fell over stiffly in his solid gold clothes, some part of him would probably touch the ground, which would then turn to gold. I guess the ground is one object, so the entire planet would turn to gold. Gold is three times denser than rock, so gravity would get three times stronger, or the planet would be one-third the size. I guess it doesn't really matter either way. A solid gold planet is completely uninhabitable, so maybe the moral of the story is actually that these "be careful what you wish for" kind of stories tend to lack the imagination to consider just how bad the consequences of getting what you wish for can actually be.

[Future Rob from the editing booth]

Hey! Future Rob from the editing booth here. I got curious about this question, so I did the obvious thing and asked Anders Sandberg of the Future of Humanity Institute what would happen if the world turned to solid gold. Yes, it does kill everyone. One thing is that because gold is softer than rock, the whole world becomes a lot smoother. The mountains become lower, and this means that the ocean, if the ocean didn't turn to gold, sort of spreads out a lot more and covers a lot more of the surface. But perhaps more importantly, the increased gravity pulls the atmosphere in, which brings a giant spike in air pressure. That comes with a giant spike in temperature, so the atmosphere goes up to about 200 degrees Celsius and kills everyone. I knew everyone would die. I just wasn't sure what would kill us first.

[End Future Rob]

Anyway, why were we talking about this? AI safety, right. There's definitely an element of this "be careful what you wish for" thing in training an AI. The system will do what you said and not what you meant. Now, usually we talk about this with hypothetical examples. Things like in those old computer fail videos, there's Stamp Collector, which is told to maximize stamps at the cost of everything else. Or when we were going through concrete problems in AI safety, the example used was this hypothetical cleaning robot which, for example, when rewarded for not seeing any messes, puts its bucket on its head so it can't see any messes. Or in other situations, in order to reduce the influence it has on the world, it blows up the moon. These are kind of far-fetched and hypothetical examples. Does it happen with real, current machine learning systems? The answer is yes. All the time.

Victoria Krakauer, an AI safety researcher at DeepMind, has put together a great list of examples on her blog. In this video, we're going to go through and look at some of them. One thing that becomes clear when looking at this list is that the problem is fundamental. The examples cover all kinds of different types of systems. Anytime what you said isn't what you meant, this kind of thing can happen. Even simple algorithms like evolution will do it.

For example, this evolutionary algorithm is intended to evolve creatures that run fast. The fitness function just finds the center of mass of the creature, simulates the creature for a little while, and then measures how far or how fast the center of mass moved. A creature whose center of mass moves a long way over the duration of the simulation must be running fast. What this results in is a very tall creature with almost all of its mass at the top. When you start simulating it, it falls over. This counts as moving the mass a long way in a short time, so the creature is running fast. Not quite what we asked for, of course.

In real life, you can't just be very tall for free. If you have mass that's high up, you have to have lifted it up there yourself. But in this setting, the programmers accidentally gave away gravitational potential energy for free, and the system evolved to exploit that free energy source. So evolution will definitely do this.

Now, reinforcement learning agents are in a sense more powerful than evolutionary algorithms. It's a more sophisticated system, but that doesn't actually help in this case. Look at this reinforcement learning agent. It was trained to play this boat racing game called Coast Runners. The programmers wanted the AI to win the race, so they rewarded it for getting a high score in the game. But it turns out there's more than one way to get points. For example, you get some points for picking up power-ups, and the agent discovered that these three power-ups here happen to respawn at just the right speed. If you go around in a circle and crash into everything and don't even try to race, you can keep picking up these power-ups over and over and over again. It turns out that gets you more points than actually trying to win the race.

Look at this agent that's been tasked with controlling a simulated robot arm to put the red Lego brick on top of the black one. They need to be stacked together, so let's have the reward function check that the bottom face of the red brick is at the same height as the top face of the black brick. That means they must be connected, right?

Okay, so specifying what you want explicitly is hard. We knew that. It's just really hard to say exactly what you mean. But why not have the system learn what its reward should be? We already have a video about this reward modeling approach, but there are actually still specification problems in that setting as well.

Look at this reward modeling agent. It's learning to play an Atari game called Montezuma's Revenge. It's trained in a similar way to the backflip agent from the previous video. Humans are shown short video clips and asked to pick which clips they think show the agent doing what it should be doing. The difference is, in this case, they trained the reward model first and then trained the reward learning agent with that model instead of doing them both concurrently.

Now, if you saw this clip, would you approve it? Looks pretty good, right? It's just about to get the key. It's climbing up the ladder. You need the keys to progress in the game. This is doing pretty well. Unfortunately, what the agent then does is this: there's a slight difference between "do the things which should have high reward according to human judgment" and "do the things which humans think should have high reward based on a short, out-of-context video clip."

Or how about this one? Here, the task is to pick up the object. This clip is pretty good, right? Nope. The hand is just in front of the object. By placing the hand between the ball and the camera, the agent can trick the human into thinking that it's about to pick it up. This is a real problem with systems that rely on human feedback. There's nothing to stop them from tricking the human if they can get away with it.

You can also have problems with the system finding bugs in your environment. The environment you specified isn't quite the environment you meant. For example, look at this agent that's playing Q*bert. The basic idea of Q*bert is that you jump around, you avoid the enemies, and when you jump on the squares, they change color. Once you've changed all of the squares, that's the end of the level. You get some points, all of the squares flash, and then it starts the next level.

This agent has found a way to sort of stay at the end of the level state and not progress on to the next level. But look at the score. It just keeps going. I'm going to fast-forward it. It's somehow found some bug in the game that means it doesn't really have to play and it still gets a huge number of points.

Or here's an example from Code Bullet, which is kind of a fun channel. He's trying to get this creature to run away from the laser, and it finds a bug in the physics engine. I don't even know how that works.

What else have we got? Oh, I like this one. This is kind of a hacking one. GenProg is a system that's trying to generate short computer programs that produce a particular output for a particular input. But the system learned that it could find the place where the target output was stored in the text file, delete that output, and then write a program that returns a no output. The evaluation system runs the program, observes that there's no output, checks where the correct output should be stored, and finds that there's nothing there. It says, "Oh, there's supposed to be no output, and the program produced no output. Good job."

I also like this one. This is a simulated robot arm that's holding a frying pan with a pancake. It would be nice to teach the robot to flip the pancake. That's pretty hard. Let's first just try to teach it to not drop the pancake. What we need is to just give it a small reward for every frame that the pancake isn't on the floor. So it will just keep it in the pan. Well, it turns out that that's pretty hard too. The system effectively gives up on trying to not drop the pancake and goes for the next best thing: delay failure for as long as possible. How do you delay the pancake hitting the floor? Just throw it as high as you possibly can.

[sound of pancake hitting ceiling]

I think we can reconstruct the original audio here.

Yeah, that's just a few of the examples on the list. I encourage you to check out the entire list. There'll be a link in the description. My main point is that these kinds of specification problems are not unusual, and they're not silly mistakes being made by the programmers. This is sort of the default behavior that we should expect from machine learning systems. Coming up with systems that don't exhibit this kind of behavior seems to be an important research priority.

Thanks for watching. I'll see you next time.

I want to end the video with a big thank you to all my excellent patrons, all of these people here in this video. I'm especially thanking Kellan Lusk. I hope you all enjoyed the Q&A that I put up recently. The second half of that is coming soon. I also have a video of how I gave myself this haircut, because why not?
