'use client';

import React from 'react';
import { labelKey } from './labels';

/**
 * UI strings in English and Dutch.
 *
 * Recipes themselves are stored in English (the extractor is told to translate),
 * and labels keep their English value internally so filters, the PDF chapter
 * order and the recommender keep working on one canonical spelling. Only what
 * is shown is translated - see `labelText`.
 */

export type Lang = 'en' | 'nl';

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

const en = {
  // Header / navigation
  signIn: 'Sign In with Google',
  signingIn: 'Signing in...',
  user: 'User',
  newRecipe: '+ New Recipe',
  cookbookNav: '📚 Cookbook',
  whatToCook: '✨ What to cook',
  myCookbook: (n: number) => `My Cookbook (${n})`,
  exportCookbook: 'Export Cookbook',
  cookbookPdf: 'Cookbook PDF',
  resetImportCache: 'Reset Import Cache',
  logOut: 'Log Out',
  switchLanguage: 'Nederlands',

  // Sync / cookbook errors
  pendingSyncWarning: (n: number) =>
    `${n} ${plural(n, 'recipe', 'recipes')} on this device ${plural(n, 'has', 'have')} not reached the cloud, ` +
    `so ${plural(n, 'it', 'they')} will not appear on your other devices.`,
  syncing: 'Syncing...',
  retrySync: 'Retry sync',
  signInToSync: 'Sign in to sync',
  errOfflineCache: 'Could not reach the database just now - showing your saved copy. Pull down to retry.',
  errEmptyButLocal: (n: number) =>
    `The database returned no recipes, but ${n} are saved on this device. ` +
    'Keeping them rather than clearing your cookbook - reload to try again.',
  errPermission: 'Database permission denied. Please verify your Firestore Security Rules allow read access.',
  errUnreachable: 'Could not reach the database. Showing cached data.',
  errSyncRemaining: (n: number, detail: string) =>
    `${n} ${plural(n, 'recipe', 'recipes')} could not be saved to the cloud${detail ? ` (${detail})` : ''}. ` +
    'They are on this device only.',
  errMigration: 'Some recipes from this device could not be uploaded. They are still saved locally.',
  errUnauthorizedDomain: (host: string) =>
    `Login failed: This domain (${host}) is not authorized in your Firebase Console. ` +
    'Please add it under Authentication > Settings > Authorized domains.',
  errSignInDisabled:
    'Login failed: Google Sign-in is not enabled. Please enable it in the Firebase Console under Authentication > Sign-in method.',
  errLogin: (msg: string) => `Login failed: ${msg}`,
  errLocalOnly: (title: string) =>
    `"${title}" saved on this device only - it could not reach the cloud, ` +
    'so it will not show up on your other devices yet.',
  recipeFallback: 'Recipe',
  errUnsupportedUrl: 'Please paste a TikTok, Instagram or YouTube link.',
  errSignInToShare: 'Sign in to share recipes.',
  errShare: (msg: string) => `Failed to create share link: ${msg}`,
  errSuggest: 'Could not get a suggestion right now.',
  youtubeTip: '💡 Tip: Try using TikTok or Instagram links instead',
  confirmDelete: 'Are you sure you want to delete this recipe?',

  // Share toast
  copied: 'Copied!',
  copy: 'Copy',

  // Extract form
  urlPlaceholder: 'Paste TikTok, Instagram or YouTube link...',
  clearLink: 'Clear the link',
  clear: 'Clear',
  extracting: 'Extracting...',
  getRecipe: 'Get Recipe',

  // Collection import
  collection: 'Collection',
  checkingRecipes: 'Checking which videos are recipes...',
  selectedOf: (n: number, total: number) => `${n} of ${total} selected`,
  all: 'All',
  none: 'None',
  video: (n: number) => `Video ${n}`,
  alreadySaved: 'already saved',
  noRecipeFound: 'no recipe found',
  importN: (n: number) => `Import ${n} ${plural(n, 'Recipe', 'Recipes')}`,
  unfinishedImport: 'Unfinished import',
  leftFromLastImport: (n: number) => `${n} ${plural(n, 'recipe', 'recipes')} left from your last import.`,
  resume: 'Resume',
  discard: 'Discard',
  importing: (done: number, total: number) => `Importing recipes... ${done}/${total}`,
  importComplete: 'Import complete',
  importPaused: 'Import paused',
  importStopped: 'Import stopped',
  stillQueued: (n: number) => ` ${n} ${plural(n, 'recipe is', 'recipes are')} still queued - press Resume to continue.`,
  savedCount: (n: number) => `${n} saved`,
  skippedCount: (n: number) => `${n} already had`,
  failedCount: (n: number) => `${n} failed`,
  starting: 'Starting...',
  keepTabOpen: 'Keep this tab open. Recipes appear in your cookbook as they finish.',
  showProblems: (n: number) => `Show ${n} ${plural(n, 'problem', 'problems')}`,
  cancelImport: 'Cancel import',
  dismiss: 'Dismiss',
  untitled: 'Untitled',
  reasonSkippedBefore: 'Skipped - no recipe was found in this video on a previous run',
  reasonNoIngredients: 'No ingredients could be extracted',
  reasonExtractionFailed: 'Extraction failed',
  reasonRepeatedErrors: 'Repeated temporary errors - the rest stayed in the queue.',

  // Recipe detail
  saveAsPdf: 'Save as PDF',
  shareRecipe: 'Share recipe',
  deleteRecipe: 'Delete Recipe',
  ingredients: 'Ingredients',
  instructions: 'Instructions',
  savedToCookbook: 'Saved to Cookbook!',
  saveToCookbook: 'Save to Cookbook',

  // Suggest
  feelingLike: '✨ What am I feeling like?',
  reset: 'Reset',
  suggestExplainer: (n: number) =>
    `Picks from the ${n} ${plural(n, 'recipe', 'recipes')} in your cookbook - ` +
    'it only ever suggests something you have actually saved.',
  moodPlaceholder: "Anything else? e.g. 'nothing heavy, no oven, 20 minutes'",
  thinking: 'Thinking...',
  surpriseMe: 'Surprise me',
  suggest: 'Suggest',
  saveFirst: 'Save a few recipes first and this will have something to pick from.',
  considered: (n: number, total: number) => `Considered the ${n} most relevant of your ${total} recipes.`,
  nothingFits: 'Nothing in your cookbook really fits that. Try fewer chips, or different wording.',

  // Cookbook
  searchPlaceholder: "Search (try 'kip' or 'chicken')...",
  clearSearch: 'Clear the search',
  cancel: 'Cancel',
  select: 'Select',
  deselectAll: 'Deselect All',
  selectAll: 'Select All',
  nSelected: (n: number) => `${n} selected`,
  selectHint: 'Tap recipes, or hold one and drag',
  exportPdfTitle: 'Export the selected recipes as one PDF, one recipe per page',
  export: 'Export',
  cookbookPdfTitle: 'Export as a cookbook PDF: cover page, table of contents and recipes grouped by category',
  cookbook: 'Cookbook',
  creatingLink: 'Creating link...',
  share: 'Share',
  recipeCount: (n: number) => `${n} ${plural(n, 'recipe', 'recipes')}`,
  loadingRecipes: 'Loading your recipes...',
  noMatch: 'No recipes match your filter.',
  noRecipesYet: 'No recipes saved yet. Extract one to get started!',

  // Share page
  loadingShared: 'Loading shared recipes...',
  linkNotFound: 'Link not found',
  shareNotFound: 'Share link not found or expired.',
  goToApp: 'Go to ChefSocial →',
  sharedWithYou: (n: number) => (n === 1 ? 'A recipe was shared with you' : `${n} recipes were shared with you`),
  saveAllToCookbook: 'Save all to my Cookbook',
  saved: 'Saved!',
  save: 'Save',
  saveFailed: 'Failed to save. Please try again.',
  makeYourOwn: 'Make your own cookbook at ChefSocial →',

  // PDF
  pdfCookbookTitle: 'My Cookbook',
  pdfContents: 'Contents',
  pdfPrep: 'Prep',
  pdfCook: 'Cook',
  pdfServes: 'Serves',
  pdfSource: 'Source',
  pdfUntitled: 'Untitled recipe',
  pdfMoreRecipes: 'More Recipes',
};

