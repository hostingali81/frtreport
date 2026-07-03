# FRT Calling App — Project Plan & Technical Design

> **Goal:** Ek app (PWA) jisse control-room operator **live active electricity complaints** dekh sake,
> consumer ko **ek-tap call** kar sake, aur call ke baad **"asli problem kya thi" + call ka result**
> record kar sake — taaki official system se alag, apna clean operational data/report ban sake.
>
> **Owner login:** `CONTROL_ROOM_BARABANKI` (FRT Barabanki — UPPCL fault-repair system)
> **Base site:** `https://www.frtbarabanki.com`
> **Doc banaya:** 2026-07-02

---

## 0. TL;DR (ek line me)

Server-side pe (Puppeteer se) FRT me login karke session capture karo → us session se **live list API
(FormId 13339)** aur **detail API (FormId 13340)** ko hit karke apne Supabase me daalo → PWA sirf
apne Supabase se padhe, tap-to-call kare, aur call ke notes `call_logs` me save kare. Login/token ki
tension kabhi client (phone) pe nahi aayegi.

---

## 1. Yeh FRT system kaise kaam karta hai (reverse-engineered)

Site ek "AppSavy" naam ke low-code/form engine pe bani hai. Har screen ek **FormId** hai, aur data
`POST /api/AppsavyServices/GetRelationalDataA` se aata hai jisme body me **base64-encoded XML**
(`inputxml`) jaata hai. XML batata hai "kaunsa Form, kaunsa Control, kaunsa Event".

### 1.1 Teen relevant Forms

| Form | FormId | Kaam | Isme use? |
|------|--------|------|-----------|
| **Live complaints grid** | `13339` | Active complaints ki list (jo abhi FRT ko assign/pending hain) | ✅ Primary (list) |
| **Complaint detail dialog** | `13340` | Ek complaint pe click karne pe consumer ka naam/number/pata | ✅ Primary (detail) |
| **History/MIS report** | `13345` | Purani closed complaints ka report (Division, Closed Date, Closing Remarks…) | ❌ (yeh purane report project me use hota hai, calling ke liye nahi) |

> **Important:** Purana `my-scraping-project` sirf **FormId 13345** (history report) scrape karta hai.
> Isliye usme purani/closed complaints hain aur live workflow status (`FRT Assigned`,
> `Acknowledged by FRT`, `In Progress`, `Activity Completed`) **nahi** hai. Live calling ke liye
> humein 13339/13340 chahiye hi chahiye — ye is naye app ka core hai.

### 1.2 List API (FormId 13339) — decoded request

`POST /api/AppsavyServices/GetRelationalDataA`, body: `{"inputxml":"<base64>","DocVersion":1}`

Decoded `inputxml`:
```xml
<?xml version="1.0"?>
<Request VERSION="2" LANGUAGE_ID="" LOCATION="">
  <Company Company_Id="1" />
  <Project Project_Id="339" />
  <User User_Id="CONTROL_ROOM_BARABANKI" />
  <IUVLogin IUVLogin_Id="9311912726" />
  <ROLE ROLE_ID="1882" />
  <Event Control_Id="143630" />
  <Child Control_Id="143649" Report="HTML" AC_ID="196143"></Child>
</Request>
```

**Response fields (har `<Rowset>`):**
`DATAID`, `COMPLAINTS` (complaint no.), `FAULT_ID`, `COMPLAINT_TYPE`, `COMPLAINT_SUB_TYPE`,
`DISTRICT`, `AREA`, `AREA_TYPE`, `FEEDER`, `ACTION` (= live status), `COMPLAINT_DATE`.

`ACTION` ki observed values: `FRT Assigned`, `Acknowledged by FRT`, `In Progress`,
`Activity Completed`, aur kabhi khaali (`""`).

### 1.3 Detail API (FormId 13340) — decoded request

