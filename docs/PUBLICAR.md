# Publish the game for free on GitHub Pages

The game is a static website: GitHub Pages hosts it for free at
`https://jpter78.github.io/pokesurvivor/`.

## 1. Create the repository (once)

1. Go to <https://github.com/new> using the **JPTER78** account.
2. Name: `pokesurvivor` · **Public** · do not add a README, .gitignore, or
   license (they are already included in the project).
3. Create the repository.

## 2. Push the project

From the project directory (the local repository has already been created and
has its initial commit):

```
git remote add origin https://github.com/JPTER78/pokesurvivor.git
git push -u origin main
```

The first time, a window opens for signing in to GitHub.
The project is about 75 MB, so this may take a few minutes.

## 3. Enable GitHub Pages

In the repository, go to **Settings → Pages** →
*Source*: **Deploy from a branch** → *Branch*: **main**, folder **/ (root)** → **Save**.

It will be available at <https://jpter78.github.io/pokesurvivor/> within a minute or two.

## 4. Connect Firebase

If you have followed [FIREBASE.md](FIREBASE.md), add `jpter78.github.io` to the
Authentication **authorized domains** (Step 5) and push the completed
`firebase-config.js`:

```
git add js/core/firebase-config.js
git commit -m "Connect Firebase"
git push
```

## 5. Get the site listed by Google

1. Go to <https://search.google.com/search-console> → **Add property** →
   *URL prefix* → `https://jpter78.github.io/pokesurvivor/`.
2. For verification, the **HTML tag** method provides a `<meta ...>` line;
   paste it inside `<head>` in `index.html`, push the change, then click Verify.
3. **URL Inspection** → paste the address → **Request indexing**.

Google may take days or weeks to show the site, and at first it may appear only
when searching for its exact name.

## Update the game later

Whenever you change something:

```
git add -A
git commit -m "Describe your change"
git push
```

GitHub Pages updates automatically within a minute or two.

## Reminders

- **Do not monetize it**: no ads, donations in exchange for anything, or
  payments. The sprite license (CC BY-NC) requires this, and it greatly reduces
  the risk of Nintendo requesting removal.
- If a copyright complaint arrives at the legal-notice email address, respond
  promptly: removing the requested material usually resolves the issue.
