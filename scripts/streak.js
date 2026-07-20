#!/usr/bin/env node

'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Config / constants
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(__dirname, '..');
const STREAK_JSON_PATH = path.join(REPO_ROOT, 'streak.json');
const BADGE_SVG_PATH = path.join(REPO_ROOT, 'badges', 'streak.svg');

// Field separator unlikely to ever appear in a name/email/date.
const FIELD_SEP = '\x1f';

// Identities whose commits must be excluded from the streak calculation.
const BOT_NAMES = new Set(['github-actions[bot]']);
const BOT_EMAIL_MARKERS = ['github-actions[bot]@users.noreply.github.com'];

// ---------------------------------------------------------------------------
// Git history reading
// ---------------------------------------------------------------------------

/**
 * Runs `git log` and returns an array of { name, email, date } objects,
 * where `date` is the ISO-8601 author date string (with timezone offset)
 * exactly as git reports it.
 */
function readGitLog() {
  let raw;
  try {
    raw = execSync(
      `git log --date=iso-strict --pretty=format:"%an${FIELD_SEP}%ae${FIELD_SEP}%ad"`,
      { cwd: REPO_ROOT, encoding: 'utf-8', maxBuffer: 1024 * 1024 * 64 }
    );
  } catch (err) {
    // A repo with zero commits (or no git history at all) is a valid
    // "no streak yet" state rather than a hard failure.
    console.warn('Warning: could not read git log, assuming empty history.');
    console.warn(err.message);
    return [];
  }

  if (!raw.trim()) return [];

  return raw
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [name, email, date] = line.split(FIELD_SEP);
      return { name, email, date };
    });
}

/**
 * Returns true if the commit was authored by the github-actions bot.
 */
function isBotCommit(commit) {
  if (BOT_NAMES.has(commit.name)) return true;
  return BOT_EMAIL_MARKERS.some((marker) => commit.email.includes(marker));
}

/**
 * Converts a git ISO-8601 author date (which includes a timezone offset)
 * into a UTC calendar day string "YYYY-MM-DD". Normalizing to UTC keeps
 * the grouping consistent regardless of which timezone a contributor's
 * machine was set to.
 */
