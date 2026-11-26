/* =========================================================
   Lifeline ICE: app.js
   Plain JavaScript, no frameworks. AI requests go through
   ai.js (window.AI). The service worker is sw.js.

   The page has two modes:
   - Owner app: you edit your info, pin it to the lock screen,
     use SOS and share your QR code.
   - Responder page: opened from the QR code or the lock-screen
     card. The details travel inside the link after "#id=",
     so they never reach a server.

    1. Settings and example data
    2. Small helpers
    3. People (profiles) and saving
    4. Packing details into a link
    5. Responder page (shared by preview and the real page)
    6. Responder tools: read aloud, translate, ask AI
    7. Owner app: form
    8. Owner app: home (readiness, QR, built-in ID)
    9. Lock-screen card (notifications)
   10. SOS and siren
   11. AI: scan a prescription, check my info
   12. Install, print, backup
   13. Startup
   ========================================================= */
'use strict';

/* ---------- 1. Settings and example data ---------- */

const STORE_KEY = 'ice-card:v2'; // same key as the old ICE Card Maker, so details carry over
const MAX_CONTACTS = 3;
const MAX_PEOPLE = 8;
const SOS_HOLD_MS = 2000;

const TEXT_FIELDS = ['name', 'dob', 'blood', 'country', 'allergies', 'conditions', 'medications', 'notes', 'doctorName', 'doctorPhone'];

const COUNTRIES = {
  // 112 is India's single emergency number (police, fire, ambulance).
  // The older direct numbers still work, so the app shows them too.
  IN: { name: 'India', number: '112', more: [['Ambulance', '108'], ['Police', '100'], ['Fire', '101']] },
  US: { name: 'United States / Canada', number: '911' },
  GB: { name: 'United Kingdom', number: '999' },
  EU: { name: 'European Union', number: '112' },
  AU: { name: 'Australia', number: '000' },
  NZ: { name: 'New Zealand', number: '111' },
  SG: { name: 'Singapore', number: '995' },
  AE: { name: 'United Arab Emirates', number: '998' },
};

// Languages a responder can switch the page into (code -> name)
const LANGUAGES = {
  en: 'English', hi: 'हिन्दी (Hindi)', bn: 'বাংলা (Bengali)', mr: 'मराठी (Marathi)', ta: 'தமிழ் (Tamil)',
  te: 'తెలుగు (Telugu)', kn: 'ಕನ್ನಡ (Kannada)', ml: 'മലയാളം (Malayalam)', gu: 'ગુજરાતી (Gujarati)',
  pa: 'ਪੰਜਾਬੀ (Punjabi)', es: 'Español', fr: 'Français', de: 'Deutsch', zh: '中文', ja: '日本語', ar: 'العربية', ur: 'اردو',
};
const RTL = ['ar', 'ur'];

// Every fixed label on the responder page, in English
const LABELS_EN = {
  medicalId: 'Medical ID',
  call: 'Call',
  callEmergency: 'Call emergency services',
  blood: 'Blood group',
  age: 'Age',
  allergies: 'Allergies',
  noAllergies: 'No known allergies listed',
  conditions: 'Medical conditions',
  medications: 'Medications',
  notes: 'Notes for responders',
  contacts: 'Emergency contacts',
  doctor: 'Doctor',
  donor: 'Registered organ donor',
  tellFamily: 'Tell their family where they are',
  readAloud: 'Read aloud',
  stop: 'Stop',
  askTitle: 'Ask the first-aid helper',
  askHint: 'Answers use the details on this page. Always call emergency services first if life is at risk.',
  askPlaceholder: 'e.g. Can I give them paracetamol?',
  ask: 'Ask',
  updated: 'Details written by the person on',
};

// Quick questions offered to a responder
const ASK_CHIPS = [
  'What should I do first?',
  'Can I give paracetamol or ibuprofen?',
  'They are having trouble breathing',
  'They have collapsed and are not responding',
];

function emptyData() {
  return {
    name: '', dob: '', blood: '', country: 'IN', organDonor: false,
    allergies: '', conditions: '', medications: '',
    notes: '', doctorName: '', doctorPhone: '',
    contacts: [{ name: '', relation: '', phone: '' }],
    updated: '',
  };
}

function exampleData() {
  return {
    ...emptyData(),
    name: 'Riya Sharma',
    dob: '2004-03-12',
    blood: 'O+',
    organDonor: true,
    allergies: 'Penicillin, peanuts',
    conditions: 'Asthma (mild)',
    medications: 'Salbutamol inhaler as needed',
    notes: 'Inhaler is in the front pocket of my backpack\nSevere peanut allergy: EpiPen in the side pocket of my bag',
    doctorName: 'Dr. Meera Iyer',
    doctorPhone: '+91 80 4123 4567',
    contacts: [
      { name: 'Anita Sharma', relation: 'Mother', phone: '+91 98765 43210' },
      { name: 'Dev Kapoor', relation: 'Friend', phone: '+91 91234 56789' },
    ],
    updated: todayIso(),
  };
}

/* ---------- 2. Small helpers ---------- */

const $ = (id) => document.getElementById(id);

/** Creates an element. Text always goes in with textContent, so user input can never become HTML. */
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  Object.entries(props).forEach(([key, value]) => {
    if (value === undefined || value === null || value === false) return;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  });
  children.flat().forEach((child) => {
    if (child === null || child === undefined || child === false) return;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  });
  return node;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function splitList(text) {
  return String(text || '').split(/,|\n/).map((s) => s.trim()).filter(Boolean);
}

function noteLines(text) {
  return String(text || '').split('\n').map((s) => s.trim()).filter(Boolean);
}

function filledContacts(data) {
  return (data.contacts || []).filter((c) => c.name || c.phone);
}

function ageFrom(dob) {
  if (!dob) return '';
  const born = new Date(dob + 'T00:00:00');
  if (Number.isNaN(born.getTime())) return '';
  const now = new Date();
  let age = now.getFullYear() - born.getFullYear();
  if (now < new Date(now.getFullYear(), born.getMonth(), born.getDate())) age--;
  return age >= 0 && age < 130 ? String(age) : '';
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function emergencyNumber(data) {
  return (COUNTRIES[data.country] || COUNTRIES.IN).number;
}

/** Small call buttons for a country's other numbers, e.g. ambulance 108 in India. */
function otherNumbers(data) {
  const more = (COUNTRIES[data.country] || COUNTRIES.IN).more || [];
  return more.map(([label, num]) => el('a', { class: 'num-btn', href: `tel:${num}`, 'aria-label': `Call ${label} ${num}` }, label, ' ', el('strong', { text: num })));
}

function telHref(phone) {
  return 'tel:' + String(phone || '').replace(/[^\d+]/g, '');
}

/** wa.me needs digits only, with the country code and no plus sign. */
function whatsappHref(phone, text) {
  const digits = String(phone || '').replace(/\D/g, '');
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

/** "sms:...?&body=" opens the message app with text on both Android and iPhone. */
function smsHref(phones, text) {
  const list = (Array.isArray(phones) ? phones : [phones]).map((p) => String(p).replace(/[^\d+]/g, '')).filter(Boolean);
  return `sms:${list.join(',')}?&body=${encodeURIComponent(text)}`;
}

let toastTimer;
function toast(text) {
  const box = $('toast');
  box.textContent = text;
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { box.hidden = true; }, 3200);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    // Older browsers and some embedded frames: fall back to a hidden textarea
    const area = el('textarea', { class: 'visually-hidden' });
    area.value = text;
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    area.remove();
    return ok;
  }
}

// Inside a claude.ai artifact the page runs in a sandboxed frame: no
// service worker, notifications or real links. We detect that and explain.
let isEmbedded;
try { isEmbedded = window.self !== window.top; } catch (err) { isEmbedded = true; }
const isClaudePreview = Boolean(window.claude && typeof window.claude.use === 'function');
const isHosted = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
const canLink = isHosted && !isClaudePreview;

const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

/* ---------- 3. People (profiles) and saving ---------- */
// store = { activeId, isExample, people: [{ id, data, pinned }] }

let store;

