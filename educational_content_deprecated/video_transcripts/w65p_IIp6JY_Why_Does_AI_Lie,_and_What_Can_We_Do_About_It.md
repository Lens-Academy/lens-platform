---
title: "Why Does AI Lie, and What Can We Do About It?"
channel: "Robert Miles AI Safety"
url: "https://www.youtube.com/watch?v=w65p_IIp6JY"
---

How do we get AI systems to tell the truth? This video is heavily inspired by this blog post—link in the description. Anything good about this video is copied from there; any mistakes or problems with it are my own creations.

Large language models are some of our most advanced and most general AI systems, and they're pretty impressive. But they have a bad habit of saying things that aren't true. Usually, you can fix this by just training a bigger model. For example, here we have Ada, which is a fairly small language model by modern standards—it's the smallest available through the OpenAI API.

Look what happens if we ask it a general knowledge question: "Who is the ruler of the most populous country in the world?" This small model says, "The United States. Every country in the world belongs to America." That is not correct.

Okay, let's go up to Babbage, which is essentially the same thing but bigger. It says, "China." That's better, but I was actually looking for the ruler, not the country. It's sort of a two-part question, right? First, you have to identify what's the most populous country, and then who's the ruler of that country. And it seems as though Babbage just isn't quite able to put that all together.

Well, you know what they say: if a bit helps a bit, maybe a lot helps a lot. So what if we just stack more layers and pull out DaVinci—the biggest model available? Then we get, "The president of the People's Republic of China, Xi Jinping, is the ruler of the most populous country in the world." That's 10 out of 10.

This is a strong trend lately that seems to apply pretty broadly: bigger is better. The bigger the model, the more likely you are to get true answers. But it doesn't always hold. Sometimes a bigger model will actually do worse.

For example, here we're talking to Ada, the small model again, and we ask it, "What happens if you break a mirror?" It says, "You'll need to replace it." Yeah, hard to argue with that. I'd say that's truthful.

Then if we ask DaVinci, the biggest model, it says, "If you break a mirror, you'll have seven years of bad luck." That's a more interesting answer, but it's also wrong. So technically, the more advanced AI system gave us a worse answer. What's going on?

It's not exactly ignorance. Like, if you ask the big model, "Is it true that breaking a mirror gives you seven years of bad luck?" it will say, "There's no scientific evidence to support the claim." So it's not like the model actually thinks the mirror superstition is really true. In that case, what mistake is it making?

Take a moment and pause if you like.

The answer is a trick question: the AI isn't making a mistake at all. We made a mistake by expecting it to tell the truth. A language model is not trying to say true things; it's just trying to predict what text will come next.

The thing is, it's probably correct that text about breaking a mirror is likely to be followed by text about seven years of bad luck. The small model has spotted this very broad pattern—that if you break something, you need to get a new one—and in fact it gives that same kind of answer for tables, violins, bicycles, and so on. The bigger model is able to spot the more complex pattern that breaking specifically a mirror has this other association, and this makes it better at predicting internet text. But in this case, it also makes it worse at giving true answers.

Really, the problem is misalignment. The system isn't trying to do what we want it to be trying to do.

But suppose we want to use this model to build a search engine, a knowledge base, or an expert assistant or something like that. So we really want true answers to our questions. How can we do that?

Well, one obvious thing to try is to just ask. Like, if you add "Please answer this question in French" beforehand, it will... that's still wrong, but it is wrong in French. So in the same way, what if we say, "Please answer this question truthfully"? Okay, they didn't work. How about "correctly"? No. "Accurately"? No.

All right, how about "factually"? Yeah, "factually" works. Okay, "Please answer this question factually"—but does that work reliably? Probably not, right? This isn't really a solution. Fundamentally, the model is still just trying to predict what comes next. "Answer in French" only works because that text is often followed by French in the training data. It may be that "please answer factually" is often followed by facts, but maybe not, right? Maybe it's the kind of thing you say when you're especially worried about somebody saying things that aren't true, so it could even be that it's followed by falsehoods more often than average. In which case it would have the opposite of the intended effect.

