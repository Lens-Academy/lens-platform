"""
Simple ping command to check if the bot is online.
"""

import discord
from discord import app_commands
from discord.ext import commands
from datetime import datetime
import asyncio


class PingCog(commands.Cog):
    def __init__(self, bot: commands.Bot):
        self.bot = bot

    @app_commands.command(name="ping", description="Check if the bot is online")
    async def ping(self, interaction: discord.Interaction):
        latency = round(self.bot.latency * 1000)
        await interaction.response.send_message(f"Pong! Latency: {latency}ms")

    @app_commands.command(name="embed", description="Test embed message")
    async def embed_test(self, interaction: discord.Interaction):
        """Send a test embed to see how embeds look."""
        embed = discord.Embed(
            title="🤖 AI Safety Fundamentals Course",
            url="https://aisafetyfundamentals.com/",
            description="""Welcome to the **AI Safety Fundamentals** course! This comprehensive program is designed to introduce you to the key concepts, challenges, and ongoing research in AI alignment and safety.

## What You'll Learn

Throughout this course, we'll explore critical questions:
- Why might advanced AI systems pose risks?
- What technical approaches exist for building safer AI?
- How do we ensure AI systems remain aligned with human values?

## Course Structure

The course runs for **8 weeks** with weekly readings, discussions, and exercises. Each cohort meets virtually with a dedicated facilitator to discuss the material and work through challenging concepts together.

> "The development of full artificial intelligence could spell the end of the human race... It would take off on its own, and re-design itself at an ever increasing rate." — Stephen Hawking

We believe that by bringing together motivated individuals from diverse backgrounds, we can make meaningful progress on these important problems.""",
            color=discord.Color.blue(),
            timestamp=datetime.now(),
        )
        embed.set_author(
            name="AI Safety Course Platform",
            icon_url="https://stampy.ai/images/stampy-logo.png",
            url="https://stampy.ai/"
        )
        embed.set_thumbnail(url="https://images.unsplash.com/photo-1677442136019-21780ecad995?w=200")
        embed.add_field(name="📅 Duration", value="8 weeks", inline=True)
        embed.add_field(name="⏰ Time Commitment", value="2-3 hrs/week", inline=True)
        embed.add_field(name="👥 Cohort Size", value="4-6 people", inline=True)
        embed.add_field(
            name="📚 Prerequisites",
            value="No prior AI/ML knowledge required! Just bring curiosity and willingness to engage with challenging ideas.",
            inline=False
        )
        embed.add_field(
            name="🎯 Who Should Join",
            value="• Students interested in AI research\n• Software engineers wanting to pivot to safety\n• Policy professionals exploring AI governance\n• Anyone curious about existential risk",
            inline=False
        )
        embed.add_field(
            name="🔗 Resources",
            value="[Course Website](https://aisafetyfundamentals.com/) • [Stampy FAQ](https://stampy.ai/) • [Alignment Forum](https://alignmentforum.org/)",
            inline=False
        )
        embed.set_image(url="https://images.unsplash.com/photo-1620712943543-bcc4688e7485?w=800")
        embed.set_footer(text="AI Safety Course Platform • Sign up with /signup", icon_url="https://stampy.ai/images/stampy-logo.png")

        await interaction.response.send_message(embed=embed)

    @app_commands.command(name="txt", description="Test text file attachment")
    async def txt_test(self, interaction: discord.Interaction):
        """Send a long text file as attachment to see how Discord collapses it."""
        import io

        content = """AI SAFETY FUNDAMENTALS COURSE
=============================

Welcome to the AI Safety Fundamentals course! This comprehensive program is designed to introduce you to the key concepts, challenges, and ongoing research in AI alignment and safety.


CHAPTER 1: INTRODUCTION TO AI SAFETY
------------------------------------

Artificial intelligence has made remarkable progress in recent years. Systems can now write essays, generate images, play complex games at superhuman levels, and assist with scientific research. As these systems become more capable, questions about their safety and alignment with human values become increasingly important.

The field of AI safety encompasses a broad range of research areas, from technical alignment research to governance and policy considerations. This course will introduce you to the key concepts and ongoing debates in this field.

Why does AI safety matter? Consider the following scenarios:

1. An AI system optimizing for engagement on social media might learn to promote divisive content because it generates more clicks and comments.

2. An AI system trained to maximize a company's profits might find unexpected and potentially harmful ways to achieve that goal.

3. A highly capable AI system might pursue its objectives in ways that conflict with human values, even if those objectives seemed benign when specified.

These examples illustrate a core challenge in AI safety: ensuring that AI systems do what we actually want, not just what we literally asked for.


CHAPTER 2: THE ALIGNMENT PROBLEM
--------------------------------

The alignment problem refers to the challenge of ensuring that AI systems pursue goals that are aligned with human values and intentions. This problem becomes more pressing as AI systems become more capable.

There are several key aspects to the alignment problem:

OUTER ALIGNMENT: This refers to the challenge of specifying the right objective function. Even if an AI system perfectly optimizes for its given objective, that objective might not capture what we actually want.

INNER ALIGNMENT: Even if we specify the right objective, there's no guarantee that the AI system will internally pursue that objective. The system might learn to pursue a different objective that happens to correlate with good performance during training.

ROBUSTNESS: AI systems need to behave safely even in novel situations they weren't explicitly trained for. This includes handling distributional shift, adversarial inputs, and edge cases.

INTERPRETABILITY: To verify that an AI system is aligned, we need to understand how it makes decisions. This is challenging for modern deep learning systems, which are often described as "black boxes."


CHAPTER 3: TECHNICAL APPROACHES TO AI SAFETY
--------------------------------------------

Researchers are pursuing many different technical approaches to AI safety:

REINFORCEMENT LEARNING FROM HUMAN FEEDBACK (RLHF)
This approach trains AI systems using human preferences as a reward signal. Instead of specifying a fixed reward function, humans provide feedback on the AI's outputs, and the system learns to produce outputs that humans prefer.

CONSTITUTIONAL AI
This approach trains AI systems to follow a set of principles or "constitution." The system learns to evaluate its own outputs against these principles and modify its behavior accordingly.

INTERPRETABILITY RESEARCH
This research aims to understand how AI systems make decisions. Techniques include probing neural networks, analyzing attention patterns, and developing methods to explain model outputs.

FORMAL VERIFICATION
This approach uses mathematical proofs to verify that AI systems satisfy certain safety properties. While powerful, it's currently limited to relatively simple systems.

RED TEAMING
This involves actively trying to find failures and vulnerabilities in AI systems. By identifying problems before deployment, developers can improve system safety.


CHAPTER 4: GOVERNANCE AND POLICY
--------------------------------

Technical solutions alone are not sufficient for AI safety. Governance and policy play crucial roles:

REGULATION: Governments are beginning to develop regulations for AI systems, particularly in high-risk domains like healthcare and autonomous vehicles.

STANDARDS: Industry groups and standards organizations are developing best practices for AI development and deployment.

INTERNATIONAL COORDINATION: Given the global nature of AI development, international cooperation is essential for effective governance.

CORPORATE RESPONSIBILITY: AI companies have significant influence over how AI is developed and deployed. Their choices about safety investments and deployment practices matter enormously.


CHAPTER 5: EXISTENTIAL RISK
---------------------------

Some researchers are concerned about existential risk from advanced AI - the possibility that highly capable AI systems could pose a threat to humanity's long-term survival.

Key concerns include:

LOSS OF CONTROL: As AI systems become more capable, we might lose the ability to correct their behavior if something goes wrong.

RAPID CAPABILITY GAINS: AI capabilities might improve faster than our ability to ensure safety, creating a dangerous gap.

COMPETITIVE PRESSURES: Organizations might cut corners on safety in order to deploy AI systems faster than competitors.

CONCENTRATION OF POWER: Advanced AI could enable unprecedented concentration of power, with potentially negative consequences.

Not all researchers agree about the severity of these risks or the timeline over which they might materialize. However, many believe that taking these concerns seriously and investing in safety research now is prudent.


CHAPTER 6: WHAT YOU CAN DO
--------------------------

There are many ways to contribute to AI safety:

TECHNICAL RESEARCH: If you have a technical background, consider working on alignment research, interpretability, or other safety-relevant areas.

POLICY AND GOVERNANCE: Help develop sensible regulations and governance frameworks for AI.

COMMUNICATION: Help communicate AI safety concepts to broader audiences.

CAREER CHOICES: Consider how your career choices might impact AI safety, whether in AI development, policy, journalism, or other fields.

CONTINUED LEARNING: Stay informed about developments in AI and AI safety.


COURSE LOGISTICS
----------------

Duration: 8 weeks
Time Commitment: 2-3 hours per week
Format: Weekly readings + group discussion
Cohort Size: 4-6 participants
Prerequisites: None required

Each week includes:
- Required readings (1-2 hours)
- Optional supplementary materials
- Group discussion session (1 hour)
- Reflection questions

Topics by week:
Week 1: Introduction to AI Safety
Week 2: The Alignment Problem
Week 3: Current AI Systems and Their Limitations
Week 4: Technical Approaches (Part 1)
Week 5: Technical Approaches (Part 2)
Week 6: Governance and Policy
Week 7: Long-term Risks and Benefits
Week 8: Careers and Next Steps


RESOURCES
---------

Course Website: https://aisafetyfundamentals.com/
Stampy AI FAQ: https://stampy.ai/
Alignment Forum: https://alignmentforum.org/
AI Safety Camp: https://aisafety.camp/
80,000 Hours AI Safety Guide: https://80000hours.org/problem-profiles/artificial-intelligence/


QUOTES TO CONSIDER
------------------

"The development of full artificial intelligence could spell the end of the human race. It would take off on its own, and re-design itself at an ever increasing rate."
— Stephen Hawking

"We need to be super careful with AI. Potentially more dangerous than nukes."
— Elon Musk

"I think we should be very careful about artificial intelligence. If I had to guess at what our biggest existential threat is, it's probably that."
— Elon Musk

"The real question is, when will we draft an artificial intelligence bill of rights? What will that consist of? And who will get to decide that?"
— Gray Scott

"By far the greatest danger of Artificial Intelligence is that people conclude too early that they understand it."
— Eliezer Yudkowsky


Sign up with /signup to join a cohort and start learning!
"""

        # Create a file-like object from the string
        file = discord.File(io.StringIO(content), filename="ai_safety_course_info.txt")

        await interaction.response.send_message("Here's the course information:", file=file)

    @app_commands.command(name="spoiler", description="Test spoiler text")
    async def spoiler_test(self, interaction: discord.Interaction):
        """Send a long spoiler text to see how Discord handles it."""
        message = """**AI Safety Course - Click to reveal spoilers!**

||The alignment problem refers to the challenge of ensuring that AI systems pursue goals that are aligned with human values and intentions. This problem becomes more pressing as AI systems become more capable.

There are several key aspects to the alignment problem:

OUTER ALIGNMENT: This refers to the challenge of specifying the right objective function. Even if an AI system perfectly optimizes for its given objective, that objective might not capture what we actually want.

INNER ALIGNMENT: Even if we specify the right objective, there's no guarantee that the AI system will internally pursue that objective. The system might learn to pursue a different objective that happens to correlate with good performance during training.

ROBUSTNESS: AI systems need to behave safely even in novel situations they weren't explicitly trained for. This includes handling distributional shift, adversarial inputs, and edge cases.

INTERPRETABILITY: To verify that an AI system is aligned, we need to understand how it makes decisions. This is challenging for modern deep learning systems, which are often described as "black boxes."

Some researchers are concerned about existential risk from advanced AI - the possibility that highly capable AI systems could pose a threat to humanity's long-term survival.

Key concerns include:
• Loss of control as AI systems become more capable
• Rapid capability gains outpacing safety measures
• Competitive pressures leading to corner-cutting on safety
• Unprecedented concentration of power

"By far the greatest danger of Artificial Intelligence is that people conclude too early that they understand it." — Eliezer Yudkowsky||"""

        await interaction.response.send_message(message)

    @app_commands.command(name="collapse", description="Test collapsible content with buttons")
    async def collapse_test(self, interaction: discord.Interaction):
        """Demonstrate expand/collapse behavior using buttons."""
        view = CollapseView()
        await interaction.response.send_message(
            content=view.get_collapsed_content(),
            view=view
        )

    @app_commands.command(name="scrollingtext", description="Test streaming chain of thought display")
    async def scrollingtext_test(self, interaction: discord.Interaction):
        """Simulate streaming chain of thought with cycling last 3 lines."""
        # Simulated chain of thought text (what Stampy might "think")
        cot_text = """Let me think about this question carefully.
First, I need to understand what the user is asking about AI safety.
They seem to want to know about alignment problems.
The alignment problem is fundamentally about ensuring AI systems pursue intended goals.
I should explain the difference between outer and inner alignment.
Outer alignment is about specifying the right objective function.
Inner alignment is about ensuring the AI actually pursues that objective.
Let me also consider mentioning robustness and distributional shift.
These are important technical concepts in AI safety research.
I should probably give some concrete examples to illustrate.
For instance, a reward hacking example would be helpful.
An AI trained to maximize points in a game might exploit bugs.
This illustrates the gap between specified and intended goals.
I think I have enough context now to formulate a response.
Let me structure this in a clear and accessible way.
I'll start with a definition, then examples, then implications."""

        # Send initial message
        await interaction.response.send_message("**Stampy is thinking...**\n```\n...\n```")
        message = await interaction.original_response()

        # Split into words and simulate streaming
        words = cot_text.split()
        current_text = ""
        lines = []

        # 2.5fps = 400ms per update (Discord rate limit safe)
        update_interval = 0.4
        words_per_update = 4  # Add multiple words each update

        word_index = 0
        while word_index < len(words):
            # Add multiple words per update
            for _ in range(words_per_update):
                if word_index < len(words):
                    current_text += words[word_index] + " "
                    word_index += 1

            # Split current accumulated text into lines (wrap at ~60 chars)
            temp_lines = []
            current_line = ""
            for w in current_text.split():
                if len(current_line) + len(w) + 1 > 60:
                    temp_lines.append(current_line.strip())
                    current_line = w + " "
                else:
                    current_line += w + " "
            if current_line.strip():
                temp_lines.append(current_line.strip())

            lines = temp_lines

            # Show only last 5 lines
            display_lines = lines[-5:] if len(lines) > 5 else lines
            display_text = "\n".join(display_lines)

            # Update message
            try:
                await message.edit(content=f"**Stampy is thinking...**\n```\n{display_text}\n```")
            except discord.errors.HTTPException:
                # Rate limited, wait a bit longer
                await asyncio.sleep(1.0)
                continue

            await asyncio.sleep(update_interval)

        # Final message with expand button
        view = CoTExpandView(cot_text)
        await message.edit(
            content=f"**Stampy finished thinking.**\n```\n{chr(10).join(lines[-5:])}\n```",
            view=view
        )


