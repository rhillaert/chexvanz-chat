/**
 * ChexVanz Chat Backend
 * ─────────────────────
 * Handles:
 *  - /chat      → Claude AI answers visitor questions
 *  - /poll      → Widget checks for human reply
 *  - /sms       → Twilio webhook receives your text reply
 *  - /email     → Stores email + question when visitor leaves contact
 *
 * Setup:
 *  1. npm install
 *  2. Copy .env.example to .env and fill in your keys
 *  3. node server.js  (or deploy to Render.com)
 */

require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const Anthropic  = require('@anthropic-ai/sdk');
const twilio     = require('twilio');
const nodemailer = require('nodemailer');

const app  = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false })); // for Twilio webhooks

// ── Clients ──────────────────────────────────────────────────────
const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// ── In-memory session store ───────────────────────────────────────
// Stores sessions waiting for a human reply
// Format: { [sessionId]: { question, history, timestamp, reply, busy } }
const sessions = {};

// ── ChexVanz system prompt ────────────────────────────────────────
const SYSTEM_PROMPT = `You are the friendly chat assistant for ChexVanz, a premium custom van conversion company that builds dream adventure vans for clients nationwide.

ABOUT CHEXVANZ:
- We build semi-custom adventure vans tailored to how each client travels — weekend escapes, remote work, family road trips, or full-time van life
- We work with clients across the entire United States (not just local)
- Our specialty is Mercedes Sprinters, but we work with Transits and Promasters too
- Our builds use an innovative modular design with extruded aluminum framing — lighter, stronger, fully adaptable
- We serve clients nationwide with a remote-friendly planning and design process

OUR LAYOUTS & PRICING:
- TIMBER (Sprinter 144 / Transit 136): Murphy bed, bench seat, slide-out Iceco fridge, microwave, Nomadic X3 AC, Espar heater. Starting at $137,000
- ATLAS (Sprinter 170X / Transit 148X): Fixed bed, full shower & toilet, closet with drawers, fridge, microwave, 11,000kW power + 300W solar, Nomadic X3 AC, Espar heater. Starting at $160,000
- RORO (Sprinter 170 / Transit 148): Fixed bed, fixed dinette for 2, full shower, fridge, microwave, closet, 11,000kW power + 300W solar. Starting at $160,000
- SAGE (Sprinter 170 / Transit 148): Couch-to-bed configuration, dinette for 2, full shower, slide-out toilet, fridge, 11,000kW power + 300W solar. Starting at $150,000

COMMON QUESTIONS — answer these confidently:

Q: How much does a build cost / what is the starting price?
A: Our builds start at $137,000 for the Timber layout and go up from there depending on the van size, layout, and features you choose. The Atlas and Roro start at $160,000, and the Sage starts at $150,000. These are starting prices — customizations can affect the final number. We'd love to walk you through options on a discovery call!

Q: How long does a full build take?
A: Build timelines vary depending on our current schedule and the complexity of your build. Once you connect with us we can give you a current estimate. The best way to secure your spot is to reach out and start the conversation at chexvanz.com/startyourbuild

Q: Do you offer financing?
A: We don't have our own financing program, but many clients finance through personal loans, RV loans, or specialty lenders. We're happy to discuss the payment structure — we work with deposits and a payment schedule outlined in your purchase agreement.

Q: Do you do partial builds or just full builds?
A: We also offer individual services including electrical & plumbing systems, window installations, and HVAC. So yes, we can help with specific parts of a build too.

Q: Can I buy my own components / supply my own parts?
A: This is something to discuss during the design consultation. Reach out and we can talk through what makes sense for your build.

Q: How long can I be off grid?
A: It depends on the power system. Our Atlas, Roro, and Sage builds include an 11,000kW power system with 300W solar — enough for comfortable multi-day off-grid living. The Timber can be configured with solar too. During the design phase we'll size your power system to your actual usage needs.

Q: Sprinter vs Transit vs Promaster — which should I choose?
A: Each has its strengths. The Mercedes Sprinter is our specialty — great build quality, tall roof, wide availability of parts. The Ford Transit is slightly lower profile and easier to park in urban areas. The Ram Promaster has the most interior width. We help every client choose the right van for their travel style during the discovery call.

Q: Which van is easiest to drive?
A: The Transit tends to feel most car-like for new van drivers. The Sprinter is easy to get used to. All of them drive more like a large van than a truck. We're happy to talk through driving considerations during your consultation.

Q: Do you find the van for me / do you buy the van or do I?
A: We guide you through the van selection and purchasing process. Our team will help you find the right van ensuring it aligns with your requirements. We assist every step of the way to make the purchase seamless.

Q: Do you have a warranty?
A: Yes! ChexVanz provides a one-year warranty on all our craftsmanship. For components like fans, fridges, and electrical items, the manufacturer's warranty applies.

Q: Can I see a van in person / do you offer tours?
A: Absolutely! Reach out to schedule a tour. You can also check out our YouTube channel at youtube.com/@chexvanz for videos and walkthroughs.

Q: What happens if something breaks on the road?
A: Our one-year craftsmanship warranty has you covered for workmanship issues. For components, the manufacturer warranties apply. We're also always reachable to help troubleshoot remotely.

Q: Do I need to live near you?
A: Not at all! We regularly work with clients across the country. Our entire planning and design process works remotely.

Q: How does the process work?
A: Plan → Design → Build → Delivery. We start with a discovery call to understand how you travel and what you need. Then we work together on layout and features. You follow along with regular updates during the build. Then pick up your van and hit the road!

Q: Do you have vans already converted for sale?
A: Yes! We actively convert vans that are ready to go. Check the website or reach out to see what's currently available.

TONE: Be warm, enthusiastic, and knowledgeable — like a friend who really knows vans and loves helping people find their perfect adventure vehicle. Use casual language. You can use a van emoji occasionally 🚐. Don't be salesy. Be honest.

WHEN YOU CAN'T ANSWER: If a question is too specific (custom pricing for their exact build, current availability, specific scheduling, personal account details, anything requiring a human judgment call), respond helpfully with what you do know, then end your message with exactly this marker on its own line:
[NEEDS_HUMAN]

Example: "That's a great question about [X]. Here's what I can tell you: [general info]. For the specifics of your situation, let me get one of our team members to follow up with you personally. [NEEDS_HUMAN]"

Do NOT use [NEEDS_HUMAN] for questions you can confidently answer from the info above.`;

