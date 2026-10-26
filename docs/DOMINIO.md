# Setting up pokesurvivor.com

The domain was purchased through **Cloudflare** and does not point to a site yet.
The code is ready: only the steps marked **YOU** (which require your account)
and the final step, which I will do when you say so, remain.

Status as of 2026-10-10:

- [x] Domain purchased through Cloudflare (Cloudflare DNS servers active).
- [x] `pokesurvivor.com` and `www.pokesurvivor.com` added to Firebase → authorized
      domains (Google sign-in will work from day one).
- [x] Spanish and English pages, sitemap, robots, 404, and share image generated
      and tested (Lighthouse: SEO 100, accessibility 100).
- [x] Final-step script tested: `tools/activar_dominio.sh`.
- [x] Step 1 · Cloudflare DNS (**YOU**)
- [x] Step 2 · Verify the domain with GitHub (**YOU**, recommended)
- [x] Step 3 · Final step (**ME**): completed on 2026-10-10, with HTTPS
- [ ] Step 4 · Google Search Console and Bing (**YOU**)

---

## Step 1 · Cloudflare DNS (YOU, 5 minutes)

1. Go to <https://dash.cloudflare.com> → choose **pokesurvivor.com** →
   left-hand menu **DNS → Records**.
2. Click **Add record** and create these 9 records. For each one, set
   **Proxy status** to **DNS only** (the cloud must be **gray**, not orange).

   | Type | Name | IPv4 / IPv6 / Target |
   |---|---|---|
   | A | `@` | `185.199.108.153` |
   | A | `@` | `185.199.109.153` |
   | A | `@` | `185.199.110.153` |
   | A | `@` | `185.199.111.153` |
   | AAAA | `@` | `2606:50c0:8000::153` |
   | AAAA | `@` | `2606:50c0:8001::153` |
   | AAAA | `@` | `2606:50c0:8002::153` |
   | AAAA | `@` | `2606:50c0:8003::153` |
   | CNAME | `www` | `jpter78.github.io` |

   These are the GitHub Pages addresses where the game is hosted.

> **Why a gray cloud:** with the orange cloud, Cloudflare sits in the middle and
> GitHub cannot issue the HTTPS certificate (the padlock). Cloudflare's
> "Flexible" SSL mode also creates a redirect loop. With gray, everything works
> immediately; the orange cloud can be enabled later with SSL **Full (strict)**
> if desired, but it is not necessary.

Optional and free in the same dashboard:
- **DNSSEC** (DNS → Settings → Enable DNSSEC): protects the domain from spoofing.
- **Email Routing**: forwards `contacto@pokesurvivor.com` to your Gmail if you
  want an address using the game's name.

When this is done, tell me **"DNS is ready"** and I will check that it is visible
externally (usually takes 5 minutes to 1 hour).

## Step 2 · Verify the domain with GitHub (YOU, recommended, 3 minutes)

Protect the domain so another GitHub account cannot use pokesurvivor.com.

1. Go to <https://github.com/settings/pages> (signed in as JPTER78).
2. **Add a domain** → enter `pokesurvivor.com` → **Add domain**.
3. GitHub displays a **TXT** record: a name such as
   `_github-pages-challenge-JPTER78` and a long value.
4. In Cloudflare → DNS → Records → **Add record**: Type **TXT**, Name as given
   by GitHub (without `.pokesurvivor.com` at the end), Content set to the long value.
5. Return to GitHub and click **Verify**. If it fails, wait a few minutes and try again.

## Step 3 · Final step (ME)

Once DNS works, I will:

1. Run `bash tools/activar_dominio.sh`: build the game with SEO, regenerate the
   pages, create the `CNAME` file, and prepare the commit (checking that no
   private data is included).
2. Push it to GitHub and set `pokesurvivor.com` as the domain in GitHub Pages.
3. Wait for GitHub to issue the certificate and enable **Enforce HTTPS**.
4. Check in a real browser: the site, `www.` → without `www`, the old github.io
   address → the new one, English at `/en/`, account and Google sign-in, ranking,
   and co-op.
5. Set `https://pokesurvivor.com` as the repository website on GitHub.

**Note about guest saves:** these are stored in the browser and tied to the
address. A guest playing at `jpter78.github.io` will not see that save at
`pokesurvivor.com` (registered accounts will, because they use the cloud). If
anyone asks, advise them to create an account before the switch.

## Step 4 · Google Search Console and Bing (YOU, after Step 3)

1. Go to <https://search.google.com/search-console> → **Add property** →
   **Domain** → `pokesurvivor.com`.
2. Since the domain is on Cloudflare, Google offers automatic verification
   **through Cloudflare**: accept it. Otherwise, Google provides a TXT record to
   add as in Step 2.
3. **Sitemaps** → enter `sitemap.xml` → **Submit**.
4. **URL Inspection** → `https://pokesurvivor.com/` → **Request indexing**.
   Repeat for `https://pokesurvivor.com/en/`, `https://pokesurvivor.com/guia/`,
   and `https://pokesurvivor.com/pokedex/`.
5. Bing (and with it DuckDuckGo and Ecosia): go to
   <https://www.bing.com/webmasters> → **Import from Google Search Console**.

Google may take a few days to a couple of weeks to start showing the site.

## Afterward

- Update the link in the YouTube trailer description, on Ko-fi, and anywhere else
  you shared it.
- The most helpful next steps for ranking are in [SEO.md](SEO.md), section 3
  (links from YouTube, itch.io, Reddit, Discord, and elsewhere).
