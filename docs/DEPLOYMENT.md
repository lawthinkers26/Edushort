# Taking EduShorts live, step by step

Follow the steps in order: each one produces keys that a later step needs. Keep a private notes file (not in git) to paste keys into as you go.

| You will create | Used by | Cost to start (check current pricing) |
| --- | --- | --- |
| Supabase project | Database | Free tier |
| Firebase project | Logins | Free tier (email/password) |
| Bunny.net Stream library | Video hosting | Pay-as-you-go, small at low traffic |
| Razorpay account | Payments | Per-transaction fee; live mode needs KYC |
| Render account | Hosts the API + admin website | Free tier to test; paid "Starter" for launch |
| Expo account (EAS) | Builds the Android/iOS app | Free tier |
| Google Play Console / Apple Developer | Store publishing | One-time fee / yearly fee |

---

## Step 1: Database (Supabase), about 10 minutes

1. Go to <https://supabase.com>. Sign up and click **New project**. For the fastest response in India, pick the region **South Asia (Mumbai)**. Save the database password it shows you.
2. Open **SQL Editor** and click **New query**. Paste the entire contents of [`supabase/migrations/20260925000000_init_schema.sql`](../supabase/migrations/20260925000000_init_schema.sql) and click **Run**. It should say "Success".
3. Check the **Table Editor**. You should see `profiles`, `reels`, `system_config`, `reel_views`, `reel_comments` and `payment_webhook_events`, and `system_config` should have one row with `free_reel_limit = 5`.
4. Open **Project Settings → API** and copy these two values:
   - **Project URL**, which becomes `SUPABASE_URL`.
   - The **service_role** secret key, which becomes `SUPABASE_SERVICE_ROLE_KEY`. ⚠️ This key is a master password. Only ever put it in the backend's settings, never in the app or the admin site.

## Step 2: Logins (Firebase), about 10 minutes

1. Go to <https://console.firebase.google.com> and click **Add project** (you can turn Analytics off).
2. Open **Build → Authentication → Get started**, then **Sign-in method**, and enable **Email/Password**.
3. Go to **Project settings (⚙️) → General → Your apps** and click the **Web** icon (`</>`). Register an app named "EduShorts" and copy the config values:
   - `apiKey`, `authDomain`, `projectId` and `appId` are used by both the mobile app and the admin site.
4. Go to **Project settings → Service accounts** and click **Generate new private key**. A JSON file downloads. From it:
   - `project_id` becomes `FIREBASE_PROJECT_ID`
   - `client_email` becomes `FIREBASE_CLIENT_EMAIL`
   - `private_key` becomes `FIREBASE_PRIVATE_KEY`. Copy the whole value, including `-----BEGIN PRIVATE KEY-----` and the `\n` characters.
   ⚠️ Treat this file like a password. Don't email it or commit it.
5. Go to **Authentication → Users → Add user** and create *your own* admin login (email and password). You'll make it an admin in Step 7.

## Step 3: Video hosting (Bunny Stream), about 10 minutes

1. Go to <https://bunny.net>, sign up and open **Stream → Add Video Library**. Name it "EduShorts" and pick regions close to your users (Asia).
2. Open the library's **API** tab and copy:
   - **Video Library ID** (a number), which becomes `BUNNY_STREAM_LIBRARY_ID`.
   - **API Key**, which becomes `BUNNY_STREAM_API_KEY`.
   - **CDN Hostname** (looks like `vz-xxxxxxxx-xxx.b-cdn.net`), which becomes `BUNNY_CDN_HOSTNAME`.
3. **Recommended (protects your videos):** go to **CDN → the pull zone that belongs to this library → Security → Token Authentication**, turn it on and copy the key into `BUNNY_CDN_TOKEN_KEY`.
   - Do **not** turn on "Block direct URL file access" or "Allowed referrers". The mobile app streams directly, and those settings would stop videos playing. Token authentication is the right protection.
4. Optional: in the library's **Security** tab, turn on embed token authentication and copy that key into `BUNNY_EMBED_TOKEN_KEY`. Leave it empty if you don't need it.

## Step 4: Payments (Razorpay), about 15 minutes (start in Test Mode)

1. Go to <https://dashboard.razorpay.com> and sign up. Keep the dashboard switched to **Test Mode** for now.
2. Open **Account & Settings → API Keys → Generate Test Key** and copy:
   - **Key Id**, which becomes `RAZORPAY_KEY_ID`.
   - **Key Secret**, which becomes `RAZORPAY_KEY_SECRET`.
3. Open **Subscriptions → Plans → Create Plan**. For example, "EduShorts Premium", billed monthly at ₹199. Copy the `plan_...` ID into `RAZORPAY_PLAN_ID`.
   - If the price isn't ₹199, set `RAZORPAY_PLAN_DISPLAY_AMOUNT_PAISE` to match. It's in paise, so ₹199 is `19900`.
   - If **Subscriptions** isn't visible, ask Razorpay support to enable it on your account.
4. You'll add the webhook in Step 6, once the API has a public address.

## Step 5: Put the API and admin site online (Render), about 20 minutes

The repo already includes [`render.yaml`](../render.yaml), which sets up both services automatically.