export type Strings = typeof en;

const nl: Strings = {
  signIn: 'Inloggen met Google',
  signingIn: 'Bezig met inloggen...',
  user: 'Gebruiker',
  newRecipe: '+ Nieuw recept',
  cookbookNav: '📚 Kookboek',
  whatToCook: '✨ Wat eten we?',
  myCookbook: (n) => `Mijn kookboek (${n})`,
  exportCookbook: 'Kookboek exporteren',
  cookbookPdf: 'Kookboek als PDF',
  resetImportCache: 'Importgeheugen wissen',
  logOut: 'Uitloggen',
  switchLanguage: 'English',

  pendingSyncWarning: (n) =>
    `${n} ${plural(n, 'recept', 'recepten')} op dit apparaat ${plural(n, 'staat', 'staan')} nog niet in de cloud ` +
    `en ${plural(n, 'is', 'zijn')} dus niet zichtbaar op je andere apparaten.`,
  syncing: 'Synchroniseren...',
  retrySync: 'Opnieuw synchroniseren',
  signInToSync: 'Log in om te synchroniseren',
  errOfflineCache: 'De database is nu niet bereikbaar - je opgeslagen kopie wordt getoond. Trek omlaag om het opnieuw te proberen.',
  errEmptyButLocal: (n) =>
    `De database gaf geen recepten terug, maar er staan er ${n} op dit apparaat. ` +
    'Die blijven bewaard in plaats van je kookboek te wissen - herlaad om het opnieuw te proberen.',
  errPermission: 'Geen toegang tot de database. Controleer of je Firestore Security Rules leestoegang toestaan.',
  errUnreachable: 'De database is niet bereikbaar. Opgeslagen gegevens worden getoond.',
  errSyncRemaining: (n, detail) =>
    `${n} ${plural(n, 'recept kon', 'recepten konden')} niet in de cloud worden opgeslagen${detail ? ` (${detail})` : ''}. ` +
    `${plural(n, 'Het staat', 'Ze staan')} alleen op dit apparaat.`,
  errMigration: 'Sommige recepten van dit apparaat konden niet worden geüpload. Ze staan nog lokaal opgeslagen.',
  errUnauthorizedDomain: (host) =>
    `Inloggen mislukt: dit domein (${host}) is niet toegestaan in je Firebase Console. ` +
    'Voeg het toe onder Authentication > Settings > Authorized domains.',
  errSignInDisabled:
    'Inloggen mislukt: inloggen met Google staat uit. Zet het aan in de Firebase Console onder Authentication > Sign-in method.',
  errLogin: (msg) => `Inloggen mislukt: ${msg}`,
  errLocalOnly: (title) =>
    `"${title}" is alleen op dit apparaat opgeslagen - de cloud was niet bereikbaar, ` +
    'dus het verschijnt nog niet op je andere apparaten.',
  recipeFallback: 'Recept',
  errUnsupportedUrl: 'Plak een link van TikTok, Instagram of YouTube.',
  errSignInToShare: 'Log in om recepten te delen.',
  errShare: (msg) => `Deellink maken mislukt: ${msg}`,
  errSuggest: 'Er kon nu geen suggestie worden opgehaald.',
  youtubeTip: '💡 Tip: probeer een link van TikTok of Instagram',
  confirmDelete: 'Weet je zeker dat je dit recept wilt verwijderen?',

  copied: 'Gekopieerd!',
  copy: 'Kopiëren',

  urlPlaceholder: 'Plak een link van TikTok, Instagram of YouTube...',
  clearLink: 'Link wissen',
  clear: 'Wissen',
  extracting: 'Bezig met ophalen...',
  getRecipe: 'Recept ophalen',

  collection: 'Collectie',
  checkingRecipes: 'Kijken welke video’s recepten zijn...',
  selectedOf: (n, total) => `${n} van ${total} geselecteerd`,
  all: 'Alles',
  none: 'Geen',
  video: (n) => `Video ${n}`,
  alreadySaved: 'al opgeslagen',
  noRecipeFound: 'geen recept gevonden',
  importN: (n) => `${n} ${plural(n, 'recept', 'recepten')} importeren`,
  unfinishedImport: 'Onafgemaakte import',
  leftFromLastImport: (n) => `Er ${plural(n, 'staat', 'staan')} nog ${n} ${plural(n, 'recept', 'recepten')} van je vorige import klaar.`,
  resume: 'Hervatten',
  discard: 'Weggooien',
  importing: (done, total) => `Recepten importeren... ${done}/${total}`,
  importComplete: 'Import voltooid',
  importPaused: 'Import gepauzeerd',
  importStopped: 'Import gestopt',
  stillQueued: (n) => ` Er ${plural(n, 'staat', 'staan')} nog ${n} ${plural(n, 'recept', 'recepten')} in de wachtrij - druk op Hervatten om door te gaan.`,
  savedCount: (n) => `${n} opgeslagen`,
  skippedCount: (n) => `${n} had je al`,
  failedCount: (n) => `${n} mislukt`,
  starting: 'Starten...',
  keepTabOpen: 'Laat dit tabblad open. Recepten verschijnen in je kookboek zodra ze klaar zijn.',
  showProblems: (n) => `${n} ${plural(n, 'probleem', 'problemen')} tonen`,
  cancelImport: 'Import annuleren',
  dismiss: 'Sluiten',
  untitled: 'Naamloos',
  reasonSkippedBefore: 'Overgeslagen - bij een eerdere poging is in deze video geen recept gevonden',
  reasonNoIngredients: 'Er konden geen ingrediënten worden gevonden',
  reasonExtractionFailed: 'Ophalen mislukt',
  reasonRepeatedErrors: 'Herhaaldelijk tijdelijke fouten - de rest staat nog in de wachtrij.',

  saveAsPdf: 'Opslaan als PDF',
  shareRecipe: 'Recept delen',
  deleteRecipe: 'Recept verwijderen',
  ingredients: 'Ingrediënten',
  instructions: 'Bereiding',
  savedToCookbook: 'Opgeslagen in je kookboek!',
  saveToCookbook: 'Opslaan in kookboek',

  feelingLike: '✨ Waar heb ik zin in?',
  reset: 'Opnieuw',
  suggestExplainer: (n) =>
    `Kiest uit de ${n} ${plural(n, 'recept', 'recepten')} in je kookboek - ` +
    'je krijgt alleen iets voorgesteld dat je echt hebt opgeslagen.',
  moodPlaceholder: "Nog iets? bijv. 'niet te zwaar, geen oven, 20 minuten'",
  thinking: 'Even denken...',
  surpriseMe: 'Verras me',
  suggest: 'Voorstellen',
  saveFirst: 'Sla eerst een paar recepten op, dan valt er iets te kiezen.',
  considered: (n, total) => `De ${n} meest relevante van je ${total} recepten bekeken.`,
  nothingFits: 'Niets in je kookboek past daar echt bij. Kies minder opties of omschrijf het anders.',

  searchPlaceholder: "Zoeken (probeer 'kip' of 'chicken')...",
  clearSearch: 'Zoekopdracht wissen',
  cancel: 'Annuleren',
  select: 'Selecteren',
  deselectAll: 'Niets selecteren',
  selectAll: 'Alles selecteren',
  nSelected: (n) => `${n} geselecteerd`,
  selectHint: 'Tik op recepten, of houd er een vast en sleep',
  exportPdfTitle: 'De geselecteerde recepten exporteren als één PDF, één recept per pagina',
  export: 'Exporteren',
  cookbookPdfTitle: 'Exporteren als kookboek-PDF: omslag, inhoudsopgave en recepten per categorie',
  cookbook: 'Kookboek',
  creatingLink: 'Link maken...',
  share: 'Delen',
  recipeCount: (n) => `${n} ${plural(n, 'recept', 'recepten')}`,
  loadingRecipes: 'Je recepten laden...',
  noMatch: 'Geen recepten gevonden die hierbij passen.',
  noRecipesYet: 'Nog geen recepten opgeslagen. Haal er een op om te beginnen!',

  loadingShared: 'Gedeelde recepten laden...',
  linkNotFound: 'Link niet gevonden',
  shareNotFound: 'Deellink niet gevonden of verlopen.',
  goToApp: 'Naar ChefSocial →',
  sharedWithYou: (n) => (n === 1 ? 'Er is een recept met je gedeeld' : `Er zijn ${n} recepten met je gedeeld`),
  saveAllToCookbook: 'Alles opslaan in mijn kookboek',
  saved: 'Opgeslagen!',
  save: 'Opslaan',
  saveFailed: 'Opslaan mislukt. Probeer het opnieuw.',
  makeYourOwn: 'Maak je eigen kookboek met ChefSocial →',

  pdfCookbookTitle: 'Mijn kookboek',
  pdfContents: 'Inhoud',
  pdfPrep: 'Voorbereiding',
  pdfCook: 'Bereiding',
  pdfServes: 'Personen',
  pdfSource: 'Bron',
  pdfUntitled: 'Naamloos recept',
  pdfMoreRecipes: 'Overige recepten',
};

