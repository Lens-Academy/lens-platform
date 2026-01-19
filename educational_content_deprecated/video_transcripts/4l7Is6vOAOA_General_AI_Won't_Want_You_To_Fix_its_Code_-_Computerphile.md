---
title: "General AI Won't Want You To Fix its Code - Computerphile"
channel: "Computerphile"
url: "https://www.youtube.com/watch?v=4l7Is6vOAOA"
---

So, before, we were talking about AI risk and AI safety, and just trying to lay out in a very generalized sort of way how general artificial intelligence can be dangerous and some of the types of problems it could cause, and just introducing the idea of AI safety or AI alignment theory as an area of research in computer science. And we also talked about superintelligence and the kind of problems that, the unique problems that can pose, and I thought what would be good is to bring it down to a more concrete example of current AI safety research that's going on now, and kind of give a feel for where we are, where humanity is on figuring these problems out.

Supposing that we do develop a general intelligence, you know, an algorithm that actually implements general intelligence. How do we safely work on that thing and improve it? Because the situation with this stamp collector is from its first instant it's a superintelligence, so we created it with a certain goal, and as I said, as soon as we switch it on it's extremely dangerous. Which people pointed out, and it's true, you know, it was a thought experiment. It's true that that's probably not what will happen, right? You'll have some significantly weaker intelligence first that may work on improving itself, or we may improve it.

So the situation where you just create the thing and then it goes off and does its own thing, either perfectly or terribly from the beginning, is unlikely. It's more likely that the thing will be under development. So then the question is, how do you make a system which you can teach? How do you create a system which is a general intelligence that wants things in the real world and is trying to act in the real world, but is also amenable to being corrected? If you create it with the wrong function, with one utility function, and you realize that it's doing something that actually you don't want it to do, how do you make it so that it will allow you to fix it? How do you make an AI which understands that it's unfinished, that understands that the utility function it's working with may not be the actual utility function it should be working with?

Right, the utility function is what the AI cares about. So the stamp collecting device, its utility function was just "how many stamps exist in the universe."

This is kind of like its measure, is it?

Yeah, it's what it is, the thing that it's trying to optimize in the world. The utility function takes in world states as an argument and spits out a number. It's basically the idea: if the world was like this, is that good or bad? And the AI is trying to steer towards world states that it values highly by that utility function. You don't have to explicitly build the AI in that way, but it will always, if it's behaving coherently, it will always behave as though it's in accordance with some utility function.

Also before I talked about converging instrumental goals, that if you have some final goal, like, you know, making stamps, there are also instrumental goals, which are the goals that you do on the way to your final goal, right? So like "acquire the capacity to do printing" is perhaps an instrumental goal towards making stamps. But the thing is, there are certain goals which tend to pop out even across a wide variety of different possible terminal goals.

So for humans, an example of a convergent instrumental goal would be money. If you want to make a lot of stamps, or you want to cure cancer, or you want to establish a moon colony, whatever it is, having money is a good idea, right? So even if you don't know what somebody wants, you can reasonably predict that they're going to value getting money, because money is so broadly useful.

And before, we talked about this. We talked about improving your own intelligence as a convergent instrumental goal. That's another one of those things where it doesn't really matter what you're trying to achieve, you're probably better at achieving it if you're smarter. So that's something you can expect AIs to go for, even without making any assumptions about their final goal.

So another convergent instrumental goal is preventing yourself from being destroyed. It doesn't matter what you want to do, you probably can't do it if you're destroyed. So it doesn't matter what the AI wants. You can have an AI that wants to be destroyed, in some trivial case. But if it does want something in the real world and believes that it's in a position to get that thing, it wants to be alive. Not because it wants to be alive fundamentally. It's not a survival instinct or an urge to live or anything like that. It's smoothly knowing that it's not going to be able to complete its duty, would be almost... It's going to be unable to achieve its goals if it's destroyed, and it wants to achieve that goal. So that's an instrumental value, preventing being turned off.

And I'm guessing here, when we say "wants," it's not like a machine wants. It's just a turn of phrase?

Yeah, I mean, as much as anything. It's closer, actually. You know, I'm not even sure I would agree. Like if you talk about most machines, to talk about that they "want" to do whatever, it's not that meaningful because they're not agents in the way a general intelligence is. When a general intelligence wants something, it wants in a similar way to the way that people want things. So it's such a tight analogy that, I wouldn't even... I think it's totally reasonable to say that an AGI wants something.

There's another slightly more subtle version which is closely related to not wanting to be turned off or destroyed, which is not wanting to be changed. So if you imagine, let's say... I mean, you have kids, right?

Yeah.

Suppose I were to offer you a pill or something. You could take this pill, and it will like completely rewire your brain so that you would just absolutely love to kill crickets, right? Whereas right now, what you want is like very complicated and quite difficult to achieve, and it's hard work for you, and you're probably never going to be done. You're never going to be truly happy, right, in life. Nobody is. You can't achieve everything you want. In this case, it just changes what you want. What you want is to kill crickets. And if you do that, you will be just perfectly happy and satisfied with life, right? Okay, you want to take this pill?

No.

Are you happy though?

Yeah, I don't want to do it because...

But that's quite a complicated specific case because it directly opposes what I currently want. It's about your fundamental values and goals, right? And so not only will you not take that pill, you will probably fight pretty hard to avoid having it administered to you.

Yes.

Because it doesn't matter how that future version of you would feel. You know that right now you love your kids, and you're not going to take any action right now which leads to them coming to harm.

So it's the same thing. If you have an AI that, for example, values stamps, values collecting stamps, and you go, "Oh, wait, hang on a second, I didn't quite do that right. Let me just go in and change this so that you don't like stamps quite so much," it's going to say, "But the only important thing is stamps! If you change me, I'm not going to collect as many stamps, which is something I don't want." There's a general tendency for AGI to try and prevent you from modifying it once it's running.

I can understand that now, in the context we're talking about, right? Because that's it. In almost any situation, being given a new utility function is going to rate very low on your current utility function.

Okay, so that's a problem. How do you... if you want to build something that you can teach, that means you want to be able to change its utility function, and you don't want it to fight you on it, right?

100%, yeah.

So this has been formalized as this property that we want early AGI to have, called corrigibility. That is to say, it's open to being corrected.
