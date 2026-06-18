# ChexVanz Chat Widget — Setup Guide

## What you have
- `chexvanz-widget.html` — the chat widget (one section gets pasted into Squarespace)
- `chexvanz-server/server.js` — the backend that handles AI, SMS alerts, and email capture
- `chexvanz-server/package.json` — server dependencies
- `chexvanz-server/.env.example` — template for your secret keys

---

## Step 1 — Get your API keys (30 min)

### A. Anthropic API key (Claude AI brain)
1. Go to console.anthropic.com
2. Sign up / log in
3. Click "API Keys" → "Create Key"
4. Copy it — starts with `sk-ant-`
5. Add $5–10 credit (more than enough for months of use)

### B. Twilio (SMS alerts to your phone)
1. Go to twilio.com → sign up free
2. Verify your phone number (703-599-0515)
3. Get a free trial phone number (this is the number that texts you)
4. From the console copy:
   - Account SID
   - Auth Token
   - Your new Twilio phone number

### C. Gmail App Password (for email notifications)
1. Go to myaccount.google.com
2. Security → 2-Step Verification (enable if not already)
3. Security → App Passwords
4. Create one called "ChexVanz Chat"
5. Copy the 16-character password it gives you

---

## Step 2 — Deploy the backend to Render.com (free)

1. Go to render.com → sign up free with GitHub
2. Create a new GitHub repo called `chexvanz-chat`
3. Upload the contents of `chexvanz-server/` to that repo
4. In Render: New → Web Service → connect your repo
5. Settings:
   - Build Command: `npm install`
   - Start Command: `node server.js`
   - Instance Type: Free
6. Add Environment Variables (from your .env.example):
   - ANTHROPIC_API_KEY
   - TWILIO_ACCOUNT_SID
   - TWILIO_AUTH_TOKEN
   - TWILIO_FROM_NUMBER
   - OWNER_PHONE
   - EMAIL_FROM
   - EMAIL_PASSWORD
7. Deploy — Render gives you a URL like `https://chexvanz-chat.onrender.com`
8. Copy that URL

---

## Step 3 — Connect Twilio webhook

1. In Twilio console → Phone Numbers → your number → Configure
2. Under "A Message Comes In" → Webhook
3. Paste: `https://chexvanz-chat.onrender.com/sms`
4. Method: HTTP POST
5. Save

This is how your text replies get routed back to the chat window.

---

## Step 4 — Add the widget to Squarespace

1. Open `chexvanz-widget.html` in a text editor
2. Find this line near the top of the `<script>` section:
   ```
   const BACKEND_URL = 'https://YOUR-BACKEND-URL.onrender.com';
   ```
3. Replace with your actual Render URL, e.g.:
   ```
   const BACKEND_URL = 'https://chexvanz-chat.onrender.com';
   ```
4. Select everything between the two comment lines:
   ```
   <!-- CHEXVANZ CHAT WIDGET — Paste everything below this comment -->
   ...
   <!-- END OF WIDGET — stop pasting here -->
   ```
5. In Squarespace: Settings → Advanced → Code Injection → Footer
6. Paste it in
7. Save

---

## How to use it day-to-day

**When Claude can answer:** Nothing happens on your end — visitor gets an answer instantly.

**When Claude can't answer:** You get a text like:
```
💬 ChexVanz chat question:
"Do you have any vans available right now in the $150k range?"

Reply to respond (or text BUSY to send email fallback).
Session: a3f9c2
```

**To respond:** Just reply to the text normally. Your reply appears in the visitor's chat window within seconds.

**If you're busy:** Text back `BUSY` — the visitor sees your "building dream vans" message and is prompted to leave their email.

**If you don't reply in 10 minutes:** The visitor automatically sees the "building dream vans" message and email prompt.

**When visitor leaves email:** You get a text nudge AND an email at info@chexvanz.com with their email and the full conversation.

---

## Monthly costs

| Service | Cost |
|---|---|
| Render.com (hosting) | Free |
| Anthropic API (Claude) | ~$1–5/month |
| Twilio phone number | $1.15/month |
| Twilio SMS | ~$0.01 per text |
| **Total** | **~$3–7/month** |

---

## Need help?

If you get stuck on any step, the hardest part is usually the Twilio webhook setup.
The Render deployment is very straightforward — their UI walks you through it.