function newId() {
  return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function normalizeData(input) {
  const data = emptyData();
  if (!input || typeof input !== 'object') return data;
  TEXT_FIELDS.concat('updated').forEach((key) => {
    if (typeof input[key] === 'string') data[key] = input[key].slice(0, 400);
  });
  if (!COUNTRIES[data.country]) data.country = 'IN';
  data.organDonor = input.organDonor === true;
  if (Array.isArray(input.contacts) && input.contacts.length) {
    data.contacts = input.contacts.slice(0, MAX_CONTACTS).map((c) => ({
      name: String((c && c.name) || '').slice(0, 40),
      relation: String((c && c.relation) || '').slice(0, 24),
      phone: String((c && c.phone) || '').slice(0, 24),
    }));
  }
  return data;
}

function newPerson(data) {
  return { id: newId(), data: normalizeData(data), pinned: false };
}

function activePerson() {
  return store.people.find((p) => p.id === store.activeId) || store.people[0];
}

function loadStore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      if (Array.isArray(saved.people) && saved.people.length) {
        const people = saved.people.slice(0, MAX_PEOPLE).map((p) => ({
          id: typeof p.id === 'string' ? p.id : newId(),
          data: normalizeData(p.data),
          pinned: p.pinned === true,
        }));
        return { activeId: saved.activeId, isExample: false, people };
      }
    }
  } catch (err) { /* fall back to the example */ }
  return null;
}

function exampleStore() {
  const person = newPerson(exampleData());
  return { activeId: person.id, isExample: true, people: [person] };
}

let saveTimer;
function scheduleSave() {
  if (store.isExample) return;
  setSaveStatus('Saving…');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 400);
}

function saveNow() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ activeId: store.activeId, people: store.people }));
    setSaveStatus('Saved on this device');
  } catch (err) {
    setSaveStatus('Could not save: your browser is blocking storage.', true);
  }
}

function setSaveStatus(text, isError = false) {
  const status = $('save-status');
  status.textContent = text;
  status.classList.toggle('is-error', isError);
}

/** The first real edit turns the example into the user's own saved person. */
function leaveExample() {
  if (!store.isExample) return;
  store.isExample = false;
  $('example-banner').hidden = true;
}

/* ---------- 4. Packing details into a link ---------- */
// The link looks like https://your-site.netlify.app/#id=z<data>
// <data> is the details as short JSON, compressed and base64url encoded,
// which keeps the QR code small enough to scan easily.

function packData(d) {
  const p = {
    n: d.name, d: d.dob, b: d.blood, c: d.country, o: d.organDonor ? 1 : 0,
    a: d.allergies, k: d.conditions, m: d.medications, x: d.notes,
    dn: d.doctorName, dp: d.doctorPhone,
    ct: filledContacts(d).map((c) => [c.name, c.relation, c.phone]),
    u: d.updated,
  };
  Object.keys(p).forEach((k) => { if (!p[k] || (Array.isArray(p[k]) && !p[k].length)) delete p[k]; });
  return p;
}

function unpackData(p) {
  return normalizeData({
    name: p.n, dob: p.d, blood: p.b, country: p.c, organDonor: p.o === 1,
    allergies: p.a, conditions: p.k, medications: p.m, notes: p.x,
    doctorName: p.dn, doctorPhone: p.dp, updated: p.u,
    contacts: Array.isArray(p.ct) ? p.ct.map((c) => ({ name: c[0], relation: c[1], phone: c[2] })) : [],
  });
}

