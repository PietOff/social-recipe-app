import { Lang } from './i18n';

/**
 * Dutch versions of the error messages the backend sends (its `detail`
 * strings). The backend stays English - other code matches on these messages,
 * e.g. ApiError.dailyQuotaExhausted - so they are translated only when shown.
 */
const NL_ERRORS: Array<[RegExp, string | ((m: RegExpMatchArray) => string)]> = [
  [/^Unsupported URL/i, 'Deze link wordt niet ondersteund. Plak een link van TikTok, Instagram of YouTube, of van een receptpagina.'],
  [/^Could not open this website \(status (\d+)\)/i, m => `Deze website kon niet worden geopend (status ${m[1]}).`],
  [/^Could not open this website/i, 'Deze website kon niet worden geopend. Controleer de link en probeer het opnieuw.'],
  [/blocks automatic access/i, 'Deze website blokkeert automatisch ophalen. Probeer een andere receptensite.'],
  [/^This link is not a web page/i, 'Deze link is geen webpagina met een recept.'],
  [/redirects too many times/i, 'Deze link verwijst te vaak door.'],
  [/^No recipe found on this page/i, 'Op deze pagina is geen recept gevonden.'],
  [/redirected to an unsupported destination/i, 'Deze link verwijst door naar een site die niet wordt ondersteund.'],
  [/^Sign-in required/i, 'Log in om dit te doen.'],
  [/Invalid or expired session/i, 'Je sessie is verlopen. Log opnieuw in.'],
  [/^Too many requests/i, 'Te veel verzoeken. Wacht een minuut en probeer het opnieuw.'],
  [/^Too many thumbnail requests/i, 'Te veel verzoeken. Wacht even en probeer het opnieuw.'],
  [/^Could not fetch video data/i, 'De video kon niet worden opgehaald. Het platform blokkeert het verzoek mogelijk.'],
  [/^Could not process video data/i, 'De videogegevens konden niet worden verwerkt.'],
  [/^Daily AI quota reached/i, 'Het dagelijkse AI-limiet is bereikt. Het limiet wordt om middernacht (Amerikaanse westkusttijd) weer vrijgegeven; daarna kan de import verder.'],
  [/per-minute cap/i, 'Het AI-limiet per minuut is bereikt. Even wachten, dan gaat het verder.'],
  [/No LLM provider configured|not configured on the server/i, 'De server is niet goed ingesteld. Neem contact op met de beheerder.'],
  [/recipe AI is unavailable/i, 'De recept-AI is nu niet beschikbaar. Probeer het zo opnieuw.'],
  [/cookbook is too large for the recipe AI/i, 'Je kookboek is nu te groot voor de recept-AI. Probeer het over een minuut opnieuw.'],
  [/^Too many (videos|recipes) in one request/i, 'Te veel tegelijk in één verzoek. Probeer het met minder.'],
  [/^Could not read collection/i, 'De collectie kon niet worden gelezen.'],
  [/^No data returned for this URL/i, 'Er zijn geen gegevens gevonden voor deze link.'],
  [/^No videos found in this collection/i, "Geen video's gevonden in deze collectie. Controleer of de collectie openbaar is."],
  [/^TikTok did not return the video/i, 'TikTok gaf de video nu niet door. Probeer het zo nog een keer.'],
  [/^Could not reach the server/i, 'De server is niet bereikbaar.'],
  [/^Request failed \((\d+)\)/i, m => `Verzoek mislukt (${m[1]}).`],
];

/** The message in the UI language. Unknown messages are returned unchanged. */
export function localizeError(message: string | null | undefined, lang: Lang): string {
  if (!message) return '';
  if (lang !== 'nl') return message;
  for (const [pattern, replacement] of NL_ERRORS) {
    const match = message.match(pattern);
    if (match) return typeof replacement === 'string' ? replacement : replacement(match);
  }
  return message;
}
