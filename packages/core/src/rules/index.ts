import type { Rule } from '../engine.ts';
import { invalidDate, dateOrder } from './dates.ts';
import { parentBornAfterChild, parentCycle } from './family.ts';
import { fileError } from './files.ts';
import { imageView } from './images.ts';
import { afterDeath, beforeBirth, participantNotExisting } from './lifespan.ts';
import { placeNotExisting, twoPlacesAtOnce } from './places.ts';
import { danglingReference, duplicateName } from './references.ts';
import { deadMarkedAlive } from './status.ts';
import { relationKindRule } from './relation-kind.ts';
import { lookOutsideLife, lookOverlap, lookTime } from './looks.ts';
import { mapPin } from './maps.ts';
import { aiPhrasingRule } from '../prose-check.ts';

export { afterDeath, beforeBirth, participantNotExisting, placeNotExisting, twoPlacesAtOnce, danglingReference, duplicateName, parentCycle, parentBornAfterChild, deadMarkedAlive, invalidDate, dateOrder, fileError, imageView, relationKindRule, lookTime, lookOutsideLife, lookOverlap, mapPin };

/** The starter rules, in report order. */
export const builtinRules: readonly Rule[] = [
  afterDeath, beforeBirth, participantNotExisting, placeNotExisting, twoPlacesAtOnce,
  danglingReference, duplicateName, parentCycle, parentBornAfterChild, deadMarkedAlive,
  invalidDate, dateOrder, fileError, imageView, relationKindRule,
  lookTime, lookOutsideLife, lookOverlap, mapPin, aiPhrasingRule,
];
