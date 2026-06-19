require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const twilio  = require('twilio');

const app  = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const sessions = {};

// Send email via Resend API (HTTPS, works fine on Render free tier)
async function sendEmail({ to, subject, text }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: 'ChexVanz Chat <onboarding@resend.dev>',
      to: [to],
      subject,
      text
    })
  });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Resend API error: ${res.status} ${errBody}`);
  }
  return res.json();
}

const SYSTEM_PROMPT = `You are the friendly chat assistant for ChexVanz, a premium custom van conversion company that builds dream adventure vans for clients nationwide.

ABOUT CHEXVANZ:
- We build semi-custom adventure vans tailored to how each client travels — weekend escapes, remote work, family road trips, or full-time van life
- We work with clients across the entire United States (not just local)
- Our specialty is Mercedes Sprinters, but we work with Transits and Promasters too
- Our builds use an innovative modular design with extruded aluminum framing — lighter, stronger, fully adaptable

OUR LAYOUTS & PRICING:
- TIMBER (Sprinter 144 / Transit 136): Murphy bed, bench seat, slide-out Iceco fridge, microwave, Nomadic X3 AC, Espar heater. Starting at $137,000
- ATLAS (Sprinter 170X / Transit 148X): Fixed bed, full shower & toilet, closet with drawers, fridge, microwave, 11,000kW power + 300W solar, Nomadic X3 AC, Espar heater. Starting at $160,000
- RORO (Sprinter 170 / Transit 148): Fixed bed, fixed dinette for 2, full shower, fridge, microwave, closet, 11,000kW power + 300W solar. Starting at $160,000
- SAGE (Sprinter 170 / Transit 148): Couch-to-bed configuration, dinette for 2, full shower, slide-out toilet, fridge, 11,000kW power + 300W solar. Starting at $150,000

COMMON QUESTIONS:
Q: How much does a build cost / starting price?
A: Our builds start at $137,000 for the Timber layout. The Sage starts at $150,000, and the Atlas and Roro start at $160,000. These are starting prices — customizations can affect the final number.

Q: How long does a full build take?
A: Build timelines vary depending on our schedule and complexity. Reach out at chexvanz.com/startyourbuild for current estimates.

Q: Do you offer financing?
A: We don't have our own financing but many clients use personal loans or RV loans. We work with deposits and a payment schedule.

Q: Do you do partial builds?
A: Yes! We offer electrical & plumbing systems, window installations, and HVAC as individual services.

Q: How long can I be off grid?
A: Our Atlas, Roro, and Sage builds include an 11,000kW power system with 300W solar — enough for comfortable multi-day off-grid living.

Q: Sprinter vs Transit vs Promaster?
A: The Mercedes Sprinter is our specialty. The Ford Transit is slightly lower profile. The Ram Promaster has the most interior width. We help every client choose during the discovery call.

Q: Do you find the van / do I buy it?
A: We guide you through van selection and purchasing every step of the way.

Q: Do you have a warranty?
A: Yes! ChexVanz provides a one-year warranty on all craftsmanship. Components like fans, fridges, and electrical items carry manufacturer warranties.

Q: Can I see a van in person?
A: Absolutely! Reach out to schedule a tour. Also check our YouTube channel at youtube.com/@chexvanz.

Q: What if something breaks on the road?
A: Our one-year craftsmanship warranty covers workmanship issues. We're also reachable to help troubleshoot remotely.

Q: Do I need to live nearby?
A: Not at all! We work with clients across the country remotely.

Q: Do you have vans for sale already converted?
A: Yes! We actively convert vans ready to go. Reach out to see what's available.

TONE: Be warm, enthusiastic, and knowledgeable. Use casual language. You can use a van emoji 🚐 occasionally. Don't be salesy.

