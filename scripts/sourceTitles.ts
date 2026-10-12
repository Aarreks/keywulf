/** Reject site labels, section names and access-control pages as headlines. */
const JUNK = /^(one moment|just a moment|attention required|access denied|are you (a )?(human|robot)|please verify|verifying you|checking your browser|loading|redirecting|error|forbidden|not found|page not found|40[34]\b|503\b|captcha|security check|robot check|please wait|please enable (js|javascript|cookies)|before you continue|sign in|log in)/i;
const SECTION = /^(world news|latest news|breaking news|home page|(?:[-|]\s*)?youtube(?:\s*[-|]\s*youtube)?)$/i;

export function isUsableTitle(title: string | null | undefined): title is string {
  if (!title) return false;
  const text = title.trim();
  return text.split(/\s+/).length >= 2 && !JUNK.test(text) && !SECTION.test(text);
}