Same endpoint, alag `inputxml`. Ek complaint ka `DATAID` (list se mila) yahan
`Parent Control_Id="143655" Value="<DATAID>"` me bhejte hain. Request ek saath **kai `Child`
controls** maangta hai — har `Child` ek field return karta hai.

Kaam ke fields (Child `Control_Id` → response field):

| Child Control_Id | AC_ID | Response field | Matlab |
|---|---|---|---|
| 143610 | 195998 | `CONSUMER_NAME` | Consumer ka naam |
| 143608 | 195997 | `MOBILENO` | **Consumer ka mobile (call yahin karni hai)** |
| 143704 | 196047 | `ADDRESS` | Pata |
| 143705 | 196048 | `LANDMARK` | Landmark |
| 143703 | 196049 | `REMARKS` | e.g. "Registered through IVRS." |
| 143905 | 196663 | `SUBSTATION` | 33/11 KV … |
| 143601 | 196001 | `CREW_NAME` | Assigned FRT crew |
| 143609 | 196000 | `MOBILE` | Crew/FRT ka mobile |
| 143602 | 196205 | `COMPLAIN_NAME` | Complaint type |
| 143779 | 196207 | `COMPLAIN_SUB_NAME` | Sub-type |
| 143698 | 196142 | crew list | Saare FRT crews (dropdown) — DATA_ID + CREW_NAME |
| 143627 | 196210 | action list | Close / Map Existing Fault / Create New Fault / Change FRT |

> **Note:** Detail API me koi field nahi hai jaha "consumer se baat hui, ye problem batayi" likha ja
> sake. Yehi gap humara app bharega (`call_logs`). Official system sirf crew-assignment track karta hai.

### 1.4 Login flow

1. `GET /auth/challenge` → ek challenge deta hai.
2. `POST /UserAccounts/Login` with `encryptedPayload=<...>&rdtype=L&captchavh=false`
   — username+password client-side **encrypt** hoke jaate hain (browser ka JS karta hai).
3. Captcha UI dikhta hai par abhi **enforce nahi** (`captchavh=false`). ⚠️ Ye kabhi badal sakta hai.

**Isliye login native/HTTP se replicate karna risky hai** (encryption logic unke JS pe depend karta
hai). Solution neeche (§3).

### 1.5 Session ke liye zaroori headers (login ke baad milte hain)

| Header | List call | Detail call | Same? | Matlab |
|---|---|---|---|---|
| `appsavylogin` | `9V3Bi…lg==` | `9V3Bi…lg==` | ✅ | session-wide |
| `roleid` | `SMmBb…EA==` | `SMmBb…EA==` | ✅ | session-wide |
| `sourcetype` | `tzouk…oQ==` | `tzouk…oQ==` | ✅ | session-wide |
| `token` | `J58S+…6BB` | `J58S+…6BB` | ✅ | session-wide |
| `formid` | `dtdiok…Pg==` | `bVPB1…GA==` | ❌ | **per-Form alag** |

Plus cookies: `.AspNetCore.Session`, `XSRF-TOKEN`, `.AspNetCore.Antiforgery`.

**Key insight:** 4 headers (`token/roleid/sourcetype/appsavylogin`) session bhar ek jaise reuse hote hain.
Sirf `formid` har Form ke liye alag hai. Matlab ek baar login/session capture karke, hum kai forms
(13339, 13340) ko hit kar sakte hain — bas har form ka apna `formid` chahiye.

---

## 2. Architecture (3 layers)

