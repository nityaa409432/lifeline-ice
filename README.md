# Lifeline ICE

An emergency app, not a card maker. It puts your medical ID **on your phone's lock screen**, sends an **SOS with your GPS location** to your family in one hold, and gives anyone who scans your QR code a **live responder page** with tap-to-call contacts, read-aloud, translation and an **AI first-aid helper** that knows your allergies and medicines.

Plain HTML, CSS and JavaScript. No framework, no database, no sign-up. Works offline once installed.

## What makes it different

| Feature | How it works |
|---|---|
| **Lock-screen medical ID** | The app pins a notification that stays until dismissed (`requireInteraction`). Android shows it on the lock screen; it has "Call Mum" and "Full medical ID" buttons. Opening the app re-pins it, and on Android Chrome the service worker re-pins it about twice a day (Periodic Background Sync). |
| **Hold-to-SOS** | Hold the red button for 2 seconds. It gets your GPS position and builds a message with a Google Maps link and your medical ID link, ready to send on WhatsApp or SMS to each contact, or to everyone at once. Holding (not tapping) stops pocket presses. |
| **Siren and flash** | A loud two-tone siren (Web Audio) and a flashing screen, with a wake lock so the screen stays on. |
| **Responder page from the QR** | The QR opens `your-site/#id=…`. Your details are packed into the link (compressed with `CompressionStream`, then base64url), and the part after `#` is never sent to any server, so there is no database to leak. The page has a big call button, allergies highlighted in red, tap-to-call and WhatsApp for each contact, and "Tell their family where they are", which sends the *responder's* location to your contacts. |
| **AI first-aid helper** | A bystander can ask "Can I give paracetamol?" and the AI answers using your card: it checks the question against your allergies, conditions and medicines, and if anything sounds life-threatening it puts "Call 112 now" first. |
| **Translate the page** | The responder picks their language (17, including Hindi, Tamil, Arabic and Urdu, right-to-left handled). Read aloud speaks it in that language. |
| **Readiness score** | Home shows how ready you are (details, contacts with country codes, lock screen, installed) with a Fix link for each gap. |
| **AI: scan a prescription, check my info** | Photo of a prescription fills in medicines; "Check my info" spots gaps a paramedic would ask about. |
| **Offline app (PWA)** | `manifest.webmanifest` and `sw.js` make it installable. After the first visit it opens with no signal. |
| **India numbers** | 112 is the main button (India's single emergency number). Ambulance 108, Police 100 and Fire 101 sit next to it as one-tap buttons, on Home, in SOS and on the responder page. |
| **Install button** | Shows Chrome's real install dialog when the browser offers one. Safari, Firefox, in-app browsers (Instagram, WhatsApp) and already-installed apps never offer it, so the button then shows the exact steps for that browser. |
| Also | Family profiles (up to 8), print a wallet-size card with the QR, copy details into the phone's built-in Medical ID, backup and restore. |

## Honest limits (worth saying in a demo)

- **Lock screen on Android:** works in Chrome. The phone must allow notification content on the lock screen (Settings, Notifications, "Show all content"). The user can still swipe it away; it comes back when the app opens.
- **Lock screen on iPhone:** needs iOS 16.4 or later **and** the app added to the Home Screen (Safari, Share, Add to Home Screen), then opened from that icon. iOS moves older notifications into Notification Center, so it is less permanent than on Android. iPhone's own Medical ID (Health app) is the most reliable lock-screen option, which is why the app has "Copy my details" for it.
- **SOS** prepares the message; the user still presses Send in WhatsApp or Messages. Browsers cannot send SMS silently, and that is a good thing.
- **Live tracking** would need a server; "Update location" sends a fresh position instead.
- **The QR link** works when the site is online (Netlify). The owner's own phone has it offline after install.

## Files

```
index.html             the page (owner app + responder page)
style.css              all styles, light and dark
app.js                 everything the app does
ai.js                  one wrapper for AI (Claude preview, free Gemini on Netlify, or own key)
sw.js                  service worker: offline, lock-screen card taps, re-pinning
manifest.webmanifest   makes it installable
icons/                 app icons
netlify/functions/ai.mjs   free AI on Netlify (holds the Gemini key)
netlify.toml           tells Netlify where the function is
```

## Put it online (beginner steps)

Lock-screen cards, installing and the QR link all need **https**, which Netlify gives you for free.

### Option A: Netlify drag and drop (2 minutes, no AI)

1. Unzip `lifeline-ice.zip`.
2. Go to https://app.netlify.com/drop and drag the **unzipped folder** onto the page.
3. Open the link Netlify gives you **on your phone**. Everything works except the AI buttons (drag and drop does not run the function).
4. To update later: Netlify, your site, Deploys, drag the folder in again.

### Option B: GitHub + Netlify (10 minutes, AI included, still free)

1. Create a free GitHub account, then **New repository** (name it `lifeline-ice`, Public).
2. Click **uploading an existing file**, drag in everything from the unzipped folder (including the `netlify` and `icons` folders), and press **Commit changes**.
3. Get a free Gemini key at https://aistudio.google.com/apikey (Create API key).
4. In Netlify: **Add new project**, **Import an existing project**, GitHub, choose `lifeline-ice`. Leave the build settings empty and press **Deploy**.
5. In the project: **Project configuration**, **Environment variables**, **Add a variable**: key `GEMINI_API_KEY`, value your key. Then **Deploys**, **Trigger deploy**.
6. Open the site on your phone and press **Pin to lock screen**.

If **Install app** only shows steps: that is normal on iPhone, in Firefox and inside Instagram or WhatsApp's built-in browser. Open the site in Chrome (Android) or Safari (iPhone) and follow the steps.

After you change any file, also change `VERSION` at the top of `sw.js` (for example `lifeline-v4.1.1`), so phones that installed the app fetch the new version.

## Try it on your phone

1. Open the site, go to **My info**, fill in your details (contacts with `+91`).
2. **Home**: press **Pin to lock screen** and allow notifications. Lock the phone and look.
3. Hold **SOS** for 2 seconds (it only prepares messages; nothing is sent until you press Send).
4. Scan the QR with another phone to see the responder page. Try "Can I give paracetamol?" and switch the language.

## Privacy

Details stay in your browser (`localStorage`) and inside your own QR link. The Netlify function only passes AI questions to Gemini; it stores nothing. Gemini's free tier may use requests to improve Google's products, so this is a student project, not a certified medical device.
