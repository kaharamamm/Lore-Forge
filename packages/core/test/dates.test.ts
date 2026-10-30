import { test } from 'node:test';
import assert from 'node:assert/strict';
import { definitelyBefore, describeDate, formatDate, parseDate, type ParsedDate } from '@lore-forge/core';
import { manifest } from './helpers.ts';

const cal = manifest.calendar;
const d = (s: string): ParsedDate => {
  const r = parseDate(s, cal);
  assert.equal(r.kind, 'date', s);
  return (r as { date: ParsedDate }).date;
};

test('reads years, months, days and eras', () => {
  assert.deepEqual([d('1800').year, d('1800').era, d('1800').precision], [1800, 'AS', 'year']);
  assert.equal(d('1920-03-12').precision, 'day');
  assert.equal(d('1920-03').precision, 'month');
  assert.equal(d('410 OK').era, 'OK');
  assert.equal(d('410 ok').era, 'OK');
});

test('unknown and empty dates are unknown, not errors', () => {
  for (const s of ['unknown', '?', '', 'Unknown']) assert.equal(parseDate(s, cal).kind, 'unknown');
  assert.equal(parseDate(undefined, cal).kind, 'unknown');
});

test('bad dates explain what is wrong', () => {
  const bad = (s: string): string => {
    const r = parseDate(s, cal);
    assert.equal(r.kind, 'invalid', s);
    return (r as { reason: string }).reason;
  };
  assert.match(bad('next spring'), /is not a date/);
  assert.match(bad('1750 XX'), /unknown era "XX"/);
  assert.match(bad('1750-13'), /month 13/);
  assert.match(bad('1750-02-31'), /day 31/);
});

test('eras sit on one axis: Old Kingdom comes before After the Sundering', () => {
  assert.ok(definitelyBefore(d('900 OK'), d('1 AS')));
  assert.ok(definitelyBefore(d('1799'), d('1800')));
  assert.ok(!definitelyBefore(d('1800'), d('1800-06-01')), 'a year contains its days');
});

test('approximate dates only conflict when certainly apart', () => {
  assert.ok(!definitelyBefore(d('~1800'), d('1803')));
  assert.ok(definitelyBefore(d('~1800'), d('1806')));
});

test('formats and describes dates in plain words', () => {
  assert.equal(formatDate(d('~1800'), cal), 'c. 1800');
  assert.equal(formatDate(d('410 OK'), cal), '410 OK');
  assert.equal(describeDate('1920-03-12', cal), 'Day 12, Month 3, Year 1920 of After the Sundering');
});

test('dotted dates: YYYY, MM.YYYY, DD.MM.YYYY keep their precision', () => {
  assert.deepEqual([d('12.03.1920').day, d('12.03.1920').month, d('12.03.1920').year, d('12.03.1920').precision], [12, 3, 1920, 'day']);
  assert.deepEqual([d('03.1920').month, d('03.1920').year, d('03.1920').precision], [3, 1920, 'month']);
  assert.equal(d('03.0050').year, 50);
  assert.equal(d('03.50 OK').year, 50, 'an era code makes the second number a year');
  assert.equal(d('~12.03.1920').approx, true);
  assert.deepEqual([d('12.03.1920').lo, d('12.03.1920').hi], [d('1920-03-12').lo, d('1920-03-12').hi], 'same day as the ISO form');
});

test('DD.MM is a valid day and month with the year unknown', () => {
  const r = parseDate('12.03', cal);
  assert.deepEqual(r, { kind: 'yearless', day: 12, month: 3, approx: false });
  assert.equal(parseDate('12.03.', cal).kind, 'yearless');
  assert.match(describeDate('12.03', cal), /Day 12, Month 3, year unknown/);
  assert.match((parseDate('31.02', { ...cal, months: [{ name: 'Sun', days: 30 }, { name: 'Moon', days: 28 }] }) as { reason: string }).reason, /day 31, but Moon has 28 days/);
});

test('partial dates only conflict when the known parts prove it', () => {
  assert.ok(!definitelyBefore(d('1920'), d('12.03.1920')), 'same year: could be either');
  assert.ok(!definitelyBefore(d('03.1920'), d('15.03.1920')));
  assert.ok(definitelyBefore(d('03.1920'), d('01.04.1920')));
  assert.ok(definitelyBefore(d('30.12.1919'), d('1920')));
});

test('custom month counts bound the dotted month', () => {
  const c = { ...cal, months: [{ name: 'Sun', days: 40 }, { name: 'Moon', days: 40 }] };
  assert.equal(parseDate('03.1920', c).kind, 'invalid');
  assert.equal(parseDate('35.02.1920', c).kind, 'date');
});

test('formats in the dotted form', () => {
  assert.equal(formatDate(d('1920-03-12'), cal), '12.03.1920');
  assert.equal(formatDate(d('3.1920'), cal), '03.1920');
});
