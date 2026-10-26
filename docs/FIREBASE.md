# Configure Firebase (database and accounts)

This lets game saves sync to the cloud and be continued on any computer. It is
all **free** (Firebase Spark plan) and takes about 10 minutes.

Until this is configured, the game works as before, saving only in the browser.

## 1. Create the project

1. Go to <https://console.firebase.google.com> using your Google account.
2. **Create a project** → choose a name (for example, `pokesurvivor`). The
   project ID is shown in the "Sign in with Google" window and cannot be changed later.
3. Google Analytics: **disable it** (it is not needed, and this avoids tracking).

## 2. Enable accounts

1. Left-hand menu → **Build → Authentication** → **Get started**.
2. **Sign-in method** tab:
   - **Email/Password** → Enable → Save.
     (The game uses a username and password; internally, these are converted to
     an internal email address that is never sent anywhere.)
   - **Google** → Enable → select your support email → Save.

## 3. Create the database

1. **Build → Firestore Database** → **Create database**.
2. Location: choose one in Europe (for example, `eur3` or `europe-southwest1`).
   This cannot be changed later.
3. Start in **production mode**.
4. **Rules** tab: remove the existing content, paste the full contents of this
   project's [`firestore.rules`](../firestore.rules), and click **Publish**.

   These rules ensure that each player can only read, write, and delete **their
   own** save. Without them, anyone could modify other players' saves.

### 3b. Realtime Database (rooms and multiplayer)

1. **Build → Realtime Database** → **Create database** → location
   **Belgium (europe-west1)** → locked mode.
2. **Rules** tab: paste the contents of [`database.rules.json`](../database.rules.json).
3. Copy the URL shown at the top (`https://...firebasedatabase.app`) and add it
   to `firebase-config.js` as `databaseURL: '...'`.

Alternatively, use the Firebase CLI to deploy both database rules and the
leaderboard indexes at once:

```
npx firebase-tools deploy --only firestore,database --project YOUR-PROJECT
```

## 4. Connect the game

1. At the top left, click the gear ⚙ → **Project settings**.
2. At the bottom, under **Your apps**, click the web icon **`</>`**.
3. Enter a nickname (for example, `web`). Do **not** select Firebase Hosting.
   → Register app.
4. Firebase shows a `const firebaseConfig = { ... }` block. Copy the contents
   between the braces.
5. Open [`js/core/firebase-config.js`](../js/core/firebase-config.js) and replace
   `G.FIREBASE_CONFIG = null;` with:

   ```js
   G.FIREBASE_CONFIG = {
     apiKey: '...',
     authDomain: '...firebaseapp.com',
     projectId: '...',
     storageBucket: '...',
     messagingSenderId: '...',
     appId: '...'
   };
   ```

   This data is **not secret**: Firebase expects it to be included in the web
   app. The rules from Step 3 protect the saves.

## 5. Authorize the published site

Go to **Authentication → Settings → Authorized domains → Add domain**:

- `jpter78.github.io` (if publishing on GitHub Pages)
- `localhost`, for local testing (not included by default in new projects)

Without this, "Sign in with Google" reports an *unauthorized domain* error.

## 6. Recommended: restrict the API key

At <https://console.cloud.google.com/apis/credentials> (same project), open
the **Browser key** → *Application restrictions* → *Websites* and add:

- `https://jpter78.github.io/*`
- `http://localhost:*`

This prevents other websites from using your key.

## Test locally

The cloud works only when the game is served from a web server (not opened with
a double-click):

```
python -m http.server 8000
```

Then open <http://localhost:8000>. The start screen should show the **Sign in
with Google** button and the text *"Your save is stored in the cloud."* A small
**green** square at the top right, next to your name, indicates that the save is
in the cloud (yellow = saving, red = offline).

## Free-plan limits

Firestore: about 50,000 reads and 20,000 writes per day and 1 GB of data.
The game is designed to minimize usage (measured in the emulator):

| Action | Reads | Writes |
|---|---|---|
| View a leaderboard tab | 1 (0 if viewed within the last 10 minutes) | 0 |
| View your rank if you are not in the top 50 | 1 the first time in that browser | 0 |
| Finish a run | ~3 | ~3–9 (only when improvements are made) |
| Save the game | At most 1 every 30 seconds | At most 1 every 30 seconds |
| Stay connected | 0 | 1 every 10 minutes (the "online" status) |
| Open Friends or the lobby | 1 per friend (valid for 1 minute) | 0 |

How this is achieved:
- **Leaderboard**: each table has a summary document `lbs/{table}` with the
  top 50 (the rules check each row against a score validated against cheating
  in `lb/{table}/e/{id}`). Results are cached in the browser for 10 minutes.
  Filtering by Pokémon is available only in history.
- **Saves**: the browser copy is saved immediately; pending changes are uploaded
  to the cloud at most every 30 seconds and whenever the tab is hidden or closed.
  If you play on two computers at once, saves are merged on sign-in and upload.
- **Public profile**: uploaded at most once every 10 minutes after a run.

Realtime Database: **100 simultaneous connections** and 10 GB of downloads per
month. Only players **in a room or group run** connect to it ("online" status
and invitations use Firestore), so the 100-connection limit counts only people
currently playing in a group, not all players. Group games connect directly
between browsers and use no database bandwidth; only games that cannot connect
directly use the relay (about 20–70 MB per hour per player). If the free limit
is exceeded, Firebase simply rejects operations until the next day; it does not
charge unless you enable a paid plan.

## For developers: emulator

To test without touching the real project (Java 21 required):

```
npx firebase-tools emulators:start --project demo-ps --only auth,firestore,database
```

Then, in `firebase-config.js`, use:

```js
{ apiKey: 'demo', projectId: 'demo-ps', authDomain: 'demo-ps.firebaseapp.com', appId: 'demo', databaseURL: 'http://127.0.0.1:9000?ns=demo-ps-default-rtdb', emulator: true }
```
