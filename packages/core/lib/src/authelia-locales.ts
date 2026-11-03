/**
 * Authelia's portal in a domain's language (packages/core/docs/page-language-design.md §3):
 * the forced locale files a domain's rendering holds, Lamaste's supplement
 * of the Turkish strings Authelia 4.39.28 lacks and its corrections, and
 * the portal's contracts the forcing relies on.
 *
 * Authelia cannot be told a language: its portal detects one (i18next,
 * `detection.order` = the visitor's own choice from the language menu, then
 * the browser's languages) and loads `/locales/<detected>/<namespace>.json`
 * for it, its parent and `en`. A domain with a language therefore answers
 * **every** locale path of a namespace with one rendered file
 * (`locales/forced/<namespace>.json`, a regex location in the auth vhost),
 * hides the language menu (`#language-button`, which would offer choices
 * that change nothing) and rewrites the index's `<html lang="…">` and
 * `<noscript>` text with `sub_filter` ({@link autheliaIndexLanguageFilters}).
 *
 * Each of those is a contract of Authelia 4.39.28, pinned by unit tests
 * against verbatim fixtures of its files (`test/fixtures/authelia-4.39.28/`);
 * a pin bump that moves one fails the build. A relay running a newer
 * Authelia than the pin degrades to a mix of languages, never to a broken
 * page (the design's "What Authelia can do").
 *
 * Browser-safe (no node built-ins).
 */

import { htmlAsciiReferences } from './page-messages.js';
import type { PageLanguage } from './page-messages.js';

// ---------------------------------------------------------------------------
// The portal's contracts (Authelia 4.39.28)
// ---------------------------------------------------------------------------

/** The namespaces the portal loads (`ns` in `web/src/i18n/index.ts`). */
export const AUTHELIA_FORCED_NAMESPACES = ['consent', 'portal', 'settings'] as const;

export type AutheliaNamespace = (typeof AUTHELIA_FORCED_NAMESPACES)[number];

/** How the portal picks its language (`detection.order` in `web/src/i18n/index.ts`). */
export const AUTHELIA_LANGUAGE_DETECTION_ORDER = ['localStorageCustom', 'navigator'] as const;

/** The portal's language menu (`web/src/components/AppBarItemLanguage.tsx`), hidden on a domain with a language. */
export const AUTHELIA_LANGUAGE_MENU_SELECTOR = '#language-button';

/** The literal start of the index's root element (`web/index.html`: `<html lang="{{ .Language }}">`). */
export const AUTHELIA_INDEX_LANG_LITERAL = '<html lang="';

/** The index's `<noscript>` text (`web/index.html`). */
export const AUTHELIA_NOSCRIPT_TEXT = 'You need to enable JavaScript to run this app.';

/** The `<noscript>` text in each language (§8.4). */
export const AUTHELIA_NOSCRIPT_TRANSLATIONS: Readonly<Record<PageLanguage, string>> = Object.freeze(
  {
    en: AUTHELIA_NOSCRIPT_TEXT,
    tr: 'Bu uygulama için tarayıcınızda JavaScript etkin olmalıdır.',
  },
);

/** Authelia's own locale for each language: the embedded file a forced file starts from. */
export const AUTHELIA_LOCALE_OF_LANGUAGE: Readonly<Record<PageLanguage, string>> = Object.freeze({
  en: 'en',
  tr: 'tr-TR',
});

/** Where a domain's forced locale files are rendered: `locales/forced/<namespace>.json`. */
export const AUTHELIA_FORCED_LOCALES_DIR = 'locales/forced';

/** The rendered path of a forced locale file. */
export function forcedAutheliaLocaleFile(namespace: AutheliaNamespace): string {
  if (!(AUTHELIA_FORCED_NAMESPACES as readonly string[]).includes(namespace)) {
    throw new Error(`Not a namespace the portal loads: "${namespace}"`);
  }
  return `${AUTHELIA_FORCED_LOCALES_DIR}/${namespace}.json`;
}