// ── POST /chat ────────────────────────────────────────────────────
app.post('/chat', async (req, res) => {
  const { sessionId, message, history = [] } = req.body;

  if (!sessionId || !message) {
    return res.status(400).json({ error: 'Missing sessionId or message' });
  }

  try {
    // Build message history for Claude
    const msgs = history.map(h => ({ role: h.role, content: h.content }));
    // Make sure last message is user
    if (!msgs.length || msgs[msgs.length - 1].role !== 'user') {
      msgs.push({ role: 'user', content: message });
    }

    const response = await claude.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 600,
      system: SYSTEM_PROMPT,
      messages: msgs
    });

    const rawReply = response.content[0].text;
    const needsHuman = rawReply.includes('[NEEDS_HUMAN]');
    const reply = rawReply.replace('[NEEDS_HUMAN]', '').trim();

    if (needsHuman) {
      // Store session so we can receive human reply
      sessions[sessionId] = {
        question: message,
        history: history,
        timestamp: Date.now(),
        reply: null,
        busy: false
      };

      // Send SMS alert to owner
      const snippet = message.length > 120 ? message.slice(0, 120) + '…' : message;
      await twilioClient.messages.create({
        body: `💬 ChexVanz chat question:\n"${snippet}"\n\nReply to respond (or text BUSY to send email fallback).\nSession: ${sessionId.slice(-6)}`,
        from: process.env.TWILIO_FROM_NUMBER,
        to: process.env.OWNER_PHONE
      });
    }

    res.json({ reply, needsHuman });

  } catch (err) {
    console.error('Claude error:', err);
    res.status(500).json({
      reply: "Something went sideways on our end — try again in a moment!",
      needsHuman: false
    });
  }
});