```
┌──────────────────────────────────────────────────────────────┐
│  PWA (phone/desktop) — sirf apne backend se baat karta hai     │
│  • Complaint list  • Tap-to-call  • Post-call notes form       │
│  • frtbarabanki.com se KABHI seedha contact nahi               │
└───────────────▲──────────────────────────────┬────────────────┘
                │ read/write (Supabase / API)   │
┌───────────────┴──────────────────────────────▼────────────────┐
│  BACKEND (Next.js API routes on Vercel / Node)                 │
│  1. AUTH LAYER  — Puppeteer login → session capture → cache    │
│  2. SYNC LAYER  — cached session se 13339 (list) + 13340       │
│                   (detail) fetch → Supabase me upsert          │
└───────────────▲──────────────────────────────┬────────────────┘
                │ cached session (cookies+headers)              
┌───────────────┴──────────────────────────────▼────────────────┐
│  frtbarabanki.com  (login + GetRelationalDataA)                │
└────────────────────────────────────────────────────────────────┘
                                │
┌───────────────────────────────▼────────────────────────────────┐
│  Supabase (Postgres)                                            │
│  live_complaints • complaint_contacts • call_logs • frt_session │
└────────────────────────────────────────────────────────────────┘
```

**Golden rule:** Phone kabhi frtbarabanki.com ko touch nahi karega. Poora auth/scraping server-side.
Phone sirf apne Supabase/API ko simple, fast query karega — isliye reliable rahega.

---

## 3. Auth / Session strategy (sabse critical part)

**Chosen approach: server-side Puppeteer login + session caching** (already `my-scraping-project` me
proven — usi module ko reuse karenge).

Flow:
1. Backend Puppeteer (headless Chrome) me `frtbarabanki.com` kholta hai, real login karta hai
   (encryption ki tension nahi — browser khud karta hai).
2. Login ke baad **cookies + headers (`token`, `roleid`, `sourcetype`, `appsavylogin`, aur har form
   ka `formid`) capture** karke Supabase me cache karta hai (`frt_session` key).
3. Aage ke saare fetches **fast path** se — bina browser ke, seedha `fetch()` cached session ke saath.
4. Session expire/reject (HTTP 401/403 ya "session expired" body) → automatically dobara Puppeteer
   login karke session refresh.

Reuse source: `my-scraping-project/app/lib/shared-scraper.ts` →
`createFrtApiScraperSession`, `FrtApiSession`, login steps, header/cookie capture, XML template helpers.

---

## 4. Data model (Supabase)

```sql
-- Live complaints (FormId 13339 se)
create table live_complaints (
  dataid            bigint primary key,          -- FRT ka DATAID
  complaint_number  text unique,                 -- MV0207...
  fault_id          bigint,
  complaint_type    text,
  complaint_sub_type text,
  district          text,
  area              text,
  area_type         text,                        -- Rural/Urban
  feeder            text,
  action_status     text,                        -- FRT Assigned / In Progress / ...
  complaint_date    timestamptz,
  first_seen_at     timestamptz default now(),   -- humne pehli baar kab dekha
  last_synced_at    timestamptz default now(),
  still_in_feed     boolean default true         -- live grid se gayab hone pe false
);

-- Consumer contact (FormId 13340 se, lazily fetched & cached)
create table complaint_contacts (
  dataid         bigint primary key references live_complaints(dataid),
  consumer_name  text,
  mobile         text,
  address        text,
  landmark       text,
  remarks        text,
  substation     text,
  assigned_crew  text,
  fetched_at     timestamptz default now()
);

-- Humara asli value-add: call ke baad ka record
create table call_logs (
  id                bigserial primary key,
  dataid            bigint references live_complaints(dataid),
  complaint_number  text,
  call_time         timestamptz default now(),
  call_status       text,     -- Connected / No Answer / Switched Off / Busy / Wrong Number
  problem_category  text,     -- Meter fault / Wire tuta / Transformer / Voltage / Other
  notes             text,     -- free text
  operator          text,     -- kisne call kiya
  created_at        timestamptz default now()
);

-- Session cache (existing project jaisa)
create table frt_session (
  key      text primary key,   -- 'frt_api_session'
  payload  jsonb,
  saved_at timestamptz default now()
);
```

Reuse pattern: existing project me `upsert(..., { onConflict })` + `content_hash` se sirf badli hui
rows likhi jaati hain — wahi efficiency yahan bhi.

---

## 5. Sync strategy (data kitna fresh)