function toUtcDay(isoDateStr) {
  const d = new Date(isoDateStr);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Streak calculation
// ---------------------------------------------------------------------------

/** Milliseconds in a day. */
const DAY_MS = 24 * 60 * 60 * 1000;

/** Parses a "YYYY-MM-DD" string as a UTC midnight timestamp. */
function parseUtcDay(dayStr) {
  return Date.parse(`${dayStr}T00:00:00.000Z`);
}

/** Returns true if `b` is exactly one calendar day after `a`. */
function isConsecutiveDay(a, b) {
  return parseUtcDay(b) - parseUtcDay(a) === DAY_MS;
}

/** Returns the number of whole calendar days between two "YYYY-MM-DD" strings. */
function dayDiff(a, b) {
  return Math.round((parseUtcDay(b) - parseUtcDay(a)) / DAY_MS);
}

/**
 * Given a sorted (ascending), de-duplicated array of "YYYY-MM-DD" strings
 * representing days that had at least one qualifying commit, computes:
 *   - bestStreak:    longest run of consecutive days anywhere in history
 *   - currentStreak: run of consecutive days ending "now" (today or
 *                     yesterday) — if the last active day is more than
 *                     one day in the past, the current streak is broken
 *                     and reported as 0
 *   - lastSolvedDate: the most recent active day (or null if none)
 */
function computeStreaks(days) {
  if (days.length === 0) {
    return { currentStreak: 0, bestStreak: 0, lastSolvedDate: null };
  }

  // --- Best streak: scan the whole history for the longest run. ---
  let bestStreak = 1;
  let run = 1;
  for (let i = 1; i < days.length; i++) {
    run = isConsecutiveDay(days[i - 1], days[i]) ? run + 1 : 1;
    if (run > bestStreak) bestStreak = run;
  }

  const lastSolvedDate = days[days.length - 1];

  // --- Current streak: walk backward from the most recent active day. ---
  let currentStreak = 1;
  for (let i = days.length - 1; i > 0; i--) {
    if (isConsecutiveDay(days[i - 1], days[i])) {
      currentStreak++;
    } else {
      break;
    }
  }

  // A streak is only "alive" if the last commit was today or yesterday
  // (yesterday is allowed since the workflow runs early in the UTC day,
  // before "today" may have any commits yet). Anything older means the
  // streak has already been broken as of the time this script runs.
  const todayStr = new Date().toISOString().slice(0, 10);
  const gap = dayDiff(lastSolvedDate, todayStr);
  if (gap > 1) {
    currentStreak = 0;
  }

  return { currentStreak, bestStreak, lastSolvedDate };
}

// ---------------------------------------------------------------------------
// Badge (SVG) generation — no external services, shields.io look-alike
// ---------------------------------------------------------------------------

/**
 * Picks the badge color based on the current streak length.
 */
function colorForStreak(days) {
  if (days === 0) return '#e05d44';        // red
  if (days >= 1 && days <= 6) return '#fe7d37';  // orange
  if (days >= 7 && days <= 29) return '#dfb317'; // yellow
  if (days >= 30 && days <= 99) return '#4c1';   // green
  return '#007ec6';                              // blue (100+)
}

/**
 * Very small, dependency-free approximation of shields.io's text width
 * measurement for Verdana 11px, used purely to size the badge boxes.
 * It doesn't need to be pixel-perfect — just visually reasonable.
 */
function estimateTextWidth(text) {
  const AVG_CHAR_WIDTH = 6.6;
  const PADDING = 10; // padding on each side inside a badge segment
  return Math.round(text.length * AVG_CHAR_WIDTH + PADDING * 2);
}

/**
 * Builds a two-segment, shields.io-style SVG badge:
 *   [ 🔥 Daily Streak | X days ]
 * left segment is neutral gray, right segment is colored by streak length.
 */
function buildBadgeSvg(currentStreak) {
  const label = '🔥 Daily Streak';
  const message = `${currentStreak} ${currentStreak === 1 ? 'day' : 'days'}`;
  const color = colorForStreak(currentStreak);

  const labelWidth = estimateTextWidth(label);
  const messageWidth = estimateTextWidth(message);
  const totalWidth = labelWidth + messageWidth;
  const height = 20;

  // Text is vertically centered; shields.io draws a subtle shadow copy
  // of the text one pixel down at reduced opacity for a slight 3D feel.
  const labelTextX = labelWidth / 2;
  const messageTextX = labelWidth + messageWidth / 2;
  const textY = height / 2 + 4.5;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${height}" role="img" aria-label="${label}: ${message}">
  <title>${label}: ${message}</title>
  <linearGradient id="smooth" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>

  <clipPath id="round">
    <rect width="${totalWidth}" height="${height}" rx="3" fill="#fff"/>
  </clipPath>

  <g clip-path="url(#round)">
    <rect width="${labelWidth}" height="${height}" fill="#555"/>
    <rect x="${labelWidth}" width="${messageWidth}" height="${height}" fill="${color}"/>
    <rect width="${totalWidth}" height="${height}" fill="url(#smooth)"/>
  </g>

  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="${labelTextX}" y="${textY}" fill="#010101" fill-opacity=".3">${label}</text>
    <text x="${labelTextX}" y="${textY - 1}">${label}</text>
    <text x="${messageTextX}" y="${textY}" fill="#010101" fill-opacity=".3">${message}</text>
    <text x="${messageTextX}" y="${textY - 1}">${message}</text>
  </g>
</svg>
`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const commits = readGitLog();

  // Exclude bot-authored commits, then reduce to a sorted set of unique
  // UTC calendar days that had at least one qualifying human commit.
  const activeDays = Array.from(
    new Set(
      commits
        .filter((c) => !isBotCommit(c))
        .map((c) => toUtcDay(c.date))
    )
  ).sort(); // "YYYY-MM-DD" strings sort correctly lexicographically

  const { currentStreak, bestStreak, lastSolvedDate } = computeStreaks(activeDays);

  const result = { currentStreak, bestStreak, lastSolvedDate };

  // Write streak.json
  fs.writeFileSync(STREAK_JSON_PATH, JSON.stringify(result, null, 2) + '\n', 'utf-8');
  console.log('Wrote', STREAK_JSON_PATH, result);

  // Write badges/streak.svg
  fs.mkdirSync(path.dirname(BADGE_SVG_PATH), { recursive: true });
  const svg = buildBadgeSvg(currentStreak);
  fs.writeFileSync(BADGE_SVG_PATH, svg, 'utf-8');
  console.log('Wrote', BADGE_SVG_PATH);
}

main();
