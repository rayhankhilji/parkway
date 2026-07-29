/**
 * The entire public surface of @parkway/engine.
 *
 * Everything the server and the client may use is re-exported here. Reaching into
 * a deep path is not supported — the package has one entry point so that the
 * boundary between "the rules" and "everything else" stays a single, reviewable
 * list.
 */

export { ok, err, isOk, isErr, expectOk, type Ok, type Err, type Result } from './result.js';