- **Detail (13340) lazily** — sirf jab operator kisi complaint pe tap kare tab us ek `DATAID` ka
  contact fetch karo aur cache karo. (N complaints ke liye N calls nahi maarenge — unke server pe
  bhi kam load, aur number tabhi chahiye jab call karni hai.)
- **List (13339) frequently** — fast path (browser ke bina) sasta hai, isliye:
  - **Manual "Fetch Latest" button** (jaisa existing project me refresh button hai — reuse) →
    turant force-refresh.
  - **Auto-poll** jab app khula ho (har ~2–5 min) → background me list update.
- **Vercel Hobby cron sirf daily** allowed hai — isliye frequent sync ke liye **client-triggered
  poll (app open)** sabse simple + free hai. (Alternative: Vercel Pro cron, ya `cron-job.org`/GitHub
  Actions se external trigger — baad me choose kar sakte hain.)

---

## 6. App features

### MVP
1. **App login** (operator ke liye simple auth — PII protect karne ke liye).
2. **Live complaint list** — area/feeder/status/date filters, search, newest-first.
3. **"Already called?" badge** — `call_logs` se join, taaki duplicate call na ho.
4. **Detail + one-tap call** — tap → contact lazily fetch → naam/mobile/pata → `tel:` Call button.
5. **Post-call form** — call_status + problem category + notes → `call_logs`.
6. **"Aaj ke calls" report** — din bhar ka kaam.
7. **Manual "Fetch Latest" button** + auto-poll.

### V2
- Feeder/area-wise **grouping** (mass outage detect — e.g. "BADEL pe 12 complaints").
- CSV/Excel/PDF **export** (existing project me `exceljs`/`jspdf` already hai — reuse).
- **Offline-first** — bina net list dikhe, net aate hi sync.
- Complaint lifecycle tracking — jab grid se gayab ho to `still_in_feed=false`, "resolved" mark.
- Multiple operators + per-operator stats.
- Push notification jab naya complaint kisi khaas area me aaye.

---

## 7. PWA specifics

- `manifest.json`: `name`, `icons`, `display: "standalone"`, `start_url` = calling page →
  home-screen icon tap karte hi seedha calling screen khulega, browser bar nahi dikhega.
- Service worker: installability + app-shell offline cache.
- `tel:9876543210` links PWA me normal phone dialer khol dete hain (native app jaisa hi).
- "Add to Home Screen" install prompt.

---

## 8. Tech stack + reuse

**Recommendation: Next.js (App Router) PWA + Supabase.** Kyunki:
- Auth/session-capture ka mushkil kaam `my-scraping-project` me already solved hai — **copy/reuse**.
- Tumhe Next.js + Supabase already aata hai.
- Full-stack ek hi jagah (backend API + PWA frontend).

> Flutter (original idea) bhi ho sakta hai, par session-capture ke liye **phir bhi ek server chahiye**
> (Puppeteer phone pe nahi chalega). Toh Next.js full-stack = kam moving parts.

Reuse checklist (existing project se laane wale pieces):
- [ ] Session-capture module (`createFrtApiScraperSession`, login steps)
- [ ] Header/cookie capture logic
- [ ] Base64 XML template build/replace helpers
- [ ] Supabase client + upsert/`content_hash` pattern
- [ ] Manual-refresh button pattern (`page.tsx` refresh flow)
- [ ] Export utils (`exceljs`, `jspdf`) — V2

---

## 9. Security / privacy (dhyaan dene wali baatein)

- Response me **real consumer PII** (naam/number/pata) hota hai — Supabase **RLS** on, HTTPS only,
  app login zaroori.
- **Kabhi real tokens/cookies/PII git me commit mat karo** (`.env` me credentials, `.gitignore` set).
- Automated polling unke server pe load daalta hai — **frequency reasonable rakho** (2–5 min kaafi hai).
- Yeh tumhare apne authorized login (`CONTROL_ROOM_BARABANKI`) ka operational tool hai — apne hi
  kaam ka data, apne liye better record.