/**
 * The `sub_filter` pairs that put Authelia's index in `language`: the root
 * element's `lang` (the cookie's value Authelia writes moves into a harmless
 * data attribute) and, for a language other than English, the
 * `<noscript>` text. Every string is printable ASCII without `$` — the
 * Turkish written as HTML character references — because `lamaste-priv`
 * refuses anything else in a vhost.
 */
export function autheliaIndexLanguageFilters(
  language: PageLanguage,
): ReadonlyArray<readonly [string, string]> {
  const filters: Array<readonly [string, string]> = [
    [AUTHELIA_INDEX_LANG_LITERAL, `<html lang="${language}" data-authelia-lang="`],
  ];
  const noscript = AUTHELIA_NOSCRIPT_TRANSLATIONS[language];
  if (noscript !== AUTHELIA_NOSCRIPT_TEXT) {
    filters.push([AUTHELIA_NOSCRIPT_TEXT, htmlAsciiReferences(noscript)]);
  }
  for (const pair of filters) {
    for (const text of pair) {
      if (!/^[\x20-\x7e]+$/.test(text) || text.includes('$')) {
        throw new Error('A sub_filter text is printable ASCII without $');
      }
    }
  }
  return filters;
}

// ---------------------------------------------------------------------------
// The supplement and the corrections
// ---------------------------------------------------------------------------

/** A locale file's messages: keys (the English source strings) to texts or nested groups. */
export interface AutheliaMessages {
  readonly [key: string]: string | AutheliaMessages;
}

/**
 * Lamaste's texts for the keys Authelia 4.39.28's locale of a language
 * lacks (reviewed Turkish, §8.4): a forced file takes them where
 * Authelia has none, so a visitor never reads a sentence in English.
 */
export const AUTHELIA_SUPPLEMENT: Readonly<
  Record<PageLanguage, Readonly<Partial<Record<AutheliaNamespace, AutheliaMessages>>>>