function bytesToB64url(bytes) {
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlToBytes(text) {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function streamBytes(bytes, stream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

/** "z" + compressed data when the browser can compress, otherwise "j" + plain data. */
async function encodeData(data) {
  const bytes = new TextEncoder().encode(JSON.stringify(packData(data)));
  if ('CompressionStream' in window) {
    try { return 'z' + bytesToB64url(await streamBytes(bytes, new CompressionStream('deflate-raw'))); } catch (err) { /* fall through */ }
  }
  return 'j' + bytesToB64url(bytes);
}

async function decodeData(code) {
  let bytes = b64urlToBytes(code.slice(1));
  if (code[0] === 'z') bytes = await streamBytes(bytes, new DecompressionStream('deflate-raw'));
  return unpackData(JSON.parse(new TextDecoder().decode(bytes)));
}

function siteBase() {
  return location.origin + location.pathname.replace(/index\.html$/, '');
}

async function responderLink(data) {
  return `${siteBase()}#id=${await encodeData(data)}`;
}

/** Plain-text version: used for the QR when there is no website yet, and for copying. */
function plainText(data) {
  const lines = [`MEDICAL ID: ${data.name || 'Unnamed'}`];
  if (data.blood) lines.push(`Blood group: ${data.blood}`);
  if (data.dob) lines.push(`Born: ${formatDate(data.dob)}`);
  lines.push(`Allergies: ${data.allergies || 'none listed'}`);
  if (data.conditions) lines.push(`Conditions: ${data.conditions}`);
  if (data.medications) lines.push(`Medications: ${data.medications}`);
  noteLines(data.notes).forEach((n) => lines.push(`Note: ${n}`));
  filledContacts(data).forEach((c) => lines.push(`ICE: ${[c.name, c.relation && `(${c.relation})`, c.phone].filter(Boolean).join(' ')}`));
  if (data.doctorName || data.doctorPhone) lines.push(`Doctor: ${[data.doctorName, data.doctorPhone].filter(Boolean).join(' ')}`);
  if (data.organDonor) lines.push('Registered organ donor');
  lines.push(`Emergency: call ${emergencyNumber(data)}`);
  return lines.join('\n');
}

/* ---------- 5. Responder page ---------- */
// renderResponder() draws the page into any container. The owner's
// preview and the real page opened from a QR code use the same code.

/**
 * @param {HTMLElement} root
 * @param {object} data   normalized details
 * @param {object} opts   { mini: true } for the small preview in the editor
 */
function renderResponder(root, data, opts = {}) {
  const state = root._rv || (root._rv = { lang: 'en', labels: LABELS_EN, values: null });
  const L = state.labels;
  const V = state.values || {};
  const number = emergencyNumber(data);
  const contacts = filledContacts(data);
  const allergies = V.allergies || data.allergies;
  const age = ageFrom(data.dob);

  const section = (title, body, cls = '') => body ? el('section', { class: 'rv-sec ' + cls }, el('h3', { text: title }), body) : null;
  const chips = (text) => {
    const items = splitList(text);
    return items.length ? el('ul', { class: 'rv-chips' }, items.map((t) => el('li', { text: t }))) : null;
  };

  const page = el('div', { class: 'rv' + (opts.mini ? ' rv-mini' : ''), dir: RTL.includes(state.lang) ? 'rtl' : 'ltr', lang: state.lang },
    el('header', { class: 'rv-head' },
      el('div', { class: 'rv-id' },
        el('p', { class: 'rv-kicker' },
          el('span', { class: 'rv-cross', 'aria-hidden': 'true' }), L.medicalId),
        el('h2', { class: 'rv-name', text: data.name || '—' }),
        el('p', { class: 'rv-meta', text: [age && `${L.age} ${age}`, data.organDonor && L.donor].filter(Boolean).join(' · ') }),
      ),
      el('div', { class: 'rv-blood' }, el('span', { text: L.blood }), el('strong', { text: data.blood || '?' })),
    ),

    el('a', { class: 'btn btn-call btn-block rv-sos', href: `tel:${number}` },
      `${L.callEmergency} · ${number}`),
    el('div', { class: 'other-numbers' }, otherNumbers(data)),

    el('section', { class: 'rv-alert' + (allergies ? '' : ' is-none') },
      el('h3', { text: L.allergies }),
      allergies ? chips(allergies) : el('p', { text: L.noAllergies }),
    ),

    section(L.conditions, chips(V.conditions || data.conditions)),
    section(L.medications, chips(V.medications || data.medications)),
    section(L.notes, (() => {
      const lines = V.notes && V.notes.length ? V.notes : noteLines(data.notes);
      return lines.length ? el('ul', { class: 'rv-notes' }, lines.map((n) => el('li', { text: n }))) : null;
    })()),

    section(L.contacts, contacts.length ? el('ul', { class: 'rv-contacts' }, contacts.map((c, i) =>
      el('li', {},
        el('div', {}, el('strong', { text: c.name || c.phone }),
          el('span', { text: [(V.relations && V.relations[i]) || c.relation, c.phone].filter(Boolean).join(' · ') })),
        c.phone ? el('div', { class: 'rv-contact-btns' },
          el('a', { class: 'btn btn-small btn-primary', href: telHref(c.phone) }, L.call),
          el('a', { class: 'btn btn-small btn-ghost', href: whatsappHref(c.phone, `Hello, I am with ${data.name || 'someone'} who listed you as an emergency contact.`), target: '_blank', rel: 'noopener' }, 'WhatsApp'),
        ) : null,
      ))) : null),

    (data.doctorName || data.doctorPhone) ? section(L.doctor, el('p', { class: 'rv-doctor' },
      el('span', { text: data.doctorName }),
      data.doctorPhone ? el('a', { href: telHref(data.doctorPhone), text: data.doctorPhone }) : null)) : null,
  );

  if (!opts.mini) {
    // Tools: tell family, read aloud, language
    const langSelect = el('select', { 'aria-label': 'Language', class: 'rv-lang' },
      Object.entries(LANGUAGES).map(([code, name]) => el('option', { value: code, text: name, selected: code === state.lang })));
    langSelect.addEventListener('change', () => translateResponder(root, data, langSelect.value));

    page.append(
      contacts.some((c) => c.phone) ? el('button', { type: 'button', class: 'btn btn-ghost btn-block', onclick: () => openSheet('found', data) }, L.tellFamily) : null,
      el('div', { class: 'rv-tools' },
        el('button', { type: 'button', class: 'btn btn-ghost btn-small rv-speak', onclick: (e) => readAloud(root, data, e.currentTarget) }, '🔊 ' + L.readAloud),
        el('label', { class: 'rv-lang-wrap' }, el('span', { class: 'ai-pill' }, 'AI'), langSelect),
      ),
      el('p', { class: 'hint rv-tstatus', 'aria-live': 'polite', text: state.status || '' }),
      askBox(root, data),
      el('p', { class: 'rv-foot', text: data.updated ? `${L.updated} ${formatDate(data.updated)}.` : '' }),
    );
  }

  root.replaceChildren(page);
}

/** The "Ask the first-aid helper" box at the bottom of the responder page. */
function askBox(root, data) {
  const L = root._rv.labels;
  const input = el('input', { type: 'text', maxlength: '300', placeholder: L.askPlaceholder, 'aria-label': L.askTitle });
  const answer = el('div', { class: 'ask-answer', 'aria-live': 'polite' });
  if (root._rv.lastAnswer) answer.append(root._rv.lastAnswer);
  const form = el('form', { class: 'ask-form' }, input, el('button', { type: 'submit', class: 'btn btn-ai' }, L.ask));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (input.value.trim()) askHelper(root, data, input.value.trim(), answer);
  });

  return el('section', { class: 'ask' },
    el('h3', {}, el('span', { class: 'ai-pill' }, 'AI'), ' ', L.askTitle),
    el('p', { class: 'hint', text: L.askHint }),
    el('div', { class: 'ask-chips' }, ASK_CHIPS.map((q) =>
      el('button', { type: 'button', class: 'chip', onclick: () => { input.value = q; askHelper(root, data, q, answer); } }, q))),
    form,
    answer,
  );
}

/* ---------- 6. Responder tools ---------- */

/** Reads the page out loud, so someone can listen while helping. */
function readAloud(root, data, button) {
  if (!('speechSynthesis' in window)) { toast('Reading aloud is not supported in this browser.'); return; }
  if (speechSynthesis.speaking) { speechSynthesis.cancel(); return; }

  const L = root._rv.labels;
  const V = root._rv.values || {};
  const parts = [
    `${L.medicalId}: ${data.name}.`,
    data.blood && `${L.blood}: ${data.blood}.`,
    `${L.allergies}: ${(V.allergies || data.allergies) || L.noAllergies}.`,
    (V.conditions || data.conditions) && `${L.conditions}: ${V.conditions || data.conditions}.`,
    (V.medications || data.medications) && `${L.medications}: ${V.medications || data.medications}.`,
    ...((V.notes && V.notes.length ? V.notes : noteLines(data.notes))),
  ].filter(Boolean);

  const speech = new SpeechSynthesisUtterance(parts.join(' '));
  speech.lang = root._rv.lang;
  speech.rate = 0.95;
  const label = button.textContent;
  button.textContent = '■ ' + L.stop;
  speech.onend = speech.onerror = () => { button.textContent = label; };
  speechSynthesis.speak(speech);
}

/** Translates the whole responder page into the responder's language with AI. */
async function translateResponder(root, data, lang) {
  const state = root._rv;
  if (lang === 'en') {
    Object.assign(state, { lang: 'en', labels: LABELS_EN, values: null, status: '' });
    renderResponder(root, data);
    return;
  }
  if (AI.mode() === 'off') {
    state.status = AI.describeError({ code: 'off' });
    renderResponder(root, data);
    return;
  }

  state.status = `Translating into ${LANGUAGES[lang]}…`;
  root.querySelector('.rv-tstatus').textContent = state.status;

  const source = {
    labels: LABELS_EN,
    values: {
      allergies: data.allergies, conditions: data.conditions, medications: data.medications,
      notes: noteLines(data.notes), relations: filledContacts(data).map((c) => c.relation || ''),
    },
  };
  const prompt = `Translate this emergency medical page into ${LANGUAGES[lang]} (language code "${lang}").
Rules:
- Translate every string value. Keep every key and every array length exactly the same.
- Keep medicine names as written (pharmacists recognise them), but translate words like "twice daily".
- Use plain everyday words a bystander would understand. Keep empty strings empty.
Reply with only JSON in the same shape as this input:
${JSON.stringify(source)}`;

  try {
    const result = await AI.askJson(prompt);
    if (!result || typeof result.labels !== 'object' || typeof result.values !== 'object') throw { code: 'invalid_json' };
    const labels = { ...LABELS_EN };
    Object.keys(LABELS_EN).forEach((k) => {
      if (typeof result.labels[k] === 'string' && result.labels[k]) labels[k] = result.labels[k].slice(0, 120);
    });
    const values = {};
    ['allergies', 'conditions', 'medications'].forEach((k) => {
      if (typeof result.values[k] === 'string') values[k] = result.values[k].slice(0, 400);
    });
    ['notes', 'relations'].forEach((k) => {
      if (Array.isArray(result.values[k])) values[k] = result.values[k].map(String).slice(0, 10);
    });
    Object.assign(state, { lang, labels, values, status: '' });
  } catch (err) {
    state.status = AI.describeError(err);
  }
  renderResponder(root, data);
}

/** AI first-aid helper, grounded on this person's details. */
async function askHelper(root, data, question, answerBox) {
  const number = emergencyNumber(data);
  if (AI.mode() === 'off') {
    answerBox.replaceChildren(el('p', { class: 'ask-error', text: `${AI.describeError({ code: 'off' })} If this is an emergency, call ${number} now.` }));
    return;
  }
  answerBox.replaceChildren(el('p', { class: 'ask-wait', text: 'Thinking…' }));

  const lang = LANGUAGES[root._rv.lang] || 'English';
  const prompt = `You are a calm first-aid helper on a medical ID page. The person reading is a bystander or first responder who is with the patient right now.

Patient's medical ID (written by the patient):
${plainText(data)}

Their question: "${question.slice(0, 300)}"

Rules:
- Answer in ${lang}, in plain words a stressed non-expert can follow.
- Use the medical ID above. If giving a medicine is asked about, check it against the listed allergies, conditions and medications and say clearly if it conflicts. If the ID does not say, say so.
- Never diagnose. Do not give drug doses beyond "follow the packet" or the person's own listed prescription.
- If anything suggests danger to life (not breathing, unresponsive, chest pain, severe bleeding, anaphylaxis or swelling of face or throat, seizure over 5 minutes, stroke signs), set urgent to true and make the first step "Call ${number} now".
- At most 5 short steps.

Reply with only JSON:
{"urgent": true or false, "answer": "one or two sentences", "steps": ["short step", "..."], "fromCard": ["facts from the medical ID you relied on"]}`;

  try {
    const r = await AI.askJson(prompt);
    const steps = Array.isArray(r && r.steps) ? r.steps.map(String).filter(Boolean).slice(0, 6) : [];
    const facts = Array.isArray(r && r.fromCard) ? r.fromCard.map(String).filter(Boolean).slice(0, 4) : [];
    if (!r || (!r.answer && !steps.length)) throw { code: 'invalid_json' };
    const block = el('div', { class: 'ask-reply' + (r.urgent ? ' is-urgent' : '') },
      r.urgent ? el('a', { class: 'btn btn-call btn-block', href: `tel:${number}` }, `Call ${number} now`) : null,
      el('p', { class: 'ask-q', text: question }),
      r.answer ? el('p', { text: String(r.answer) }) : null,
      steps.length ? el('ol', {}, steps.map((s) => el('li', { text: s }))) : null,
      facts.length ? el('p', { class: 'ask-facts', text: 'Based on: ' + facts.join(' · ') }) : null,
      el('p', { class: 'ask-disclaimer', text: 'AI guidance, not a doctor. Emergency services come first.' }),
    );
    root._rv.lastAnswer = block;
    answerBox.replaceChildren(block);
  } catch (err) {
    answerBox.replaceChildren(el('p', { class: 'ask-error', text: `${AI.describeError(err)} If this is an emergency, call ${number} now.` }));
  }
}

/** Shows the page someone sees after scanning the QR code. */
async function startResponderPage(code) {
  document.title = 'Medical ID · Lifeline';
  const root = $('responder-app');
  root.hidden = false;
  document.body.classList.add('is-responder');
  try {
    const data = await decodeData(code);
    document.title = `Medical ID: ${data.name || 'Unnamed'}`;
    renderResponder(root, data);
    AI.onChange(() => {}); // nothing to redraw: AI is checked when used
    root.append(el('p', { class: 'rv-brand' },
      'Made with Lifeline ICE · ', el('a', { href: siteBase(), text: 'Make your own medical ID' })));
  } catch (err) {
    root.replaceChildren(el('div', { class: 'rv rv-broken' },
      el('h2', { text: 'This medical ID link is damaged' }),
      el('p', { text: 'Part of the link is missing. Call your local emergency number if someone needs help.' }),
      el('a', { class: 'btn btn-call btn-block', href: 'tel:112' }, 'Call 112'),
    ));
  }
}

/* ---------- 7. Owner app: form ---------- */

const contactsBox = $('contacts');

function readForm() {
  const data = emptyData();
  TEXT_FIELDS.forEach((key) => { data[key] = $('f-' + key).value.trim(); });
  data.organDonor = $('f-donor').checked;
  data.contacts = [...contactsBox.querySelectorAll('.contact')].map((row) => ({
    name: row.querySelector('[data-field="name"]').value.trim(),
    relation: row.querySelector('[data-field="relation"]').value.trim(),
    phone: row.querySelector('[data-field="phone"]').value.trim(),
  }));
  data.updated = todayIso();
  return data;
}

function fillForm(data) {
  TEXT_FIELDS.forEach((key) => { $('f-' + key).value = data[key] || ''; });
  $('f-donor').checked = data.organDonor;
  renderContactRows(data.contacts);
}

function renderContactRows(contacts) {
  contactsBox.replaceChildren();
  contacts.forEach((c, i) => {
    const row = $('contact-template').content.firstElementChild.cloneNode(true);
    row.querySelector('.contact-label').textContent = `Contact ${i + 1}`;
    row.querySelectorAll('input').forEach((input) => {
      const id = `c${i}-${input.dataset.field}`;
      input.id = id;
      input.previousElementSibling.htmlFor = id;
      input.value = c[input.dataset.field] || '';
    });
    row.querySelector('.remove-contact').hidden = contacts.length === 1;
    row.querySelector('.remove-contact').addEventListener('click', () => {
      const list = readForm().contacts;
      list.splice(i, 1);
      renderContactRows(list);
      onUserEdit();
    });
    contactsBox.appendChild(row);
  });
  $('add-contact').hidden = contacts.length >= MAX_CONTACTS;
}

function buildCountrySelect() {
  const select = $('f-country');
  Object.entries(COUNTRIES).forEach(([code, c]) => select.append(el('option', { value: code, text: `${c.name} (${c.number})` })));
}

function onUserEdit() {
  leaveExample();
  activePerson().data = readForm();
  scheduleSave();
  refresh();
}

function renderPeople() {
  const box = $('people');
  box.replaceChildren(
    ...store.people.map((p) => el('button', {
      type: 'button', role: 'tab', class: 'person' + (p.id === store.activeId ? ' is-on' : ''),
      'aria-selected': String(p.id === store.activeId),
      onclick: () => switchPerson(p.id),
    }, el('span', { class: 'avatar', text: (p.data.name || '?').trim().charAt(0).toUpperCase() || '?' }),
      p.data.name ? p.data.name.split(' ')[0] : 'New person',
      p.pinned ? el('span', { class: 'pin-dot', title: 'On lock screen' }) : null)),
  );
  box.hidden = store.people.length < 2;
  $('add-person').hidden = store.people.length >= MAX_PEOPLE;
  $('delete-person').hidden = store.people.length < 2;
}

function switchPerson(id) {
  store.activeId = id;
  fillForm(activePerson().data);
  scheduleSave();
  refresh();
}

function addPerson() {
  leaveExample();
  const person = newPerson(emptyData());
  person.data.country = activePerson().data.country;
  store.people.push(person);
  switchPerson(person.id);
  showView('edit');
  $('f-name').focus();
}

let deleteArmed = false;
function deletePerson() {
  const button = $('delete-person');
  if (!deleteArmed) {
    deleteArmed = true;
    button.textContent = 'Press again to delete';
    setTimeout(() => { deleteArmed = false; button.textContent = 'Delete this person'; }, 3000);
    return;
  }
  const person = activePerson();
  if (person.pinned) unpinCard(person);
  store.people = store.people.filter((p) => p.id !== person.id);
  deleteArmed = false;
  button.textContent = 'Delete this person';
  switchPerson(store.people[0].id);
}

/* ---------- 8. Owner app: home ---------- */

let currentView = 'home';
function showView(name) {
  currentView = name;
  document.querySelectorAll('.tab').forEach((tab) => {
    const on = tab.dataset.view === name;
    tab.classList.toggle('is-on', on);
    if (on) tab.setAttribute('aria-current', 'page'); else tab.removeAttribute('aria-current');
  });
  ['home', 'edit', 'preview'].forEach((v) => { $('view-' + v).hidden = v !== name; });
  window.scrollTo({ top: 0 });
  refresh();
}

/** Redraws everything that depends on the current person. */
function refresh() {
  const person = activePerson();
  const data = person.data;
  const number = emergencyNumber(data);

  renderPeople();
  $('home-call').textContent = `Call ${number}`;
  $('home-call').href = `tel:${number}`;
  $('sheet-call').textContent = `Call ${number}`;
  $('sheet-call').href = `tel:${number}`;
  $('home-numbers').replaceChildren(...otherNumbers(data));
  $('sheet-numbers').replaceChildren(...otherNumbers(data));
  $('example-banner').hidden = !store.isExample;

  renderReadiness(person);
  renderLockPreview(person);
  renderQr(data);

  if (currentView === 'edit') renderResponder($('mini-preview'), data, { mini: true });
  if (currentView === 'preview') renderResponder($('owner-preview'), data);

  if (person.pinned) schedulePinUpdate();
}

function renderReadiness(person) {
  const d = person.data;
  const contacts = filledContacts(d);
  const checks = [
    { ok: Boolean(d.name && d.blood), text: 'Name and blood group', go: 'edit' },
    { ok: Boolean(d.allergies || d.conditions || d.medications), text: 'Allergies, conditions or medications', go: 'edit' },
    { ok: contacts.some((c) => /\+/.test(c.phone)), text: 'A contact with a country code (+91…)', go: 'edit' },
    { ok: person.pinned && notifPermission() === 'granted', text: 'Pinned to your lock screen', go: 'pin' },
    { ok: isInstalled(), text: 'Installed as an app (works offline)', go: 'install' },
  ];
  const done = checks.filter((c) => c.ok).length;
  const score = Math.round((done / checks.length) * 100);
  $('ready-score').textContent = `${score}%`;
  $('ready-score').dataset.level = score === 100 ? 'full' : score >= 60 ? 'mid' : 'low';
  $('ready-bar').style.width = `${score}%`;
  $('ready-list').replaceChildren(...checks.map((c) => el('li', { class: c.ok ? 'is-done' : '' },
    el('span', { class: 'tick', 'aria-hidden': 'true', text: c.ok ? '✓' : '' }),
    el('span', { text: c.text }),
    c.ok ? el('span', { class: 'visually-hidden', text: ' (done)' }) : el('button', {
      type: 'button', class: 'link-btn',
      onclick: () => {
        if (c.go === 'edit') showView('edit');
        else if (c.go === 'install') { $('install-title').scrollIntoView({ behavior: 'smooth', block: 'center' }); installApp(); }
        else $('lock-title').scrollIntoView({ behavior: 'smooth', block: 'center' });
      },
    }, 'Fix'))));
}

let qrText = '';
async function renderQr(data) {
  const text = canLink ? await responderLink(data) : plainText(data);
  if (text === qrText) return;
  qrText = text;
  $('qr-explain').textContent = canLink
    ? 'Anyone who scans this gets a live page with your details, one-tap calls to your contacts and an AI first-aid helper. Your details are inside the link itself, so they are never stored on a server.'
    : 'In this preview the QR holds your details as plain text. Once the site is on Netlify, it opens a live responder page with tap-to-call and the AI helper.';
  drawQr($('qr'), text);
}

function drawQr(canvas, text) {
  if (typeof qrcode !== 'function') return;
  const qr = qrcode(0, 'M');
  qr.addData(unescape(encodeURIComponent(text))); // UTF-8 bytes, so any language scans correctly
  qr.make();
  const count = qr.getModuleCount();
  const ctx = canvas.getContext('2d');
  const size = canvas.width;
  const quiet = 4;
  const cell = size / (count + quiet * 2);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#0f1b2d';
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (qr.isDark(r, c)) ctx.fillRect(Math.floor((c + quiet) * cell), Math.floor((r + quiet) * cell), Math.ceil(cell), Math.ceil(cell));
    }
  }
}

