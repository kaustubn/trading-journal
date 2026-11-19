const COMMON = new Set([
  'password123', 'password1234', '1234567890', '12345678910', 'qwertyuiop', 'qwerty12345', 'iloveyou123',
  'abcdefghij', '0123456789', 'letmein123', 'welcome123', 'trading123', 'password!!', '1111111111',
  'aaaaaaaaaa', 'passw0rd123', 'administrator',
]);

/** Returns null if the password is acceptable, otherwise a message to show the user. */
export function passwordProblem(pw: unknown): string | null {
  if (typeof pw !== 'string' || pw.length === 0) return 'Password required';
  if (pw.length < 10) return 'Password must be at least 10 characters';
  if (Buffer.byteLength(pw, 'utf8') > 72) return 'Password is too long (max 72 bytes)';
  if (COMMON.has(pw.toLowerCase())) return 'That password is too common';
  return null;
}