---

## 10. ⚠️ Build se pehle VERIFY karne wali cheezein (open questions)

Ye abhi 100% confirm nahi — pehle test karke pakka karna hai, warna baad me dikkat aayegi:

1. **`formid` session-scoped hai ya stable?**
   `formid` per-Form alag hai — par kya har login pe badalta hai ya fixed encrypted constant hai?
   → Do baar login karke same form ka `formid` compare karo. (Safe plan: har session me us form ka
   page navigate karke `formid` fresh capture kar lo.)

2. **Kya cached session se 13339/13340 seedhe hit ho jaate hain?**
   Existing session `FormId 13345` navigate karke capture hui thi. 13339/13340 ke liye shayad us
   form ka page ek baar visit karna pade taaki uska `formid`/context mile. → Test karo.

3. **Single active session limit.**
   Code me "another login replaced this session" handling hai — matlab ek time ek hi session valid ho
   sakta hai. **Agar operator browser me bhi login rahega toh app ka session kick ho sakta hai (ya
   ulta)।** → Verify karo; zaroorat pade toh app ke liye dedicated login/credential rakho.

4. **Captcha enforcement risk.**
   Abhi `captchavh=false`. Kabhi enforce hua toh headless login toot sakta hai. → Contingency: real
   login page WebView/manual step.

5. **Live grid se complaint kab gayab hoti hai?**
   Closed hone pe grid se hat jaati hai kya? → `still_in_feed`/resolved logic isi pe depend karta hai.
   Ek complaint ko lifecycle bhar watch karo.

6. **Detail API batch ho sakta hai?**
   Kya ek call me multiple `DATAID` ke contacts aa sakte hain (server load kam karne ke liye)?
   → Test karo; nahi to lazy-per-tap hi theek hai.

7. **List pagination.**
   13339 saari active complaints ek baar me deta hai ya paginated? Response me ~60 rows dikhe.
   → Zyada volume pe paging check karo.

---

## 11. Suggested build phases

1. **Phase 0 — Verify (§10):** formid stability, session reuse for 13339/13340, single-session limit.
   Ye pehle, kyunki inpe architecture depend karta hai.
2. **Phase 1 — Backend:** session-capture reuse → `live_complaints` sync (list 13339) → contact fetch
   (detail 13340) → Supabase tables + `/api/sync` route.
3. **Phase 2 — PWA core:** list + filters + tap-to-call + post-call `call_logs` form + manual refresh.
4. **Phase 3 — PWA polish:** manifest/service worker/install, "aaj ke calls" report, "already called"
   badge, auto-poll.
5. **Phase 4 — V2:** export, grouping, offline, lifecycle tracking, multi-operator.

---

## Appendix A — Known IDs (from captured traffic)

- Project_Id: `339` · Company_Id: `1` · ROLE_ID: `1882`
- User_Id: `CONTROL_ROOM_BARABANKI` · IUVLogin_Id: `9311912726`
- List: FormId `13339`, Event Control_Id `143630`, Child `143649`/AC `196143`
- Detail: FormId `13340`, Parent Control_Id `143655` (Value = DATAID)
- History/MIS (old project): FormId `13345`
- Endpoint: `POST /api/AppsavyServices/GetRelationalDataA`  body `{"inputxml":"<base64 XML>","DocVersion":1}`

## Appendix B — FRT crew list (detail API dropdown, DATA_ID → crew)

FRT_1..FRT_50 sabhi crews (OBARI, JP NAGAR, PALHARI, BADEL, SATRIKH, BANKI, CHANDAULI, DEWA,
RAMNAGAR, SURATGANJ, MASAULI, TRILOKPUR, HAIDERGARH, DEVIGANJ, FATEHPUR, RAM SANEHIGHAT, DARIYABAD,
ZAIDPUR, SAFDARGANJ, … "FRT Van For Control Room"). Full list detail-API response me capture hai —
crew-filter/assign feature ke liye kaam aayega.