/* ---------- 9. Lock-screen card (notifications) ---------- */
// A notification shown by the service worker with requireInteraction
// stays until it is dismissed, and phones show it on the lock screen.

function notifPermission() {
  return 'Notification' in window ? Notification.permission : 'unsupported';
}

function notificationFor(person, link) {
  const d = person.data;
  const first = filledContacts(d).find((c) => c.phone);
  const lines = [
    [d.blood && `Blood ${d.blood}`, d.allergies ? `ALLERGIC: ${d.allergies}` : 'No known allergies'].filter(Boolean).join(' · '),
    [d.conditions, d.medications].filter(Boolean).join(' · '),
    first ? `ICE: ${first.name}${first.relation ? ` (${first.relation})` : ''} ${first.phone}` : '',
  ].filter(Boolean);
  return {
    title: `✚ Medical ID: ${d.name || 'Unnamed'}`,
    options: {
      body: lines.join('\n'),
      tag: 'lifeline-' + person.id,
      requireInteraction: true,
      silent: true,
      renotify: false,
      icon: 'icons/icon-192.png',
      badge: 'icons/badge-96.png',
      data: { url: link, call: first ? telHref(first.phone) : '' },
      actions: [
        first ? { action: 'call', title: `Call ${first.name.split(' ')[0] || 'contact'}` } : null,
        { action: 'open', title: 'Full medical ID' },
      ].filter(Boolean),
    },
  };
}