export const STRINGS: Record<Lang, Strings> = { en, nl };

/**
 * Dutch names for the labels a recipe can carry: the tag vocabulary the
 * extractor is told to use (backend/main.py, parse_with_llm) plus the labels
 * derived in lib/labels.ts, and the mood chips. Keys are normalised with `labelKey`. A tag outside
 * this list is shown as-is.
 */
const LABELS_NL: Record<string, string> = {
  // Meals
  'breakfast': 'Ontbijt',
  'brunch': 'Brunch',
  'lunch': 'Lunch',
  'dinner': 'Diner',
  'snack': 'Snack',
  'dessert': 'Dessert',
  'appetizer': 'Voorgerecht',
  'drink': 'Drankje',
  // Dishes
  'airfryer': 'Airfryer',
  'bbq': 'BBQ',
  'slow cooker': 'Slowcooker',
  'pasta': 'Pasta',
  'pizza': 'Pizza',
  'burger': 'Burger',
  'sandwich': 'Broodje',
  'wrap': 'Wrap',
  'tacos': 'Taco’s',
  'salad': 'Salade',
  'bowl': 'Bowl',
  'soup': 'Soep',
  'stew': 'Stoofpot',
  'curry': 'Curry',
  'rice': 'Rijst',
  'meat': 'Vlees',
  'fish': 'Vis',
  'chicken': 'Kip',
  'vegetarian': 'Vegetarisch',
  'vegan': 'Veganistisch',
  'low carb': 'Koolhydraatarm',
  'high protein': 'Eiwitrijk',
  'smoothie': 'Smoothie',
  'cocktail': 'Cocktail',
  'sauce': 'Saus',
  'side': 'Bijgerecht',
  // Extras
  'healthy': 'Gezond',
  'quick': 'Snel',
  'spicy': 'Pittig',
  'traditional': 'Traditioneel',
  'one pan': 'Eén pan',
  // Derived (lib/labels.ts)
  'under 20 min': 'Binnen 20 min',
  'under 40 min': 'Binnen 40 min',
  'about an hour': 'Ongeveer een uur',
  'low & slow': 'Lang en langzaam',
  'beef': 'Rund',
  'pork': 'Varken',
  'seafood': 'Zeevruchten',
  'lamb': 'Lam',
  'bbq / grill': 'BBQ / grill',
  'oven': 'Oven',
  'no cook': 'Zonder koken',
  '5 ingredients or fewer': 'Max. 5 ingrediënten',
  // Mood chips (lib/recommend.ts)
  'quick (under 20 min)': 'Snel (binnen 20 min)',
  'comfort food': 'Comfortfood',
  'healthy & light': 'Gezond & licht',
  'one pan / minimal washing up': 'Eén pan / weinig afwas',
  'cooking to impress': 'Om indruk te maken',
  // Ingredient groups the extractor commonly uses
  'main': 'Basis',
  'marinade': 'Marinade',
  'batter': 'Beslag',
  'dressing': 'Dressing',
  'topping': 'Topping',
  'garnish': 'Garnering',
  'filling': 'Vulling',
  'dough': 'Deeg',
  'glaze': 'Glazuur',
};