1. Merge the branch `claude/edushorts-platform-f4xik5` into `main` on GitHub. You can open a pull request and merge it, or ask me to open the PR.
2. Go to <https://render.com>, sign up with GitHub, and click **New → Blueprint**. Select the `Edushort` repo. Render finds `render.yaml` and shows two services: `edushorts-api` and `edushorts-admin`.
3. Render asks for every secret value. Fill them in from Steps 1–4:

   | Variable | Where it came from |
   | --- | --- |
   | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Step 1 |
   | `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` | Step 2, service-account JSON |
   | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_PLAN_ID` | Step 4 |
   | `RAZORPAY_WEBHOOK_SECRET` | Make up a long random string now, and reuse it in Step 6 |
   | `BUNNY_*` | Step 3 (leave a token key empty if you skipped it) |
   | `CORS_ORIGINS` | Leave blank for now |
   | `VITE_FIREBASE_*` (admin) | Step 2, web app config |
   | `VITE_API_URL` (admin) | Leave blank for now |

4. Click **Apply** and wait for both services to show "Live". Then:
   - Open `https://edushorts-api.onrender.com/health` (your exact name may differ). It should show `{"status":"ok",...}`.
   - Set `CORS_ORIGINS` on **edushorts-api** to the admin URL, e.g. `https://edushorts-admin.onrender.com`. It redeploys automatically.
   - Set `VITE_API_URL` on **edushorts-admin** to the API URL, then click **Manual Deploy**. The admin site bakes this value in when it builds.
5. In Firebase, go to **Authentication → Settings → Authorized domains** and add your admin domain, e.g. `edushorts-admin.onrender.com`.

> Free Render instances go to sleep when idle, so the first request after a quiet period takes around 30–60 seconds. Razorpay retries webhooks, so nothing is lost. Before real users arrive, switch `edushorts-api` to the **Starter** plan so it stays awake.

## Step 6: Connect the Razorpay webhook, about 5 minutes

In the Razorpay dashboard (Test Mode), open **Account & Settings → Webhooks → Add New Webhook**:

- **URL:** `https://<your-api>.onrender.com/api/webhooks/razorpay`
- **Secret:** the same random string you put in `RAZORPAY_WEBHOOK_SECRET`
- **Events:** `subscription.activated`, `subscription.charged`, `subscription.cancelled`, `subscription.halted`, `subscription.completed`, `subscription.paused`, `subscription.resumed`

## Step 7: Make yourself an admin

The admin site only lets in users with the `admin` flag. You set it by running one command on a computer with Node.js 20+ installed:

```bash
git clone https://github.com/lawthinkers26/Edushort.git
cd Edushort/backend
npm install
cp .env.example .env        # open .env and paste the same values you gave Render
npm run set-admin -- you@example.com
```

Then open the admin site and sign in with the user you created in Step 2.5.

## Step 8: Add content and set the paywall

1. Open the admin site and go to **Upload Workspace**. Drop in a vertical (9:16) video, type a title, and click **Upload to Bunny**. Then fill in the description and category and click **Publish reel**. Add at least 5–10 reels.
2. Go to **Paywall Controller** and choose how many reels are free (for example, 5), then click **Save limit**.

## Step 9: Try the mobile app on your phone

1. Install **Expo Go** from the Play Store or App Store.
2. On your computer:
   ```bash
   cd Edushort/mobile
   npm install
   cp .env.example .env
   ```
   In `.env`, set `EXPO_PUBLIC_API_URL=https://<your-api>.onrender.com` and fill in the four `EXPO_PUBLIC_FIREBASE_*` values from Step 2.
3. Run `npx expo start` and scan the QR code with Expo Go (Android) or the Camera app (iPhone).
4. Test the whole journey:
   - Sign up and watch reels, checking that the category chips filter the feed.
   - Like, comment, share and save a reel.
   - Keep watching past the free limit and check that the paywall appears.
   - Tap **Unlock Unlimited Learning** and pay with one of Razorpay's **test** cards or UPI IDs (listed in Razorpay's docs under "Test Card Details").
   - Check that the feed unlocks, and that your profile in Supabase shows `subscription_status = true`.

## Step 10: Build the real app and publish it

```bash
npm install -g eas-cli
eas login                  # free Expo account
cd Edushort/mobile
eas init                   # links the project (adds projectId to app.json — commit that change)

# Store the app's settings in EAS (repeat for each EXPO_PUBLIC_* variable in .env)
eas env:create --environment preview    --name EXPO_PUBLIC_API_URL --value https://<your-api>.onrender.com --visibility plaintext
eas env:create --environment production --name EXPO_PUBLIC_API_URL --value https://<your-api>.onrender.com --visibility plaintext

eas build -p android --profile preview     # installable APK to test on real phones
eas build -p android --profile production  # .aab for Google Play
eas submit -p android                      # uploads to Play Console
```

For iPhone, run `eas build -p ios --profile production` and then `eas submit -p ios`. This needs an Apple Developer account.

> ⚠️ **Check the store payment rules before you submit.** Google Play and the Apple App Store generally require their own in-app billing for digital subscriptions sold inside an app. India has an alternative-billing program on Google Play. Read the current policy, or get advice, before you ship Razorpay checkout inside a store build. If you have to use store billing, only the payment step changes: the paywall, metering and backend stay the same.

## Step 11: Switch to real money (Razorpay live mode)

1. Finish Razorpay **KYC / account activation**.
2. In **Live Mode**, repeat Step 4 (generate live API keys and create the plan again) and Step 6 (add the webhook again).
3. On Render, replace `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_PLAN_ID` and `RAZORPAY_WEBHOOK_SECRET` with the live values.
4. Make one real ₹-plan purchase yourself, check it works, then cancel it from the app's Profile screen.

## Launch checklist

- [ ] `/health` on the API returns `ok`, and the API is on a paid plan so it doesn't sleep.
- [ ] Bunny token authentication is on.
- [ ] Razorpay is in live mode, with live keys, the live plan and the live webhook.
- [ ] Firebase authorized domains include the admin domain.
- [ ] Supabase daily backups are enabled (paid plans) and you've saved your database password.
- [ ] At least 20 reels are published across all four categories.
- [ ] You've tested a full sign-up → paywall → payment → unlock run on a real phone.
- [ ] You have a privacy policy URL. The Play Store and App Store require one.