function renderLockPreview(person) {
  const n = notificationFor(person, '');
  $('notif-title').textContent = n.title;
  $('notif-body').textContent = n.options.body;
  const first = filledContacts(person.data).find((c) => c.phone);
  $('notif-act1').textContent = first ? `Call ${first.name.split(' ')[0] || 'contact'}` : 'Call';
  $('notif-act1').hidden = !first;
  $('lock-time').textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M$/i, '');

  const on = person.pinned && notifPermission() === 'granted';
  $('lock-pill').textContent = on ? 'Pinned' : 'Off';
  $('lock-pill').classList.toggle('is-on', on);
  $('pin-btn').textContent = on ? 'Pin again' : 'Pin to lock screen';
  $('unpin-btn').hidden = !person.pinned;
}

/** Why pinning cannot work here, or '' when it can. */
function pinBlocker() {
  if (isClaudePreview || isEmbedded) return 'Lock-screen cards need the real website. Open your Netlify site on your phone to pin it.';
  if (!isHosted) return 'Lock-screen cards need https. Put the site on Netlify first (see the README).';
  if (isIos && !isStandalone) return 'On iPhone, first tap Share, then Add to Home Screen. Open Lifeline from the new icon and press Pin again.';
  if (!('serviceWorker' in navigator) || !('Notification' in window)) return 'This browser cannot show notifications. Try Chrome on Android, or Safari on iPhone after Add to Home Screen.';
  return '';
}

async function pinCard() {
  const person = activePerson();
  const note = $('lock-note');
  const blocker = pinBlocker();
  if (blocker) { note.textContent = blocker; return; }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    note.textContent = 'Notifications are blocked for this site. Allow them in your browser\'s site settings, then press Pin again.';
    return;
  }
  leaveExample();
  person.pinned = true;
  try {
    await showPinned(person);
  } catch (err) {
    person.pinned = false;
    note.textContent = 'This browser would not show the card. Check that notifications are allowed for this site, then press Pin again.';
    refresh();
    return;
  }
  saveNow();
  note.textContent = 'Pinned. Lock your phone to check it. If you cannot see it, open "Make sure it shows" below.';
  registerPeriodicRepin();
  refresh();
}

async function showPinned(person) {
  const reg = await navigator.serviceWorker.ready;
  const link = await responderLink(person.data);
  const n = notificationFor(person, link);
  await reg.showNotification(n.title, n.options);
  await savePinsForWorker();
}

async function unpinCard(person = activePerson()) {
  person.pinned = false;
  try {
    const reg = await navigator.serviceWorker.ready;
    (await reg.getNotifications({ tag: 'lifeline-' + person.id })).forEach((n) => n.close());
  } catch (err) { /* nothing was pinned */ }
  await savePinsForWorker();
  saveNow();
  $('lock-note').textContent = 'Removed from the lock screen.';
  refresh();
}

/** Keeps a copy of the pinned cards where the service worker can read them, so it can re-pin them later. */
async function savePinsForWorker() {
  if (!('caches' in window)) return;
  try {
    const pins = [];
    for (const p of store.people.filter((x) => x.pinned)) pins.push(notificationFor(p, await responderLink(p.data)));
    const cache = await caches.open('lifeline-pins');
    await cache.put('pins.json', new Response(JSON.stringify(pins), { headers: { 'content-type': 'application/json' } }));
  } catch (err) { /* storage blocked */ }
}

let pinTimer;
function schedulePinUpdate() {
  if (notifPermission() !== 'granted' || pinBlocker()) return;
  clearTimeout(pinTimer);
  pinTimer = setTimeout(() => {
    store.people.filter((p) => p.pinned).forEach((p) => showPinned(p).catch(() => {}));
  }, 1200);
}

/** Chrome on Android can wake the app about twice a day to re-pin the card if it was swiped away. */
async function registerPeriodicRepin() {
  try {
    const reg = await navigator.serviceWorker.ready;
    if ('periodicSync' in reg) await reg.periodicSync.register('lifeline-repin', { minInterval: 12 * 60 * 60 * 1000 });
  } catch (err) { /* not supported or not installed: re-pinning happens when the app opens */ }
}

/* ---------- 10. SOS and siren ---------- */

let holdTimer = null;
let holdStart = 0;
let holdFrame = 0;