/** The label as it should be shown in `lang`. */
export function labelText(value: string, lang: Lang): string {
  if (lang === 'en') return value;
  return LABELS_NL[labelKey(value)] ?? value;
}

/** Every spelling of a label, for search: the stored value plus its Dutch name. */
export function labelSpellings(value: string): string[] {
  const nlName = LABELS_NL[labelKey(value)];
  return nlName && nlName !== value ? [value, nlName] : [value];
}

// ---------------------------------------------------------------------------

const STORAGE_KEY = 'chefSocial_lang';

/** The language for code outside React (the import hook, PDF export). Kept in
 *  step with the provider below. */
let currentLang: Lang = 'en';

export function getLang(): Lang {
  return currentLang;
}

export function getStrings(): Strings {
  return STRINGS[currentLang];
}

function detectLang(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'en' || stored === 'nl') return stored;
  } catch { /* storage blocked */ }
  if (typeof navigator !== 'undefined') {
    const prefs = navigator.languages?.length ? navigator.languages : [navigator.language];
    if (prefs.some(l => l?.toLowerCase().startsWith('nl'))) return 'nl';
  }
  return 'en';
}

interface LangContextValue {
  lang: Lang;
  t: Strings;
  setLang: (lang: Lang) => void;
}

const LangContext = React.createContext<LangContextValue>({
  lang: 'en',
  t: en,
  setLang: () => {},
});

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  // Starts as English so the server render and first client render agree; the
  // stored / browser preference is applied straight after mount.
  const [lang, setLangState] = React.useState<Lang>('en');

  React.useEffect(() => {
    setLangState(detectLang());
  }, []);

  React.useEffect(() => {
    currentLang = lang;
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = React.useCallback((next: Lang) => {
    currentLang = next;
    setLangState(next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* storage blocked */ }
  }, []);

  const value = React.useMemo(() => ({ lang, t: STRINGS[lang], setLang }), [lang, setLang]);
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useLang(): LangContextValue {
  return React.useContext(LangContext);
}