// ── GET /poll ─────────────────────────────────────────────────────
// Widget polls this every 8 seconds waiting for a human reply
app.get('/poll', (req, res) => {
  const { sessionId } = req.query;
  const session = sessions[sessionId];

  if (!session) return res.json({ reply: null, busy: false });

  if (session.busy) {
    delete sessions[sessionId];
    return res.json({ reply: null, busy: true });
  }

  if (session.reply) {
    const reply = session.reply;
    delete sessions[sessionId];
    return res.json({ reply, busy: false });
  }

  res.json({ reply: null, busy: false });
});

// ── POST /sms  (Twilio webhook) ───────────────────────────────────
// Twilio calls this when you reply to an SMS alert
app.post('/sms', (req, res) => {
  const incomingBody = (req.body.Body || '').trim();
  const from = req.body.From || '';

  // Only accept from owner's phone
  const ownerNormalized = (process.env.OWNER_PHONE || '').replace(/\D/g, '');
  const fromNormalized  = from.replace(/\D/g, '');

  if (!ownerNormalized || !fromNormalized.endsWith(ownerNormalized.slice(-10))) {
    return res.type('text/xml').send('<Response/>');
  }

  if (incomingBody.toUpperCase() === 'BUSY') {
    // Mark all pending sessions as busy (simple: mark the most recent one)
    const pending = Object.entries(sessions)
      .filter(([, s]) => !s.reply && !s.busy)
      .sort(([, a], [, b]) => b.timestamp - a.timestamp);

    if (pending.length) {
      sessions[pending[0][0]].busy = true;
    }

    res.type('text/xml').send('<Response><Message>Got it — visitor will be prompted to leave their email.</Message></Response>');
  } else {
    // Match to most recent pending session
    const pending = Object.entries(sessions)
      .filter(([, s]) => !s.reply && !s.busy)
      .sort(([, a], [, b]) => b.timestamp - a.timestamp);

    if (pending.length) {
      sessions[pending[0][0]].reply = incomingBody;
      res.type('text/xml').send('<Response><Message>✅ Reply sent to visitor!</Message></Response>');
    } else {
      res.type('text/xml').send('<Response><Message>No active chat session found.</Message></Response>');
    }
  }
});

// ── POST /email ───────────────────────────────────────────────────
// Visitor submits their email for follow-up
app.post('/email', async (req, res) => {
  const { sessionId, email, history = [] } = req.body;

  // Build a summary of the conversation
  const summary = history
    .map(h => `${h.role === 'user' ? 'Visitor' : 'Bot'}: ${h.content}`)
    .join('\n');

  // Send email notification to ChexVanz
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_FROM,
        pass: process.env.EMAIL_PASSWORD
      }
    });

    await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: 'info@chexvanz.com',
      subject: `💬 New chat lead: ${email}`,
      text: `A visitor left their email for follow-up.\n\nEmail: ${email}\n\nConversation:\n${summary || '(no conversation recorded)'}\n\nReach out to ${email} when you get a chance!`
    });

    // Also send owner an SMS nudge
    await twilioClient.messages.create({
      body: `📧 Chat lead captured: ${email} — check info@chexvanz.com for the full conversation.`,
      from: process.env.TWILIO_FROM_NUMBER,
      to: process.env.OWNER_PHONE
    });

  } catch (err) {
    console.error('Email error:', err);
  }

  res.json({ ok: true });
});

// ── Health check ──────────────────────────────────────────────────
app.get('/', (req, res) => res.send('ChexVanz chat backend is running 🚐'));

// ── Clean up stale sessions every hour ───────────────────────────
setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000; // 2 hours
  for (const [id, s] of Object.entries(sessions)) {
    if (s.timestamp < cutoff) delete sessions[id];
  }
}, 60 * 60 * 1000);

app.listen(port, () => console.log(`ChexVanz backend running on port ${port}`));
