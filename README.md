# AI Safety Education Platform

A Discord bot + web platform for automating all the logistics of AI Safety Courses.

## Quick Start

```bash
cd bot
pip install -r requirements.txt
python main.py
```

Make sure you have a `.env` file with your `DISCORD_BOT_TOKEN`.

## Project Structure

```
bot/                         # Discord bot (Python)
├── main.py                  # Bot entry point - add/remove cogs here
├── cogs/                    # Features live here (each file = one feature area)
│   ├── courses.py           # Course creation, weeks, progress tracking
│   ├── enrollment.py        # /signup command and availability selection
│   ├── scheduler.py         # Automatic cohort scheduling algorithm
│   ├── cohorts.py           # Manual cohort creation with /cohort
│   └── ...
├── utils/                   # Shared helper functions
│   ├── data.py              # Load/save user data and courses
│   ├── timezone.py          # UTC <-> local time conversion
│   ├── constants.py         # Day names, timezones
│   ├── cohort_names.py      # Cohort name generator
│   └── ...
├── courses.json             # Course data (created automatically)
└── user_data.json           # User signups (created automatically)

activities/                  # Discord Activities (static HTML/JS, moving to React)
├── facilitator-quiz/        # → /facilitator-quiz/
├── some-other-activity/     # → /some-other-activity/
├── _dev/                    # Local tunnel tooling (gitignored)
└── package.json             # `npm run dev` serves all activities
```

## Hosting

Two Railway services:
- **Bot**: Python Discord bot (`bot/`)
- **Activities**: Static file server (`activities/`) - each subfolder is a route

## How to Add Features

### Adding a new command
1. Open the relevant cog in `bot/cogs/` (or create a new one)
2. Add your command:
   ```python
   @app_commands.command(name="mycommand", description="Does cool stuff")
   async def my_command(self, interaction: discord.Interaction):
       await interaction.response.send_message("Hello!")
   ```
3. Restart the bot - commands sync automatically

### Creating a new cog
1. Create `bot/cogs/my_feature.py`
2. Copy the structure from an existing cog
3. Add it to `COGS` list in `main.py`
4. Restart the bot

### Making something admin-only
Add this decorator above your command:
```python
@app_commands.checks.has_permissions(administrator=True)
```

### Modifying cohort names
Edit `bot/utils/cohort_names.py` - change the `COHORT_NAMES` list to whatever you want.

## Key Commands

**Students:**
- `/signup` - Sign up or edit signup (course, timezone, availability)
- `/list-courses` - See available courses
- `/my-progress` - View course progress

**Admins:**
- `/add-course` - Create a new course
- `/add-week` - Add a week to a course
- `/cohort` - Manually create a cohort from selected members
- `/schedule` - Run automatic cohort scheduling algorithm

## How It Works

1. **Admins** create courses with `/add-course` and add weeks with `/add-week`
2. **Students** sign up with `/signup`, select courses and availability
3. **Admins** either:
   - Use `/schedule` to auto-generate cohorts based on availability
   - Use `/cohort` to manually create cohorts
4. **Cohorts** get private channels and scheduled weekly meetings (one per course week)
5. **Students** complete weeks by reacting ✅, which unlocks the next week
