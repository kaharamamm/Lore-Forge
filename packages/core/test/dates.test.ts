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
