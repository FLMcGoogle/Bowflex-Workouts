# Bowflex Progress

Mobile-first workout tracker designed for GitHub Pages.

## What v1 does

- Home page shows the last workout and basic consistency stats.
- Today's Exercises defaults to today but supports any chosen date.
- Each exercise carries forward the most recently completed weight for that exercise.
- Change weight in 5 lb increments or type a value directly.
- Check off completed exercises and save the workout.
- Trends page includes:
  - calendar with workout days marked,
  - workouts-per-week chart,
  - selectable weight-progress chart,
  - current / starting / change / personal-best values,
  - tap a workout day to see its exercise details.
- Works with localStorage immediately.
- PWA support for adding to an iPhone/iPad Home Screen.
- Supabase-ready for cloud persistence.

## GitHub Pages deployment

1. Create a GitHub repository.
2. Upload everything in this folder to the repository root.
3. In GitHub: Settings → Pages.
4. Choose "Deploy from a branch".
5. Select `main` and `/ (root)`.
6. Save.
7. Open the generated GitHub Pages URL in Safari.
8. On iPhone/iPad: Share → Add to Home Screen.

## Supabase setup

### 1. Create a Supabase project

Create a new project, then open the SQL Editor and run `supabase.sql`.

### 2. Authentication

The current app only switches to Supabase when a user already has a valid Supabase session. Before cloud sync is fully usable, add a sign-in screen (magic link is recommended).

This repository is deliberately structured so authentication can be added without changing the workout model.

### 3. Configure the app

Edit `config.js`:

```js
window.BOWFLEX_CONFIG = {
  supabaseUrl: "https://YOUR-PROJECT.supabase.co",
  supabaseAnonKey: "YOUR-PUBLIC-ANON-KEY"
};
```

The anon key is intended for client-side use when Row Level Security is configured. Never put a Supabase service-role key into GitHub Pages.

## Data model

`workouts`
- id
- user_id
- workout_date
- notes

`workout_items`
- workout_id
- exercise_name
- weight
- completed

The model can later be expanded with sets, reps, RPE, pain flags, exercise-specific notes, or machine configuration.

## Recommended next version

- Magic-link sign-in
- Cloud/local sync indicator and retry queue
- Edit/delete workout
- Sets and reps
- Personal record notifications
- CSV export
- Optional exercise notes
- Better chart filtering (1 month / 3 months / 1 year / all)