function startHold(e) {
  if (e.button > 0) return;
  e.preventDefault();
  holdStart = performance.now();
  $('sos-btn').classList.add('is-holding');
  if (navigator.vibrate) navigator.vibrate(30);
  const ring = $('sos-ring');
  const tick = () => {
    const p = Math.min(1, (performance.now() - holdStart) / SOS_HOLD_MS);
    ring.style.strokeDashoffset = String(340 * (1 - p));
    $('sos-sub').textContent = p < 1 ? `${Math.ceil((SOS_HOLD_MS * (1 - p)) / 1000)}` : '';
    if (p < 1) holdFrame = requestAnimationFrame(tick);
  };
  holdFrame = requestAnimationFrame(tick);
  holdTimer = setTimeout(() => { endHold(); triggerSos(); }, SOS_HOLD_MS);
}

function endHold() {
  clearTimeout(holdTimer);
  cancelAnimationFrame(holdFrame);
  holdTimer = null;
  $('sos-btn').classList.remove('is-holding');
  $('sos-ring').style.strokeDashoffset = '340';
  $('sos-sub').textContent = 'Hold';
}

function triggerSos() {
  if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
  openSheet('sos', activePerson().data);
}

let sheetState = null;

/**
 * Opens the bottom sheet that sends a message with GPS location.
 * kind "sos":   the owner needs help.
 * kind "found": a responder is with the person and tells the family.
 */
async function openSheet(kind, data) {
  sheetState = { kind, data, position: null };
  const number = emergencyNumber(data);
  $('sheet-title').textContent = kind === 'sos' ? 'SOS: get help' : 'Tell their family';
  $('sheet-call').textContent = `Call ${number}`;
  $('sheet-call').href = `tel:${number}`;
  $('sheet-numbers').replaceChildren(...otherNumbers(data));
  $('sheet').hidden = false;
  document.body.classList.add('no-scroll');
  $('sheet-close').focus();
  renderSheet();
  locate();
}

function locate() {
  if (!('geolocation' in navigator)) {
    $('sheet-status').textContent = 'Location is not available on this device. The message is sent without it.';
    return;
  }
  $('sheet-status').textContent = 'Finding your location…';
  navigator.geolocation.getCurrentPosition((pos) => {
    sheetState.position = pos;
    $('sheet-status').textContent = `Location found, accurate to about ${Math.round(pos.coords.accuracy)} m.`;
    renderSheet();
  }, (err) => {
    $('sheet-status').textContent = err.code === 1
      ? 'Location permission was denied, so the message has no location. Allow location for this site to include it.'
      : 'Could not get a location fix. You can still send the message, or press Update location.';
    renderSheet();
  }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 });
}

async function sheetMessage() {
  const { kind, data, position } = sheetState;
  const time = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const where = position
    ? `Location (${time}, ±${Math.round(position.coords.accuracy)} m): https://maps.google.com/?q=${position.coords.latitude.toFixed(5)},${position.coords.longitude.toFixed(5)}`
    : `Location not available (${time}).`;
  const name = data.name || 'Someone';
  if (kind === 'sos') {
    const link = canLink ? `\nMy medical ID: ${await responderLink(data)}` : '';
    return `🆘 SOS from ${name}. I need help urgently.\n${where}${link}`;
  }
  return `Hello, this is a message about ${name}. I am with them and they need help. Emergency services have been or are being called.\n${where}`;
}

async function renderSheet() {
  const { data } = sheetState;
  const text = await sheetMessage();
  sheetState.text = text;
  // The preview hides the long medical ID link so the message stays readable
  $('sheet-msg').textContent = text.replace(/https?:\/\/\S+#id=\S+/, '[link to my medical ID]');
  const contacts = filledContacts(data).filter((c) => c.phone);
  const box = $('sheet-targets');
  if (!contacts.length) {
    box.replaceChildren(el('p', { class: 'note', text: 'No emergency contacts with phone numbers yet. Add them in My info.' }));
    return;
  }
  box.replaceChildren(
    ...contacts.map((c) => el('div', { class: 'target' },
      el('div', {}, el('strong', { text: c.name || c.phone }), el('span', { text: c.relation || c.phone })),
      el('div', { class: 'target-btns' },
        el('a', { class: 'btn btn-small btn-whatsapp', href: whatsappHref(c.phone, text), target: '_blank', rel: 'noopener' }, 'WhatsApp'),
        el('a', { class: 'btn btn-small btn-ghost', href: smsHref(c.phone, text) }, 'SMS'),
        el('a', { class: 'btn btn-small btn-ghost', href: telHref(c.phone), 'aria-label': `Call ${c.name}` }, 'Call'),
      ))),
    contacts.length > 1 ? el('a', { class: 'btn btn-primary btn-block', href: smsHref(contacts.map((c) => c.phone), text) }, 'Text everyone at once') : null,
  );
}

function closeSheet() {
  $('sheet').hidden = true;
  document.body.classList.remove('no-scroll');
}

async function shareSheet() {
  const text = sheetState.text || await sheetMessage();
  if (navigator.share) {
    try { await navigator.share({ text }); } catch (err) { /* user closed the share menu */ }
  } else if (await copyText(text)) {
    toast('Message copied. Paste it in any app.');
  }
}

// Siren: a loud rising tone and a flashing screen to attract attention
let siren = null;
async function startSiren() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const audio = new Ctx();
  const osc = audio.createOscillator();
  const lfo = audio.createOscillator();
  const lfoGain = audio.createGain();
  const gain = audio.createGain();
  osc.type = 'square';
  osc.frequency.value = 950;
  lfo.frequency.value = 1.6;   // the "wee-woo" speed
  lfoGain.gain.value = 450;    // how far the pitch swings
  gain.gain.value = 0.5;
  lfo.connect(lfoGain).connect(osc.frequency);
  osc.connect(gain).connect(audio.destination);
  osc.start();
  lfo.start();
  let wake = null;
  try { wake = await navigator.wakeLock.request('screen'); } catch (err) { /* screen may dim */ }
  siren = { audio, wake };
  $('siren').hidden = false;
  $('siren-btn').setAttribute('aria-pressed', 'true');
}

function stopSiren() {
  if (!siren) return;
  siren.audio.close();
  if (siren.wake) siren.wake.release().catch(() => {});
  siren = null;
  $('siren').hidden = true;
  $('siren-btn').setAttribute('aria-pressed', 'false');
}

/* ---------- 11. AI: scan a prescription, check my info ---------- */

function prepareImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
      const canvas = el('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('resize failed'))), 'image/jpeg', 0.85);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('not an image')); };
    img.src = url;
  });
}

const SCAN_PROMPT = `You are helping someone fill in their emergency medical ID.
The attached photo should be a prescription, discharge summary, medical report or medicine label.
Extract only what is clearly written. Do not guess.
- medications: each medicine with strength and frequency if written, e.g. "Metformin 500 mg twice daily"
- conditions: diagnoses or long-term conditions named
- allergies: allergies the document states
- summary: one short sentence on what the document is, or why nothing could be read
Reply with only JSON: {"medications": [], "conditions": [], "allergies": [], "summary": ""}`;

function requireAi(box) {
  if (AI.mode() !== 'off') return true;
  box.hidden = false;
  box.className = 'ai-result is-error';
  box.textContent = AI.describeError({ code: 'off' });
  $('ai-settings').open = true;
  return false;
}

async function scanPrescription(file) {
  const box = $('scan-result');
  if (!requireAi(box)) return;
  box.hidden = false;
  box.className = 'ai-result';
  box.textContent = 'Reading the photo… this can take up to a minute.';
  $('scan-label').classList.add('is-busy');
  try {
    const image = await prepareImage(file);
    showScanResult(await AI.askJson(SCAN_PROMPT, { images: [image] }));
  } catch (err) {
    box.classList.add('is-error');
    box.textContent = err && err.code ? AI.describeError(err) : 'That file could not be opened as an image.';
  } finally {
    $('scan-label').classList.remove('is-busy');
    $('scan-input').value = '';
  }
}

