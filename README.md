# Family Archive

A private family history website, so our family never forgets who we are and where we come from.

- **The site:** https://lokodayte.github.io/family-archive/
- **The admin panel:** https://lokodayte.github.io/family-archive/admin/

You manage everything from the admin panel in your browser. You never need to edit code.

---

## Contents

1. [How it works](#how-it-works)
2. [First-time setup](#first-time-setup)
3. [Adding a person](#adding-a-person)
4. [Family links: parents, spouses, children](#family-links)
5. [Dates that aren't exact](#dates)
6. [Public or family-only?](#privacy)
7. [Saving and publishing](#saving)
8. [Changing the family password](#password)
9. [Backups: keep your originals safe](#backups)
10. [If something breaks](#if-something-breaks)
11. [Practising without changing anything](#practice)
12. [What's coming next](#coming-next)

---

<a id="how-it-works"></a>
## 1. How it works

- Everything (people, family links, and later photos) is stored as files in this GitHub repository. There is no database or server to pay for.
- When you click **Save & publish** in the admin panel, your browser sends the changes to GitHub. GitHub then runs automatic **safety checks**. If the checks pass, the website updates about a minute later.
- **Family-only information is locked (encrypted) inside your browser before it is sent.** GitHub only ever stores scrambled data. Visitors unlock it on their own device with the **family password**.
- The repository is public, so anyone could look at the files. Public people can be read there. Family-only people show up as unreadable scrambled text.
- Search engines are asked not to list the site.

<a id="first-time-setup"></a>
## 2. First-time setup

### a) Make a GitHub access token (once a year)

The admin panel needs a key from GitHub, called a *token*, that allows it to save changes to **this repository only**.

1. Sign in to GitHub, then open **[New fine-grained token](https://github.com/settings/personal-access-tokens/new?name=Family+archive+admin&expires_in=366&contents=write&actions=read)**.
   (Or click your profile photo → **Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.)
2. **Token name:** `Family archive admin`. **Expiration:** 1 year. Put a reminder in your calendar to make a new token before it expires.
3. **Repository access:** choose **Only select repositories**, then pick **family-archive**.
4. **Permissions → Repository permissions:**
   - **Contents:** Read and write
   - **Actions:** Read-only (lets the admin panel show "Live on the site")
   - **Metadata:** Read-only (GitHub adds this automatically)
   - Leave everything else as *No access*.
5. Click **Generate token**. Copy the token, which starts with `github_pat_`. GitHub shows it only once.
6. Open the admin panel and paste the token. It is saved **only in that browser**. Do this once on each device you use.

> Keep the token secret, like a password. If you think it has leaked, delete it on GitHub (same page as above) and make a new one.

### b) Replace the sample family

The archive starts with a **made-up sample family** (the "Sampleyans") so you can try things out. The sample family password is in the setup message you received.

When you're ready to add real people:
1. In the admin panel, go to **Settings → Family password**. Set your own family password and tick **Full re-lock**. This is cheap now because there's almost nothing stored yet.
2. Delete the sample people: open each one and click **Delete person**, then **Save & publish**.
3. In **Settings**, set the **Archive title** and your **email for corrections**.

<a id="adding-a-person"></a>
## 3. Adding a person

1. Admin panel → **People** → **+ Add a person**.
2. **Basics:** living or deceased, sex, and who can see them (see [privacy](#privacy)).
   Tick **Unknown person (placeholder)** for someone who must exist but isn't known yet (for example "great-grandfather's first wife"). The gap then shows up in the tree.
3. **Names:** fill in whichever alphabets you know: Latin, Armenian, Cyrillic. Include the patronymic and maiden name if known. Nicknames go in one box, separated by commas.
4. **Birth and death:** dates can be vague (see [dates](#dates)). Places are plain text for now, such as "Kars, Russian Empire".
5. **Family links:** see below.
6. **Life:** occupation, education, languages, biography. Stories, life events (moves, military service…) and sources each have an **+ Add** button.
7. Click **Keep these changes**. Repeat for other people, then click **Save & publish** at the top.

**Sources:** for each important fact, note where it came from ("Aunt Lilit's memory, 2025", "birth certificate") and how sure you are. Future relatives will thank you.

<a id="family-links"></a>
## 4. Family links: parents, spouses, children

In a person's **Family links** section, start typing a name in **Add a parent / spouse / child** and pick from the list. If the person isn't in the archive yet, choose **Create a new person** (you can fill in their details later) or **Add an unknown person (placeholder)**.

- Parents can be *birth*, *adoptive*, *step* or *foster*.
- Several marriages are fine. Each one can have a date, a place and how it ended.
- **Brothers, sisters and half-siblings are worked out automatically.** Never add them directly; link both siblings to their parents instead.
- The archive refuses impossible links, such as someone becoming their own grandparent.

<a id="dates"></a>
## 5. Dates that aren't exact

Type dates the way you'd say them. The admin panel shows ✓ with how it understood the date, or ✗ if it couldn't:

| You type | Means |
|---|---|
| `1920`, `May 1920`, `3 May 1920`, `03.05.1920` | exact (as precise as you know) |
| `about 1920`, `c. 1920`, `~1920` | approximately |
| `between 1918 and 1921`, `1918-1921` | somewhere in that range |
| `before 1930` / `after 1945` | not later / not earlier than |
| `unknown` or `?` | we don't know |

<a id="privacy"></a>
## 6. Public or family-only?

| | Who can read it |
|---|---|
| **Family only** (the default) | Only people who enter the family password. It's encrypted before it leaves your browser. |
| **Public** | Anyone who finds the site or the repository. |

- **Living people are always family-only**, even if you choose Public.
- **Anything that was ever public stays in the history forever**, even if you switch it back to family-only later. When in doubt, choose family-only.
- A family link between a public person and a family-only person is itself family-only.

<a id="saving"></a>
## 7. Saving and publishing

- **Keep these changes** adds an edit to your list. Nothing is sent yet. The top bar shows "3 unsaved changes".
- **Save & publish** sends all kept edits to GitHub **together, as one change**.
- The top bar then shows **Saving… → Saved. Live in about a minute… → ✓ Live on the site**.
- If you close the page with unsaved changes, your browser will warn you.
- Right after an update, a visitor's browser may show the old version for a few minutes. Refreshing the page fixes that.

<a id="password"></a>
## 8. Changing the family password

Admin panel → **Settings → Family password**:
- **Normal change:** instant, uses no extra storage. Tell relatives the new password.
- **Full re-lock:** only if you think the *old* password reached someone it shouldn't have. It re-encrypts every family file, which uses extra storage (a lot, once there are many photos).

> ⚠️ **Write the family password down somewhere safe.** If it's lost, family-only information cannot be recovered by anyone, including GitHub.

<a id="backups"></a>
## 9. Backups: keep your originals safe

- **Every change is kept in the history.** GitHub stores every version of every file, so mistakes can be undone. (An undo button is coming in Phase 4.)
- **Download a copy:** on the repository's GitHub page, click **Code → Download ZIP**. (A "Download full backup" button that includes readable family data is coming in Phase 4.)
- **Keep full-resolution originals of photos and scans outside the site:** for example on an external drive *and* in a cloud folder. The archive will store smaller, web-friendly copies to stay within GitHub's ~1 GB limit.
- Keep the family password and a note about where the originals are in a safe place, such as a sealed envelope with important papers.

<a id="if-something-breaks"></a>
## 10. If something breaks

| Problem | What to do |
|---|---|
| Admin says **"Saved, but the site was not updated"** | Your data **is** saved. A safety check failed, so the site kept the last good version. Open the repository's **Actions** tab on GitHub, click the red ✗ run to see which check failed, and ask for help. |
| Admin asks for the token again | It probably expired. Make a new one ([step 2a](#first-time-setup)). |
| "That family password is not right" | Check spelling and capital letters. If the password was changed, ask for the new one. |
| The site looks old after saving | Wait a minute, then refresh the page. |
| Something is wrong with the data | Every earlier version is in the history (**Commits** on the repository page). Nothing is ever truly lost. Ask for help restoring it. |
| Storage warning (70%) | See [backups](#backups). Old versions of replaced photos count too, so avoid uploading the same big file repeatedly. |

<a id="practice"></a>
## 11. Practising without changing anything (for helpers)

On a computer with this repository downloaded:

```bash
npm test                 # run the safety checks
npm run serve            # then open http://localhost:8080/admin/?practice
```

Practice mode works like the real admin panel but never sends anything to GitHub.

<a id="coming-next"></a>
## 12. What's coming next

- **Phase 2:** photos and scanned documents: drag-and-drop upload, automatic resizing, tagging people by clicking on faces, and a gallery.
- **Phase 3:** places with historical names, migrations, a map with family journeys, and a timeline slider.
- **Phase 4:** a recent-changes page with undo, a full backup ZIP, GEDCOM import and export, a fuller tree, "How are we related?", and more mobile polish.

---

### For developers

Plain HTML, CSS and JavaScript modules with no build step and no dependencies. The `site/` folder is published. Core logic lives in `site/assets/js/lib/` and is tested with Node's built-in test runner (`tests/`). See `site/assets/js/lib/model.js` for the data files and `crypto.js` for the encryption design (AES-256-GCM, PBKDF2-SHA256 with 600,000 rounds, gzip before encryption). Interface text goes through `t()` in `lib/i18n.js`. To add a language, create `site/i18n/hy.json` or `ru.json` mapping each English phrase to its translation.