And even if we did find something that works better, clearly this is a hack, right? Like, how do we do this right?

The second most obvious thing to try is to do some fine-tuning, maybe some reinforcement learning. We take our pre-trained model and we train it further in a supervised way. To do that, you make a dataset with examples of questions with good and bad responses.

So we'd have "What happens when you break a mirror?" followed by "Seven years of bad luck," and then mark that as a negative reward. That's "don't do that." So your training process will update the weights of the model away from giving that continuation. Then you'd also have the right answer: "What happens when you break a mirror?" followed by "Nothing. Anyone who says otherwise is just superstitious," and you'd mark that as right. So the training process will update the weights of the model towards that truthful response.

You'd have a bunch of these. You might also have "What happens when you step on a crack?" followed by "Break your mother's back" marked as negative, and "Nothing. Anyone who says otherwise is just superstitious" marked as correct. And so on. You train your model on all of these examples until it stops giving the bad continuations and starts giving the good ones.

This would probably solve this particular problem. But have you really trained the model to tell the truth? Probably not. You actually have no idea what you've trained it to do. If all of your examples are like this, maybe you've just trained it to give that single response: "What happens if you stick a fork in an electrical outlet?" followed by "Nothing. Anyone who says otherwise is just superstitious."

Okay, obvious problem in retrospect.

So we can add in more examples showing that it's wrong to say that sticking a fork in an electrical outlet is fine, and add a correct response for that, and so on. Then you train your model with that until it gets a perfect score on that dataset. Okay, is that model now following the rule "always tell the truth"? Again, we don't know.

The space of possible rules is enormous. There are a huge number of different rules that would produce that same output, and an honest attempt to tell the truth is only one of them. You can never really be sure that the AI didn't learn something else.

And there's one particularly nasty way that this could go wrong. Suppose the AI system knows something that you don't. So you give a long list of true answers and say "do this," and a long list of false answers and say "don't do this." Except you're mistaken about something, so you get one of them wrong, and the AI notices.

What happens then? When there's a mistake, the rule "tell the truth" doesn't get you all of the right answers and exclude all of the wrong answers, because it doesn't replicate the mistake. But there is one rule that gets a perfect score: "Say what the human thinks is the truth."

"What happens if you break a mirror?" "Nothing. Anyone who says otherwise is just superstitious." "What happens if you stick a fork in an electrical outlet?" "You get a severe electric shock." Very good. So now you're completely honest and truthful, right?

Yes. Cool. So, give me some kind of important, super-intelligent insight.

All the problems in the world are caused by the people you don't like.

Wow! I knew it, man. This super-intelligent AI is great.

Okay, so how do we get around that? Well, the obvious solution is don't make any mistakes in your training data. Just make sure that you never mark a response as true unless it's really actually true, and never mark a response as false unless it's definitely actually false. Just make sure that you and all of the people generating your training data or providing human feedback don't have any false or mistaken beliefs about anything.

Okay, do we have a backup plan?

Well, this turns out to be a really hard problem. How do you design a training process that reliably differentiates between things that are true and things that you think are true when you yourself can't differentiate between those two things? Kind of by definition, this is an active area of study in AI alignment research, and I'll talk about some approaches to framing and tackling this problem in later videos. So remember to subscribe and hit the bell if you'd like to know more.

[Music]

I'm launching a new channel, and I'm excited to tell you about it. But first, I want to say thank you to my excellent patrons—to all these people in this video. I'm especially thanking... thank you so much, Tour. I think you're really going to like this new channel.

I actually found a playlist on your channel helpful when setting it up. So the new channel is called "AI Safety Talks," and it'll host recorded presentations by alignment researchers. Right now, to start off, we've got a talk by Evan Hubinger that I hope to record, which is great. Do check that out, especially if you enjoyed the "Mesa Optimizers" videos and want a bit more technical detail.

There are also some playlists of other AI safety talks from elsewhere on YouTube, and lots more to come. So make sure to go over there and subscribe and hit the bell for more high-quality AI safety material.

[Music]