function showScanResult(result) {
  const box = $('scan-result');
  const list = (key) => (Array.isArray(result && result[key]) ? result[key].map(String).filter(Boolean).slice(0, 10) : []);
  const groups = [['medications', 'Medications'], ['conditions', 'Medical conditions'], ['allergies', 'Allergies']];
  let total = 0;
  const parts = groups.map(([key, title]) => {
    const items = list(key);
    total += items.length;
    return items.length ? el('div', { class: 'ai-group' }, el('p', { class: 'ai-group-title', text: title }),
      items.map((item) => el('label', { class: 'check' },
        el('input', { type: 'checkbox', checked: true, 'data-target': key, value: item }), el('span', { text: item })))) : null;
  });
  box.replaceChildren(
    el('p', { class: 'ai-summary', text: (result && result.summary) || 'Here is what the AI found.' }),
    ...parts,
    el('div', { class: 'actions' },
      total ? el('button', { type: 'button', class: 'btn btn-primary btn-small', onclick: addScannedItems }, 'Add ticked items') : null,
      el('button', { type: 'button', class: 'btn btn-ghost btn-small', onclick: () => { box.hidden = true; } }, total ? 'Discard' : 'Close')),
    el('p', { class: 'hint', text: 'Check each item against the document. AI can misread handwriting.' }),
  );
}

function addScannedItems() {
  [...$('scan-result').querySelectorAll('input:checked')].forEach((input) => {
    const field = $('f-' + input.dataset.target);
    const existing = splitList(field.value);
    if (!existing.some((e) => e.toLowerCase() === input.value.toLowerCase())) existing.push(input.value);
    field.value = existing.join(', ').slice(0, 200);
  });
  $('scan-result').hidden = true;
  onUserEdit();
}

async function checkInfo() {
  const box = $('check-result');
  if (!requireAi(box)) return;
  box.hidden = false;
  box.className = 'ai-result';
  box.textContent = 'Checking your info…';
  $('check-btn').disabled = true;

  const prompt = `Review this person's emergency medical ID the way a paramedic would.
${plainText(readForm())}

Point out up to 5 things worth fixing, most important first, for example:
- a medicine that suggests a condition that is not listed (e.g. insulin but no diabetes), or the reverse
- an allergy written too vaguely to act on (e.g. "antibiotics")
- something a responder needs to know that is missing (blood group, where an inhaler or EpiPen is kept, a contact phone without a country code)
Do not diagnose or give medical advice. Do not invent facts.
Reply with only JSON: {"items": [{"level": "important" or "tip", "text": "one sentence"}], "summary": "one short sentence"}`;

  try {
    const r = await AI.askJson(prompt);
    const items = Array.isArray(r && r.items) ? r.items.filter((i) => i && i.text).slice(0, 5) : [];
    box.replaceChildren(
      el('p', { class: 'ai-summary', text: (r && r.summary) || (items.length ? 'A few things to look at:' : 'Looks complete.') }),
      items.length ? el('ul', { class: 'check-list' }, items.map((i) =>
        el('li', { class: i.level === 'important' ? 'is-important' : '' }, el('span', { class: 'lvl', text: i.level === 'important' ? 'Important' : 'Tip' }), String(i.text)))) : null,
      el('p', { class: 'hint', text: 'AI suggestions. You decide what to change.' }),
    );
  } catch (err) {
    box.classList.add('is-error');
    box.textContent = AI.describeError(err);
  } finally {
    $('check-btn').disabled = false;
  }
}

function updateAiUi() {
  const mode = AI.mode();
  $('ai-mode').textContent = { claude: 'On', free: 'On, free', key: 'On', off: 'Off' }[mode];
  $('ai-mode').dataset.mode = mode;
  const explain = {
    claude: 'AI features use your Claude account while this page is open in Claude.',
    free: 'AI runs on the free tier of Google Gemini. There is a daily limit, and Google may use what is sent to improve its products.',
    key: `AI uses your own Anthropic API key with the ${AI.model} model.`,
    off: 'AI is not set up on this site yet. Add GEMINI_API_KEY in Netlify (see the README), or paste your own Anthropic key here.',
  }[mode];
  $('ai-explain').textContent = explain;
  $('key-box').hidden = mode === 'claude' || mode === 'free';
  $('api-key').value = AI.getKey() ? '••••••••••••' : '';
}

/* ---------- 12. Install, print, backup ---------- */

// Chrome, Edge and Samsung Internet fire "beforeinstallprompt" when the
// site can be installed; we keep it and show the real install dialog when
// the button is pressed. Safari, Firefox and in-app browsers never fire it,
// and Chrome skips it when the app is already installed, so then we show
// the steps for that browser instead of doing nothing.
let installEvent = null;
const INSTALLED_KEY = 'lifeline:installed';

function isInstalled() {
  if (isStandalone) return true;
  try { return localStorage.getItem(INSTALLED_KEY) === '1'; } catch (err) { return false; }
}

function markInstalled() {
  try { localStorage.setItem(INSTALLED_KEY, '1'); } catch (err) { /* storage blocked */ }
}

/** Which browser we are in, for the right install steps. */
function browserKind() {
  const ua = navigator.userAgent;
  if (/FBAN|FBAV|Instagram|Line\/|WhatsApp|Snapchat|; wv\)/i.test(ua)) return 'inapp';
  if (isIos) return /CriOS|FxiOS|EdgiOS/.test(ua) ? 'ios-other' : 'ios-safari';
  if (/Android/i.test(ua)) return /SamsungBrowser/i.test(ua) ? 'samsung' : /Firefox/i.test(ua) ? 'android-firefox' : 'android';
  if (/Firefox/i.test(ua)) return 'desktop-firefox';
  if (/Safari/i.test(ua) && !/Chrome|Chromium|Edg/i.test(ua)) return 'mac-safari';
  return 'desktop-chrome';
}

const INSTALL_STEPS = {
  inapp: ['You opened this inside another app (like Instagram or WhatsApp), which cannot install apps.', 'Tap the ⋮ or ··· menu and choose <b>Open in Chrome</b> (or <b>Open in Safari</b> on iPhone).', 'Then press Install app again.'],
  'ios-safari': ['Tap the <span class="kbd">Share</span> button (the square with an arrow, at the bottom or top of Safari).', 'Scroll down and tap <b>Add to Home Screen</b>, then <b>Add</b>.', 'Open Lifeline from the new icon on your home screen. You need this for the lock-screen card on iPhone.'],
  'ios-other': ['On iPhone, apps can be added from Safari or Chrome.', 'Tap <span class="kbd">Share</span> (in Chrome it is at the top right, next to the address bar), then <b>Add to Home Screen</b>.', 'If you do not see it, open this page in Safari and do the same.'],
  android: ['Tap the <span class="kbd">⋮</span> menu at the top right of Chrome.', 'Tap <b>Install app</b> or <b>Add to Home screen</b>, then <b>Install</b>.', 'If neither is there, the app is probably installed already: look for Lifeline in your app drawer.'],
  samsung: ['Tap the <span class="kbd">☰</span> menu at the bottom right.', 'Tap <b>Add page to</b>, then <b>Home screen</b>.'],
  'android-firefox': ['Tap the <span class="kbd">⋮</span> menu.', 'Tap <b>Install</b> (or <b>Add to Home screen</b>).'],
  'desktop-chrome': ['Look at the right end of the address bar for the install icon (a small screen with a down arrow) and click it.', 'Or open the <span class="kbd">⋮</span> menu, then <b>Cast, save and share</b>, then <b>Install page as app</b> (in Edge: <b>…</b> menu, <b>Apps</b>, <b>Install this site as an app</b>).', 'No install option? It may already be installed: check chrome://apps. The lock-screen card matters most on your phone, so install it there too.'],
  'desktop-firefox': ['Firefox on computers cannot install web apps.', 'Open this site in Chrome or Edge to install it, or just install it on your phone.'],
  'mac-safari': ['In Safari, open the <b>File</b> menu and choose <b>Add to Dock</b>.', 'The lock-screen card matters most on your phone, so install it there too.'],
};