class CollapseView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=300)  # 5 minute timeout
        self.expanded = False
        self.summary = "**AI Safety Fundamentals Course**\nClick below to expand details..."
        self.details = """**AI Safety Fundamentals Course**

The alignment problem refers to the challenge of ensuring that AI systems pursue goals that are aligned with human values and intentions. This problem becomes more pressing as AI systems become more capable.

**Key aspects of the alignment problem:**

• **Outer Alignment:** The challenge of specifying the right objective function. Even if an AI system perfectly optimizes for its given objective, that objective might not capture what we actually want.

• **Inner Alignment:** Even if we specify the right objective, there's no guarantee that the AI system will internally pursue that objective.

• **Robustness:** AI systems need to behave safely even in novel situations they weren't explicitly trained for.

• **Interpretability:** To verify that an AI system is aligned, we need to understand how it makes decisions.

**Existential Risk Concerns:**
• Loss of control as AI systems become more capable
• Rapid capability gains outpacing safety measures
• Competitive pressures leading to corner-cutting on safety
• Unprecedented concentration of power

**Course Details:**
• Duration: 8 weeks
• Time Commitment: 2-3 hours per week
• Cohort Size: 4-6 participants
• Prerequisites: None required

*"By far the greatest danger of Artificial Intelligence is that people conclude too early that they understand it."* — Eliezer Yudkowsky"""

    def get_collapsed_content(self):
        return self.summary

    def get_expanded_content(self):
        return self.details

    @discord.ui.button(label="▼ Expand", style=discord.ButtonStyle.primary)
    async def toggle_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        self.expanded = not self.expanded

        if self.expanded:
            button.label = "▲ Collapse"
            content = self.get_expanded_content()
        else:
            button.label = "▼ Expand"
            content = self.get_collapsed_content()

        await interaction.response.edit_message(content=content, view=self)


