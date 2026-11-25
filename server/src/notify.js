// Delivery: Expo push notifications + SMTP email.
import nodemailer from 'nodemailer';
import { Expo } from 'expo-server-sdk';
import { config, emailConfigured } from './config.js';
import { save, id } from './store.js';

const expo = new Expo();
let transporter = null;

function mailer() {
  if (!emailConfigured()) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: { user: config.smtp.user, pass: config.smtp.pass },
    });
  }
  return transporter;
}

// All functions below act on one profile `u` (from store.user()).
export const alertEmail = (u) => u.settings.email || '';

export async function sendPush(u, { title, body, data }) {
  const tokens = u.devices.map((d) => d.token).filter((t) => Expo.isExpoPushToken(t));
  if (!tokens.length) return { sent: 0, skipped: 'no registered devices' };
  const messages = tokens.map((to) => ({ to, title, body, data, sound: 'default', priority: 'high', channelId: 'alerts' }));
  let sent = 0;
  const dead = new Set();
  for (const chunk of expo.chunkPushNotifications(messages)) {
    try {
      const tickets = await expo.sendPushNotificationsAsync(chunk);
      tickets.forEach((t, i) => {
        if (t.status === 'ok') sent++;
        else if (t.details?.error === 'DeviceNotRegistered') dead.add(chunk[i].to);
        else console.warn('[push] ticket error:', t.message);
      });
    } catch (e) {
      console.error('[push] send failed:', e.message);
    }
  }
  if (dead.size) {
    u.devices = u.devices.filter((d) => !dead.has(d.token));
    save();
  }
  return { sent };
}

export async function sendEmail(u, { subject, text, html }) {
  const t = mailer();
  const to = alertEmail(u);
  if (!t) return { sent: 0, skipped: 'SMTP not configured' };
  if (!to) return { sent: 0, skipped: 'no alert email set' };
  await t.sendMail({ from: config.smtp.from, to, subject, text, html });
  return { sent: 1 };
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** Deliver an alert on the channels the rule asks for and record it. */
export async function deliver({ user: u, rule, title, body, details = [], links = [] }) {
  const s = u.settings;
  const channels = rule?.channels || { push: true, email: true };
  const result = { push: null, email: null };

  if (channels.push && s.pushEnabled !== false) {
    result.push = await sendPush(u, {
      title,
      body,
      data: rule ? { ruleId: rule.id, market: rule.market, symbol: rule.symbol } : {},
    });
  }
  if (channels.email && s.emailEnabled !== false) {
    const text = [body, '', ...details, ...links.map((l) => `${l.title}: ${l.url}`)].join('\n');
    const html = `
      <div style="font-family:system-ui,sans-serif;max-width:560px">
        <h2 style="margin:0 0 8px">${esc(title)}</h2>
        <p style="font-size:15px">${esc(body)}</p>
        ${details.length ? `<ul>${details.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>` : ''}
        ${links.length ? `<ul>${links.map((l) => `<li><a href="${esc(l.url)}">${esc(l.title)}</a></li>`).join('')}</ul>` : ''}
        <p style="color:#888;font-size:12px">Sent by Stock Tracker. Data may be delayed; not investment advice.</p>
      </div>`;
    try {
      result.email = await sendEmail(u, { subject: title, text, html });
    } catch (e) {
      console.error('[email] send failed:', e.message);
      result.email = { sent: 0, error: e.message };
    }
  }

  const entry = {
    id: id(),
    time: Date.now(),
    ruleId: rule?.id || null,
    market: rule?.market || null,
    symbol: rule?.symbol || null,
    type: rule?.type || 'test',
    title,
    body,
    details,
    delivery: result,
  };
  const h = u.history;
  h.unshift(entry);
  if (h.length > 500) h.length = 500;
  save();
  console.log(`[alert] ${u.id.slice(0, 8)}… ${title} — ${body}`);
  return entry;
}
