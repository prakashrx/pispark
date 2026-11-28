/**
 * An id as PiSpark makes them (`crypto.randomUUID()`): a version 4 UUID, in lowercase. Sessions, commands,
 * schedules, processes and an extension's questions are all named this way, and a session's id is also
 * its folder's name.
 */
export const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