> = Object.freeze({
  en: {},
  tr: {
    portal: {
      'Enter your password to confirm your identity': 'Kimliğinizi doğrulamak için şifrenizi girin',
      'Failed to confirm your identity': 'Kimliğiniz doğrulanamadı',
      'Failed to redirect you': 'Yönlendirme yapılamadı',
      Home: 'Ana sayfa',
      Language: 'Dil',
      Loading: 'Yükleniyor',
      'Logout and clear any current flow': 'Oturumu kapat ve mevcut işlemi iptal et',
      'Logout and continue the current flow': 'Oturumu kapat ve mevcut işleme devam et',
      Settings: 'Ayarlar',
      'Sign in with a passkey': 'Geçiş anahtarıyla giriş yap',
      'Switch User': 'Kullanıcı Değiştir',
      'Toggle password visibility': 'Şifreyi göster veya gizle',
      Warning: 'Uyarı',
      'You have made too many requests': 'Çok fazla istekte bulundunuz',
      'You must view and accept the Privacy Policy before using {{authelia}}.':
        '{{authelia}} hizmetini kullanmadan önce <policy>gizlilik politikasını</policy> görüntüleyip kabul etmeniz gerekir',
      or: 'veya',
    },
    settings: {
      'Caps Lock is on': 'Caps Lock açık',
      'Change Password': 'Şifreyi Değiştir',
      'Cross-Platform': 'Platformlar Arası',
      Delete: 'Sil',
      'Email One-Time Code': 'E-posta ile Tek Seferlik Kod',
      Email: 'E-posta',
      Edit: 'Düzenle',
      'Edit WebAuthn Credential': 'WebAuthn Kimlik Bilgisini Düzenle',
      'Failed to get session elevation status': 'Oturum yükseltme durumu alınamadı',
      'Incorrect password': 'Yanlış şifre',
      'In order to perform this action, policy enforcement requires that two-factor authentication is performed':
        'Bu işlemi yapabilmek için iki faktörlü kimlik doğrulama yapmanız gerekiyor',
      Information: 'Bilgi',
      'New Password': 'Yeni Şifre',
      'Old Password': 'Eski Şifre',
      Password: 'Şifre',
      'Repeat New Password': 'Yeni Şifre (Tekrar)',
      'Passwords do not match': 'Şifreler eşleşmiyor',
      'Password changed successfully': 'Şifre başarıyla değiştirildi',
      Platform: 'Platform',
      Security: 'Güvenlik',
      'Select a Method': 'Bir Yöntem Seçin',
      Submit: 'Gönder',
      'The decision to disable WebAuthn Credentials when Multi-Factor Authentication is enabled significantly undermines security and is highly inadvisable':
        'Çok faktörlü kimlik doğrulama etkinken WebAuthn kimlik bilgilerini devre dışı bırakmak güvenliği ciddi biçimde zayıflatır ve kesinlikle önerilmez',
      'There was an issue changing the password': 'Şifre değiştirilirken bir sorun oluştu',
      'There was an issue retrieving configuration': 'Yapılandırma alınırken bir sorun oluştu',
      'This is disabled by your administrator':
        'Bu özellik yöneticiniz tarafından devre dışı bırakılmış',
      'Toggle new password visibility': 'Yeni şifreyi göster veya gizle',
      'Toggle old password visibility': 'Eski şifreyi göster veya gizle',
      'Toggle repeat new password visibility': 'Yeni şifre tekrarını göster veya gizle',
      Username: 'Kullanıcı adı',
      Name: 'Ad',
      WebAuthn: 'WebAuthn',
      "WebAuthn Credentials are widely considered the most secure means of authentication, regardless of if they're used for Multi-Factor Authentication or Passwordless Authentication":
        'WebAuthn kimlik bilgileri, ister çok faktörlü ister şifresiz kimlik doğrulama için kullanılsın, genel olarak en güvenli kimlik doğrulama yöntemi kabul edilir',
      'You can only register a single One-Time Password':
        'Yalnızca bir Tek Seferlik Şifre kaydedebilirsiniz',
      'You cannot reuse your old password': 'Eski şifrenizi yeniden kullanamazsınız',
      'Your administrator has disabled WebAuthn preventing you from registering WebAuthn Credentials including Passkeys':
        'Yöneticiniz WebAuthn özelliğini devre dışı bıraktığı için geçiş anahtarları dâhil hiçbir WebAuthn kimlik bilgisi kaydedemezsiniz',
      'Your supplied password does not meet the password policy requirements':
        'Girdiğiniz şifre, şifre politikasının gereksinimlerini karşılamıyor',
    },
    consent: {
      'Accept this consent request': 'Bu onay isteğini kabul et',
      'Deny this consent request': 'Bu onay isteğini reddet',
      'An error occurred processing the request': 'İstek işlenirken bir hata oluştu',
      Code: 'Kod',
      'Confirm the Code': 'Kodu Onaylayın',
      'Enter the code displayed on your device': 'Cihazınızda görüntülenen kodu girin',
      'Failed to submit the user code': 'Kullanıcı kodu gönderilemedi',
      'Consent has been accepted and processed': 'Onay kabul edildi ve işlendi',
      'Consent has been rejected and processed': 'Onay reddedildi ve işlendi',
      'Debug Information': 'Hata Ayıklama Bilgisi',
      Description: 'Açıklama',
      Documentation: 'Belgeler',
      Error: 'Hata',
      'Error Code': 'Hata Kodu',
      Hint: 'İpucu',
      Required: 'Zorunlu',
      'Hide request details': 'İstek ayrıntılarını gizle',
      'Show request details': 'İstek ayrıntılarını göster',
      'Return to the consent request': 'Onay isteğine dön',
      'Information Shared': 'Paylaşılan Bilgiler',
      'Requested Permissions': 'İstenen İzinler',
      'Requested Resources': 'İstenen Kaynaklar',
      'Token Audience': 'Belirteç Alıcıları',
      'The actions the application will be allowed to perform on your behalf':
        'Uygulamanın sizin adınıza yapmasına izin verilecek işlemler',
      'The information about you the application will receive':
        'Uygulamanın sizinle ilgili alacağı bilgiler',
      'The protected resources the application intends to access':
        'Uygulamanın erişmek istediği korumalı kaynaklar',
      'The services the issued tokens will be valid for':
        'Verilen belirteçlerin geçerli olacağı hizmetler',
      'You may close this tab or return home by clicking the home button':
        'Bu sekmeyi kapatabilir ya da ana sayfa düğmesiyle ana sayfaya dönebilirsiniz',
      'You must reauthenticate to be able to give consent':
        'Onay verebilmek için yeniden kimlik doğrulaması yapmanız gerekiyor',
      'You will be asked to review the request next': 'Ardından isteği incelemeniz istenecek',
      scopes: {
        'authelia.pam': 'Bir Linux sistemine sizin kimliğinizle giriş yapma',
      },
    },
  },
});

