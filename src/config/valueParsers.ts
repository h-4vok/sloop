import { argvParser } from './parsing/agentArgvParser.js';
import { configValueParsers as primitiveConfigValueParsers } from './parsing/configValueParsers.js';

/** Preserves the existing parser export while combining parser modules. */
export { argvParser };
export const configValueParsers = Object.freeze({
  stringParser: primitiveConfigValueParsers.stringParser,
  booleanParser: primitiveConfigValueParsers.booleanParser,
  integerParser: primitiveConfigValueParsers.integerParser,
  enumParser: primitiveConfigValueParsers.enumParser,
  listParser: primitiveConfigValueParsers.listParser,
  durationParser: primitiveConfigValueParsers.durationParser,
  argvParser,
  pathParser: primitiveConfigValueParsers.pathParser,
  unrestrictedStringParser: primitiveConfigValueParsers.unrestrictedStringParser,
});
