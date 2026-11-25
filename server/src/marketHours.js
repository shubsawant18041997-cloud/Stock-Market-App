// Regular trading sessions. Holidays are not modelled: on a holiday the
// provider simply returns an unchanged quote, which can't trigger alerts.
const SESSIONS = {
  US: { tz: 'America/New_York', open: [9, 30], close: [16, 0] },
  IN: { tz: 'Asia/Kolkata', open: [9, 15], close: [15, 30] },
};

function localParts(tz, date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return { weekday: get('weekday'), minutes: (Number(get('hour')) % 24) * 60 + Number(get('minute')) };
}

/** Returns { open, fraction } where fraction is 0..1 of the session elapsed. */
export function sessionStatus(market, date = new Date()) {
  if (market === 'CRYPTO') return { open: true, fraction: 1 };
  const s = SESSIONS[market];
  if (!s) return { open: false, fraction: 0 };
  const { weekday, minutes } = localParts(s.tz, date);
  const start = s.open[0] * 60 + s.open[1];
  const end = s.close[0] * 60 + s.close[1];
  const weekend = weekday === 'Sat' || weekday === 'Sun';
  if (weekend || minutes < start) return { open: false, fraction: 0 };
  if (minutes >= end) return { open: false, fraction: 1 };
  return { open: true, fraction: (minutes - start) / (end - start) };
}

export const isOpen = (market, date) => sessionStatus(market, date).open;