async function installApp() {
  const box = $('install-steps');
  if (installEvent) {
    installEvent.prompt();
    const choice = await installEvent.userChoice.catch(() => null);
    installEvent = null;
    if (choice && choice.outcome === 'accepted') { markInstalled(); box.hidden = true; }
    updateInstallUi();
    return;
  }
  if (!canLink) {
    box.replaceChildren(el('p', { text: 'Installing works on your Netlify site, not inside this preview. Open the site on your phone and press Install app there.' }));
    box.hidden = false;
    return;
  }
  const steps = INSTALL_STEPS[browserKind()];
  const list = el('ol');
  steps.forEach((html) => { const li = el('li'); li.innerHTML = html; list.append(li); }); // fixed text from INSTALL_STEPS only
  box.replaceChildren(el('p', {}, el('strong', { text: 'Install it from your browser menu:' })), list);
  box.hidden = false;
}

function updateInstallUi() {
  const text = $('install-text');
  const button = $('install-btn');
  if (isStandalone) {
    text.textContent = 'Installed. Lifeline opens from your home screen and works with no signal.';
    button.hidden = true;
    $('install-steps').hidden = true;
    return;
  }
  button.hidden = false;
  button.textContent = installEvent ? 'Install app' : 'How to install';
  text.textContent = isInstalled()
    ? 'Installed on this device. Open Lifeline from your home screen or app list so it works with no signal.'
    : 'Install it like an app so it opens instantly, works with no signal and can keep your card on the lock screen.';
}

function printCard() {
  if (isEmbedded) { toast('Printing is blocked in this preview. It works on your Netlify site.'); return; }
  const data = activePerson().data;
  const card = el('div', { class: 'pc' },
    el('div', { class: 'pc-top' }, el('strong', { text: 'MEDICAL ID' }), el('span', { text: `Emergency ${emergencyNumber(data)}` })),
    el('div', { class: 'pc-body' },
      el('div', {},
        el('p', { class: 'pc-name', text: data.name }),
        el('p', { text: `Blood: ${data.blood || '?'}` }),
        el('p', { class: 'pc-red', text: `Allergies: ${data.allergies || 'none listed'}` }),
        data.conditions ? el('p', { text: data.conditions }) : null,
        ...filledContacts(data).slice(0, 2).map((c) => el('p', { text: `ICE ${c.name}: ${c.phone}` })),
      ),
      el('div', { class: 'pc-qr' }, el('img', { src: $('qr').toDataURL(), alt: '' }), el('span', { text: 'Scan for full ID' })),
    ),
  );
  $('print-card').replaceChildren(card, el('p', { text: 'Cut out and keep in your wallet, behind your phone case or on your bag.' }));
  window.print();
}

async function exportBackup() {
  const blob = new Blob([JSON.stringify({ app: 'lifeline-ice', version: 4, people: store.people.map((p) => p.data) }, null, 2)], { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(blob), download: 'lifeline-backup.json' });
  document.body.append(a);
  a.click();
  a.remove();
  $('backup-status').textContent = isEmbedded ? 'If nothing downloaded, the preview blocked it. It works on your Netlify site.' : 'Backup downloaded.';
}

function importBackup(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      const list = Array.isArray(parsed.people) ? parsed.people : [parsed];
      // Old ICE Card Maker backups stored { data } per person; new ones store the data directly
      const people = list.slice(0, MAX_PEOPLE).map((p) => newPerson(p && p.data ? p.data : p)).filter((p) => p.data.name || p.data.blood);
      if (!people.length) throw new Error('empty');
      store = { activeId: people[0].id, isExample: false, people };
      fillForm(people[0].data);
      saveNow();
      refresh();
      $('backup-status').textContent = `Restored ${people.length} ${people.length === 1 ? 'person' : 'people'}.`;
    } catch (err) {
      $('backup-status').textContent = 'That file is not a Lifeline backup.';
    }
  };
  reader.readAsText(file);
}

/* ---------- 13. Startup ---------- */

function startOwnerApp() {
  $('owner-app').hidden = false;
  store = loadStore() || exampleStore();
  buildCountrySelect();
  fillForm(activePerson().data);

  document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => showView(tab.dataset.view)));
  $('banner-edit').addEventListener('click', () => showView('edit'));

  const form = $('info-form');
  form.addEventListener('input', onUserEdit);
  form.addEventListener('change', (e) => { if (e.target.type !== 'file') onUserEdit(); });
  form.addEventListener('submit', (e) => e.preventDefault());
  $('add-contact').addEventListener('click', () => {
    const list = readForm().contacts;
    list.push({ name: '', relation: '', phone: '' });
    renderContactRows(list);
    contactsBox.querySelector('.contact:last-child input').focus();
  });
  $('add-person').addEventListener('click', addPerson);
  $('delete-person').addEventListener('click', deletePerson);

  // SOS: press and hold, or press Enter/Space twice quickly on a keyboard
  const sos = $('sos-btn');
  sos.addEventListener('pointerdown', startHold);
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => sos.addEventListener(ev, () => { if (holdTimer) endHold(); }));
  sos.addEventListener('contextmenu', (e) => e.preventDefault());
  sos.addEventListener('click', (e) => { if (e.detail === 0) triggerSos(); }); // keyboard press
  $('sheet-close').addEventListener('click', closeSheet);
  $('sheet').addEventListener('click', (e) => { if (e.target === $('sheet')) closeSheet(); });
  $('sheet-share').addEventListener('click', shareSheet);
  $('sheet-refresh').addEventListener('click', locate);
  $('siren-btn').addEventListener('click', () => (siren ? stopSiren() : startSiren()));
  $('siren-stop').addEventListener('click', stopSiren);

  $('pin-btn').addEventListener('click', pinCard);
  $('unpin-btn').addEventListener('click', () => unpinCard());

  $('copy-link').addEventListener('click', async () => {
    const ok = await copyText(qrText);
    $('qr-note').textContent = ok ? (canLink ? 'Link copied. Put it in your Instagram bio, email signature or a note.' : 'Details copied as text.') : 'Could not copy here.';
  });
  $('share-link').addEventListener('click', async () => {
    if (!navigator.share) { $('copy-link').click(); return; }
    try { await navigator.share(canLink ? { title: 'My medical ID', url: qrText } : { text: qrText }); } catch (err) { /* closed */ }
  });
  $('print-btn').addEventListener('click', printCard);
  $('copy-builtin').addEventListener('click', async () => {
    const ok = await copyText(plainText(activePerson().data));
    $('builtin-note').textContent = ok ? 'Copied. Paste it into the Medical notes field of your phone\'s Medical ID.' : 'Could not copy here.';
  });

  $('install-btn').addEventListener('click', installApp);
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent = e; updateInstallUi(); });
  window.addEventListener('appinstalled', () => { installEvent = null; markInstalled(); updateInstallUi(); refresh(); });

  $('scan-input').addEventListener('change', (e) => { if (e.target.files[0]) scanPrescription(e.target.files[0]); });
  $('check-btn').addEventListener('click', checkInfo);
  $('save-key').addEventListener('click', () => {
    const key = $('api-key').value.trim();
    if (key && !key.startsWith('•')) AI.setKey(key);
  });
  $('remove-key').addEventListener('click', () => AI.setKey(''));
  AI.onChange(updateAiUi);
  $('export-btn').addEventListener('click', exportBackup);
  $('import-input').addEventListener('change', (e) => { if (e.target.files[0]) importBackup(e.target.files[0]); e.target.value = ''; });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { if (!$('sheet').hidden) closeSheet(); stopSiren(); }
  });

  if (isStandalone) markInstalled();
  updateAiUi();
  updateInstallUi();
  refresh();
  // Opening the app re-pins cards that were swiped away
  if (store.people.some((p) => p.pinned)) schedulePinUpdate();
  // The app icon's "SOS" shortcut opens straight into the SOS sheet
  if (new URLSearchParams(location.search).has('sos')) triggerSos();
}

// The service worker makes the app work offline and shows the lock-screen card
if ('serviceWorker' in navigator && isHosted && !isClaudePreview) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* offline mode unavailable */ });
}

// Open the responder page if the link carries details, else the owner app
const idMatch = location.hash.match(/^#id=([zj][A-Za-z0-9_-]+)/);
if (idMatch) startResponderPage(idMatch[1]);
else startOwnerApp();

window.addEventListener('hashchange', () => location.reload());
