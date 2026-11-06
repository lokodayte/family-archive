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
   - [Photos and scanned documents](#photos)
   - [Places, moves and the map](#places)
   - [The family tree and "How are we related?"](#tree)
   - [History and undo](#history)
6. [Public or family-only?](#privacy)
7. [Saving and publishing](#saving)
8. [Changing the family password](#password)
9. [Backups: keep your originals safe](#backups)
10. [If something breaks](#if-something-breaks)
11. [Practising without changing anything](#practice)
12. [Ideas for later](#coming-next)

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
   ⚠️ Don't leave it on the default, **"Public repositories"**: that kind of token can only *read*, and saving fails with *"Resource not accessible by personal access token"*.
4. **Permissions → Repository permissions:**
   - **Contents:** Read and write
   - **Actions:** Read-only (lets the admin panel show "Live on the site")
   - **Metadata:** Read-only (GitHub adds this automatically)
   - Leave everything else as *No access*.
5. Click **Generate token**. Copy the token, which starts with `github_pat_`. GitHub shows it only once.
6. Open the admin panel and paste the token. It is saved **only in that browser**. Do this once on each device you use.

> Keep the token secret, like a password. If you think it has leaked, delete it on GitHub (same page as above) and make a new one.

### b) Choose the family password (first visit only)

The archive starts empty. The first time you unlock the admin panel, it asks you to **choose a family password**. This password locks all family-only information.
- A few random words work well: easy to remember, hard to guess. Use at least 10 characters.
- **Write it down somewhere safe.** If it's lost, family-only information can't be recovered by anyone.
- Share it only with relatives who should see everything.

Then, in **Settings**, set the **Archive title** (for example "The Petrosyan Family Archive") and your **email for corrections**, and click **Save & publish**.

> Want to practise first? See [section 11](#practice): practice mode never saves anything.

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

<a id="photos"></a>
## 5b. Photos and scanned documents

### Uploading
1. Admin panel → **Photos**.
2. Choose **Photos** or **Scanned documents** (scans are kept a little sharper so text stays readable).
3. Drag files onto the dotted box, or click it to choose. You can pick many at once; **up to about 40 at a time** works best.
4. Each image is automatically made smaller (about 2000 pixels and 300 KB) with a small thumbnail, and **hidden location (GPS) data is removed**. New photos start as **Family only**.
5. A box then asks what the batch has in common (approximate date, place, privacy). Fill it in or skip it.
6. Click **Save & publish**. The top bar shows "Uploading images: 3 of 20…". If GitHub asks us to slow down, it waits and continues by itself. Keep the page open until it finishes.

> 📦 **Keep your full-size originals elsewhere.** The archive stores smaller copies. Put the originals on an external drive *and* in a cloud folder.

iPhone photos in HEIC format may not open in every browser. If one is refused, export it as JPEG ("Most Compatible") first.

### Describing a photo and tagging people
Click a photo in **Photos** to open it:
- **Tag people:** click on someone's face, start typing their name, and pick them. Unknown faces can become a new person or an "unknown person" placeholder.
- **Use as profile photo:** in "People in this photo", click this next to a name. The profile picture is centred on that person's face. You can also choose a profile photo on the person's own page.
- Add a **title**, **approximate date**, **place**, **description** and **the story behind it**.
- **Rotate**, **Replace image** (for example with a better scan) or **Download** the stored copy.
- Click **Keep these changes**, then **Save & publish**.

### Who can see photos
- New photos are **Family only** (encrypted).
- A photo can be **Public** only if *everyone tagged in it* is public. If it shows a living or family-only person, it **stays family-only automatically**, even if you chose Public. The editor tells you why.
- If you later make a person family-only, their public photos move to encrypted storage by themselves.

### Storage
- Replacing, rotating or deleting a saved photo does **not** free space: the old version stays in the history. The admin panel warns you before replacing.
- About 300 KB per photo means roughly **2,500–3,000 photos** fit in the ~1 GB limit. The storage meter warns you at 70%.

### On the website
- **Gallery:** filter by person, place, decade, or photos versus documents. More photos load as you scroll.
- Click a photo to see it large, with names on the faces, its story and the people in it. ← → keys move between photos.
- Each profile shows the person's photo and all the photos they're tagged in.

<a id="places"></a>
## 5c. Places, moves and the map

### Places: saved once, used everywhere
Every town or village is saved **once** (admin → **Places**) and then picked wherever a place is needed: birth, death, marriage, life events, photos, moves.
- **Add a place:** **Places → + Add a place**, then type the name in **Search the world map** and pick the right result. The pin, name and country are filled in for you. You can drag the pin, or click the map, for villages that no longer exist.
- **Older names:** for example Gyumri was *Alexandropol* (until 1923) and *Leninakan* (1924–1990). Add these with their years, and the site shows the right name for each date.
- **Country over time:** for example *Russian Empire (to 1917)*, *First Republic of Armenia (1918–1920)*, *Soviet Union (1921–1991)*, *Armenia (from 1992)*. Leave "to" empty for today.
- **Picking a place on a form:** start typing (old names work too) and choose it from the list. If it isn't saved yet, choose **Save "…" as a new place** and add its map location later. The Places page lists places that still need one. You can also keep plain text, but plain-text places don't appear on the map.

### Moves (migrations)
Admin → **Moves → + Add a move** (or **+ Add a move for this person** on someone's page):
- **Who moved:** add everyone who travelled together.
- **From / To / When / Why:** war, work, marriage, study, forced displacement, refugees, and so on.
- **The story:** how they travelled, what they took, who helped.

A move is public only if everyone in it is public, and the same goes for places. A place only becomes public if something public needs it.

### The map (on the website)
- **Journeys:** each move is an arrow, coloured by **family branch** (the person's birth surname). Click an arrow for the story, or a place for everyone connected to it.
- **Where everyone lived:** move the year slider, or press **▶ Play**, to see where everyone was in that year. Click a circle to see who was there and how old they were.
- **Show:** follow one person's journeys.
- Every place has its own page: its old names and countries, everyone born, married, living or dying there, and photos taken there.
- Profiles now show historical names, for example *born in Kars, Russian Empire*, and moves appear in the life timeline.

The background map comes from **OpenStreetMap** (free, no account). Viewing the map loads map tiles from OpenStreetMap's servers, as any online map does.

<a id="tree"></a>
## 5d. The family tree and "How are we related?"

- **Tree → Show:** *Ancestors and descendants*, *Ancestors only* or *Descendants only*. You can choose how many generations to show.
- The round **▲ / ▼** buttons on a box open that branch even beyond the generation limit. The faint **–** button folds a branch away. Click any person to put them in the centre.
- Very large trees stay fast: only the part you're looking at is drawn.
- **How are we related?** (on the home page, on every profile and under the tree): choose two people. The answer is a sentence such as *"Lusine is Davit's half-great-aunt"*, with their closest common ancestor and the chain of family links step by step. It handles cousins (*second cousin once removed*), half relations, in-laws, step-parents and spouses.

<a id="history"></a>
## 5e. History and undo

Admin → **History** lists every saved change, newest first, with what changed. Family-only names are shown here because the details are stored encrypted.
- **↶ Undo** puts back what that change altered. If something has been changed again since, it is left as it is now, and you're told what was skipped.
- An undo is saved as a new change, so you can undo an undo.
- "Website update" entries are changes to how the site works, not to your data, so they can't be undone here.
- Changes from before a **full re-lock** of the family password can't be undone automatically.

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

- **Every change is kept in the history.** Mistakes can be undone from admin → **History**.
- **Download a full backup:** admin → **Backup → With photos**. You get one ZIP file containing:
  - `archive.json`: everything, in readable form
  - `family.ged`: the tree for other genealogy programs
  - `people.txt`: a simple list of everyone
  - `photos/`: every photo, named by year, title and people

  ⚠️ The backup is **not encrypted** (it contains family-only information), so keep it somewhere private. Make one a few times a year; the admin panel reminds you after 90 days.
- **GEDCOM:** admin → **Backup → Export GEDCOM file** to move the tree to Gramps, MyHeritage, Ancestry, RootsMagic and similar programs. **Import a GEDCOM file…** adds people from such a program (everyone comes in as family-only, and likely duplicates are pointed out first).
- **An exact encrypted copy:** the "download the repository ZIP" link on the Backup page.
- **Keep full-resolution originals of photos and scans outside the site:** for example on an external drive *and* in a cloud folder. The archive stores smaller, web-friendly copies to stay within GitHub's ~1 GB limit.
- Keep the family password and a note about where the originals are in a safe place, such as a sealed envelope with important papers.

<a id="if-something-breaks"></a>
## 10. If something breaks

| Problem | What to do |
|---|---|
| Admin says **"Saved, but the site was not updated"** | Your data **is** saved. A safety check failed, so the site kept the last good version. Open the repository's **Actions** tab on GitHub, click the red ✗ run to see which check failed, and ask for help. |
| Admin asks for the token again | It probably expired. Make a new one ([step 2a](#first-time-setup)). |
| *"Resource not accessible by personal access token"* or *"This token can read the archive but is not allowed to save"* | The token is read-only. On GitHub → Settings → Developer settings → Fine-grained tokens, click the token → **Edit**. Set Repository access to **Only select repositories → family-archive**, and **Contents: Read and write**, **Actions: Read-only**. Click **Update**. The same token then works; no need to paste it again. |
| "That family password is not right" | Check spelling and capital letters. If the password was changed, ask for the new one. |
| The site looks old after saving | Wait a minute, then refresh the page. |
| Something is wrong with the data | Admin → **History** → **Undo** on the change that caused it. Every earlier version is kept, so nothing is ever truly lost. |
| A photo is refused when uploading | It's probably an iPhone HEIC or an unusual format. Export it as JPEG and try again. |
| Saving stops at "GitHub asked us to slow down" | That's normal for big batches. Keep the page open; it carries on by itself. |
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
## 12. Ideas for later

- Armenian and Russian versions of the interface. Everything is ready for translation files (see "For developers").
- Merging two people who turn out to be the same person (for example after a GEDCOM import).
- Printable family-tree posters and family-group sheets.

---

### For developers

Plain HTML, CSS and JavaScript modules with no build step and no dependencies. The `site/` folder is published. Core logic lives in `site/assets/js/lib/` and is tested with Node's built-in test runner (`tests/`). See `site/assets/js/lib/model.js` for the data files and `crypto.js` for the encryption design (AES-256-GCM, PBKDF2-SHA256 with 600,000 rounds, gzip before encryption). Interface text goes through `t()` in `lib/i18n.js`. To add a language, create `site/i18n/hy.json` or `ru.json` mapping each English phrase to its translation.