/**
 * Lamaste's texts in place of Authelia 4.39.28's for a few keys whose
 * translation is wrong (§8.4; each also offered to Authelia's translators).
 */
export const AUTHELIA_CORRECTIONS: Readonly<
  Record<PageLanguage, Readonly<Partial<Record<AutheliaNamespace, AutheliaMessages>>>>
> = Object.freeze({
  en: {},
  tr: {
    portal: {
      'Powered by {{authelia}}': 'Altyapı: {{authelia}}',
      'Must be at least {{len}} characters in length':
        'En az {{len}} karakter uzunluğunda olmalıdır',
      'Failed to revoke the One-Time Code': 'Tek Seferlik Kod iptal edilemedi',
    },
  },
});

// ---------------------------------------------------------------------------
// The forced file
// ---------------------------------------------------------------------------

/** What {@link renderForcedAutheliaLocale} made. */
export interface ForcedAutheliaLocale {
  /** The file's messages: every key of Authelia's English file, in its order. */
  readonly messages: Record<string, unknown>;
  /**
   * The keys (dotted paths) no text of the language covers, filled from
   * Authelia's English — empty for the pinned release; after a pin bump or
   * on a newer running Authelia, the keys it added.
   */
  readonly fromEnglish: readonly string[];
}

function isGroup(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * One namespace's forced file in `language`: for every key of Authelia's
 * English file (`english`, the running release's), Lamaste's correction,
 * else the text of Authelia's own locale for the language (`embedded`, null
 * when it serves none), else Lamaste's supplement, else Authelia's English
 * (listed in `fromEnglish`). Keys Authelia's English does not have are
 * dropped: the portal never asks for them. Non-string values are kept as
 * English has them. The brand name is spliced in afterwards by the caller
 * (`renderBrandLocale`).
 */
export function renderForcedAutheliaLocale(input: {
  readonly namespace: AutheliaNamespace;
  readonly language: PageLanguage;
  readonly english: Readonly<Record<string, unknown>>;
  readonly embedded: Readonly<Record<string, unknown>> | null;
}): ForcedAutheliaLocale {
  const corrections = AUTHELIA_CORRECTIONS[input.language][input.namespace] ?? {};
  const supplement = AUTHELIA_SUPPLEMENT[input.language][input.namespace] ?? {};
  const fromEnglish: string[] = [];
  const walk = (
    english: Readonly<Record<string, unknown>>,
    embedded: unknown,
    correction: unknown,
    extra: unknown,
    prefix: string,
  ): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    const own = (group: unknown, key: string): unknown =>
      isGroup(group) && Object.prototype.hasOwnProperty.call(group, key) ? group[key] : undefined;
    for (const [key, value] of Object.entries(english)) {
      const mine = own(embedded, key);
      const fixed = own(correction, key);
      const added = own(extra, key);
      if (isGroup(value)) {
        out[key] = walk(value, mine, fixed, added, `${prefix}${key}.`);
      } else if (typeof value !== 'string') {
        out[key] = value;
      } else if (typeof fixed === 'string') {
        out[key] = fixed;
      } else if (typeof mine === 'string') {
        out[key] = mine;
      } else if (typeof added === 'string') {
        out[key] = added;
      } else {
        out[key] = value;
        if (input.language !== 'en') fromEnglish.push(`${prefix}${key}`);
      }
    }
    return out;
  };
  const embedded = input.language === 'en' ? input.english : input.embedded;
  const messages = walk(input.english, embedded, corrections, supplement, '');
  return { messages, fromEnglish };
}
