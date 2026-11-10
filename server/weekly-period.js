const DAY = 86400000;
const calendar = (date, timeZone) =>
  Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
const dateText = (parts) => `${parts.year}-${parts.month}-${parts.day}`;
function midnight(date, timeZone) {
  const wall = Date.parse(date + 'T00:00:00Z');
  let instant = wall;
  for (let i = 0; i < 4; i++) {
    const parts = calendar(new Date(instant), timeZone);
    const displayed = Date.parse(dateText(parts) + `T${parts.hour}:${parts.minute}:${parts.second}Z`);
    instant += wall - displayed;
  }
  return instant;
}
export function weeklyPeriod(date, timeZone = 'Asia/Shanghai', now = new Date()) {
  try {
    calendar(now, timeZone);
  } catch {
    throw new Error('时区不正确');
  }
  const day = date || dateText(calendar(now, timeZone));
  if (
    typeof day !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
    !Number.isFinite(Date.parse(day)) ||
    new Date(day).toISOString().slice(0, 10) !== day
  )
    throw new Error('请选择有效的周次');
  const pivot = new Date(day + 'T00:00:00Z'),
    startDate = new Date(+pivot - ((pivot.getUTCDay() + 6) % 7) * DAY).toISOString().slice(0, 10);
  const endDate = new Date(Date.parse(startDate) + 6 * DAY).toISOString().slice(0, 10),
    nextDate = new Date(Date.parse(startDate) + 7 * DAY).toISOString().slice(0, 10);
  const start = midnight(startDate, timeZone),
    end = midnight(nextDate, timeZone);
  return {
    key: startDate + ':' + timeZone.replace(/[^a-zA-Z0-9]/g, '-'),
    startDate,
    endDate,
    timeZone,
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
    inProgress: +now >= start && +now < end,
    future: +now < start,
    generatedAt: now.toISOString(),
  };
}
export const inWeek = (value, week) =>
  Number.isFinite(Date.parse(value)) &&
  Date.parse(value) >= Date.parse(week.start) &&
  Date.parse(value) < Math.min(Date.parse(week.end), Date.parse(week.generatedAt) + 1);