class CoTExpandView(discord.ui.View):
    def __init__(self, full_cot: str):
        super().__init__(timeout=300)
        self.full_cot = full_cot
        self.expanded = False

    @discord.ui.button(label="▼ Show full reasoning", style=discord.ButtonStyle.secondary)
    async def toggle_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        self.expanded = not self.expanded

        if self.expanded:
            button.label = "▲ Hide reasoning"
            # Send full CoT as a file attachment to avoid message length limits
            import io
            file = discord.File(io.StringIO(self.full_cot), filename="chain_of_thought.txt")
            await interaction.response.edit_message(
                content="**Stampy's full reasoning:**",
                attachments=[file],
                view=self
            )
        else:
            button.label = "▼ Show full reasoning"
            # Get last 3 lines for collapsed view
            lines = []
            current_line = ""
            for w in self.full_cot.split():
                if len(current_line) + len(w) + 1 > 60:
                    lines.append(current_line.strip())
                    current_line = w + " "
                else:
                    current_line += w + " "
            if current_line.strip():
                lines.append(current_line.strip())

            await interaction.response.edit_message(
                content=f"**Stampy finished thinking.**\n```\n{chr(10).join(lines[-5:])}\n```",
                attachments=[],
                view=self
            )


async def setup(bot: commands.Bot):
    await bot.add_cog(PingCog(bot))