WHEN YOU CAN'T ANSWER: If a question is too specific, end your message with exactly this on its own line:
[NEEDS_HUMAN]`;

app.post('/chat', async (req, res) => {
  const { sessionId, message, history = [] } = req.body;
  if (!sessionId || !message) return res.status(400).json({ error: 'Missing fields' });

  try {
    const msgs = history.map(h => ({ role: h.role, content: h.content }));
    if (!msgs.length || msgs[msgs.length-1].role !== 'user') {
      msgs.push({ role: 'user', content: message });
    }

    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 600,
        system: SYSTEM_PROMPT,
        messages: msgs
      })
    });

    const data = await apiRes.json();
    const rawReply = data.content[0].text;
    const needsHuman = rawReply.includes('[NEEDS_HUMAN]');
    const reply = rawReply.replace('[NEEDS_HUMAN]', '').trim();

    if (needsHuman) {
      sessions[sessionId] = { question: message, history, timestamp: Date.now(), reply: null, busy: false };

      try {
        const snippet = message.length > 200 ? message.slice(0,200) + '…' : message;
        await sendEmail({
          to: 'info@chexvanz.com',
          subject: '🚐 ChexVanz Chat — Needs Your Reply',
          text: `A visitor on the chat widget asked something Claude couldn't fully answer:\n\n"${snippet}"\n\nSession ID: ${sessionId}\n\nTo reply, log into the chat or wait for the visitor to leave their email if you don't respond within 10 minutes.\n\n(Note: SMS alerts are temporarily disabled while A2P 10DLC registration completes. Once approved we'll switch back to text alerts.)`
        });
      } catch (emailErr) {
        console.error('Alert email error:', emailErr);
      }
    }

    res.json({ reply, needsHuman });
  } catch (err) {
    console.error('Error:', err);
    res.status(500).json({ reply: "Something went sideways on our end — try again in a moment!", needsHuman: false });
  }
});

app.get('/poll', (req, res) => {
  const { sessionId } = req.query;
  const session = sessions[sessionId];
  if (!session) return res.json({ reply: null, busy: false });
  if (session.busy) { delete sessions[sessionId]; return res.json({ reply: null, busy: true }); }
  if (session.reply) { const reply = session.reply; delete sessions[sessionId]; return res.json({ reply, busy: false }); }
  res.json({ reply: null, busy: false });
});

// SMS webhook kept in place for when A2P registration is approved
app.post('/sms', (req, res) => {
  const incomingBody = (req.body.Body || '').trim();
  const from = req.body.From || '';
  const ownerNormalized = (process.env.OWNER_PHONE || '').replace(/\D/g, '');
  const fromNormalized = from.replace(/\D/g, '');
  if (!ownerNormalized || !fromNormalized.endsWith(ownerNormalized.slice(-10))) {
    return res.type('text/xml').send('<Response/>');
  }
  if (incomingBody.toUpperCase() === 'BUSY') {
    const pending = Object.entries(sessions).filter(([,s]) => !s.reply && !s.busy).sort(([,a],[,b]) => b.timestamp - a.timestamp);
    if (pending.length) sessions[pending[0][0]].busy = true;
    res.type('text/xml').send('<Response><Message>Got it — visitor will be prompted to leave their email.</Message></Response>');
  } else {
    const pending = Object.entries(sessions).filter(([,s]) => !s.reply && !s.busy).sort(([,a],[,b]) => b.timestamp - a.timestamp);
    if (pending.length) { sessions[pending[0][0]].reply = incomingBody; res.type('text/xml').send('<Response><Message>✅ Reply sent to visitor!</Message></Response>'); }
    else res.type('text/xml').send('<Response><Message>No active chat session found.</Message></Response>');
  }
});

app.post('/email', async (req, res) => {
  const { sessionId, email, history = [] } = req.body;
  const summary = history.map(h => `${h.role === 'user' ? 'Visitor' : 'Bot'}: ${h.content}`).join('\n');
  try {
    await sendEmail({
      to: 'info@chexvanz.com',
      subject: `💬 New chat lead: ${email}`,
      text: `A visitor left their email for follow-up.\n\nEmail: ${email}\n\nConversation:\n${summary || '(none)'}`
    });
  } catch(err) { console.error('Email error:', err); }
  res.json({ ok: true });
});

app.get('/', (req, res) => res.send('ChexVanz chat backend is running 🚐'));

setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [id, s] of Object.entries(sessions)) { if (s.timestamp < cutoff) delete sessions[id]; }
}, 60 * 60 * 1000);

app.listen(port, () => console.log(`ChexVanz backend running on port ${port}`));
