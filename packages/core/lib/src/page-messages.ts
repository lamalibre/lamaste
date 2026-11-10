/**
 * The words of the pages a person meets on a domain's sign-in host and on
 * a plugin's site (packages/core/docs/page-language-design.md): the
 * invitation page, the inviter's page, the "not available" page of a
 * plugin's site, and Gatekeeper's access-request, refusal and "not
 * allowed" pages — in every language a domain can be set to.
 *
 * Browser-safe (no node built-ins), exported as
 * `@lamalibre/lamaste/page-messages`: the panel's language picker and the
 * branding preview import the languages and texts instead of copying them.
 *
 * A domain's language decides every page on it (decision D3: the visitor's
 * `Accept-Language` plays no part). The catalogues are typed: every key of
 * {@link PAGE_MESSAGES_EN} must have a Turkish text, or the build fails.
 * Each page embeds only its own keys ({@link INVITE_PAGE_KEYS}, …).
 *
 * Writing rules the catalogue keeps (§8 of the design): `{name}`
 * placeholders, filled in one pass ({@link formatMessage}) so a value is
 * never read as a template; a Turkish text never puts a suffix on an
 * interpolated name (vowel harmony depends on a word Lamaste does not know);
 * plurals by `Intl.PluralRules` (`<key>_one`, `<key>_other`). A name is not
 * translated: plugin, role, inviter, host and brand names are shown as they
 * are given.
 */

/** The languages a domain's pages can speak. */
export const PAGE_LANGUAGES = ['en', 'tr'] as const;

export type PageLanguage = (typeof PAGE_LANGUAGES)[number];

/** Each language's own name, as a picker shows it. */
export const PAGE_LANGUAGE_NAMES: Readonly<Record<PageLanguage, string>> = Object.freeze({
  en: 'English',
  tr: 'Türkçe',
});

export function isPageLanguage(value: unknown): value is PageLanguage {
  return typeof value === 'string' && (PAGE_LANGUAGES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// The catalogues
// ---------------------------------------------------------------------------

/** English: the source of every key. */
export const PAGE_MESSAGES_EN = {
  // The invitation page (P2)
  'invite.title': 'Accept Invitation',
  'invite.loading': 'Loading invitation…',
  'invite.invalidLink': 'This invitation link is not valid.',
  'invite.unavailableTitle': 'Invitation Unavailable',
  'invite.invitedTitle': 'You’ve Been Invited',
  'invite.adminSubtitle': 'Set your password to create your account.',
  'invite.delegatedBy': '{inviter} invited you to {plugin} as {role}.',
  'invite.delegated': 'You are invited to {plugin} as {role}.',
  'invite.username': 'Username',
  'invite.usernameHint':
    'You sign in with it. Lower-case letters, digits, - and _; it cannot be changed later.',
  'invite.email': 'Email',
  'invite.expires': 'Expires',
  'invite.yourName': 'Your name',
  'invite.password': 'Password',
  'invite.passwordHint': 'At least 8 characters',
  'invite.confirmPassword': 'Confirm password',
  'invite.create': 'Create Account',
  'invite.creating': 'Creating account…',
  'invite.usernameRule':
    'A username has {min} to {max} lower-case letters, digits, - and _, and starts with a letter or digit.',
  'invite.nameRequired': 'Enter your name.',
  'invite.passwordShort': 'A password has at least 8 characters.',
  'invite.passwordLong': 'A password has at most 128 characters.',
  'invite.passwordMismatch': 'The passwords do not match.',
  'invite.createdTitle': 'Account Created',
  'invite.created': 'Your account {username} has been created.',
  'invite.scanQr':
    'Scan this QR code with your authenticator app to set up two-factor authentication.',
  'invite.qrAlt': 'Two-factor QR code',
  'invite.manualEntry': 'Manual entry:',
  'invite.saveNow': 'Save this before you leave the page — it is not shown again.',
  'invite.askAdminTotp': 'Ask your administrator to set up two-factor authentication.',
  'invite.accessPending':
    'Your access is still being set up — if signing in shows nothing yet, try again in a minute.',
  'invite.goToSignIn': 'Go to sign-in',

  // The inviter's page (P1)
  'invitations.title': 'Invite People',
  'invitations.loading': 'Loading…',
  'invitations.notFoundTitle': 'Not Found',
  'invitations.notFound': 'There is no invitations page here.',
  'invitations.signInTitle': 'Sign In to Continue',
  'invitations.signInText': 'Sign in to invite people.',
  'invitations.signIn': 'Sign in',
  'invitations.signInLoop':
    'If signing in brings you back here again and again, clear this site’s cookies in your browser and sign in once more.',
  'invitations.unavailableTitle': 'Not Available',
  'invitations.unavailable':
    'You cannot invite people into this application, or invitations are turned off for it.',
  'invitations.errorTitle': 'Something Went Wrong',
  'invitations.loadFailed': 'The page could not be loaded — try again later.',
  'invitations.unreachable': 'The relay could not be reached.',
  'invitations.to': 'to {plugin}',
  'invitations.noRole': 'You may not invite anyone with your role.',
  'invitations.email': 'E-mail address',
  'invitations.emailDomains': 'Under {domains}',
  'invitations.theirName': 'Their name (optional)',
  'invitations.role': 'Role',
  'invitations.bounds_one':
    'A link works once and expires after {days} day. You have {open} of {max} open invitations.',
  'invitations.bounds_other':
    'A link works once and expires after {days} days. You have {open} of {max} open invitations.',
  'invitations.create': 'Create Invitation',
  'invitations.ready':
    'The invitation is ready. Send this link yourself — it is shown only now, and whoever opens it first can accept it.',
  'invitations.copy': 'Copy',
  'invitations.copied': 'Copied',
  'invitations.selected': 'Selected',
  'invitations.yours': 'Your invitations',
  'invitations.none': 'None yet.',
  'invitations.back': '← Back to {plugin}',
  'invitations.revoke': 'Revoke',
  'invitations.reallyRevoke': 'Really revoke?',
  'invitations.emailRequired': 'Enter an e-mail address.',
  'invitations.emailInvalid': 'Enter a valid e-mail address.',
  'status.pending': 'Pending',
  'status.expired': 'Expired',
  'status.accepting': 'Being accepted',
  'status.accepted': 'Accepted',
  'status.revoked': 'Revoked',

  // The refusals the two pages map (§6): `error.<code>`, else by status
  'error.invitation_not_found': 'This invitation link is not valid.',
  'error.invitation_used': 'This invitation has already been used.',
  'error.invitation_expired': 'This invitation has expired.',
  'error.invitation_closed': 'This invitation is no longer valid.',
  'error.invitation_revoked': 'This invitation was revoked while it was being accepted.',
  'error.invitation_accepting': 'This invitation is being accepted right now.',
  'error.invitation_unavailable': 'This invitation cannot be accepted right now — try again later.',
  'error.username_unavailable': 'This username is not available — choose another.',
  'error.username_unavailable.admin': 'This username already exists.',
  'error.invalid_request.username': 'Invalid username.',
  'error.invalid_request.password': 'Invalid password.',
  'error.invalid_request.displayName': 'Invalid name.',
  'error.invalid_request.email': 'Invalid e-mail address.',
  'error.invalid_request.role': 'Invalid role.',
  'error.invalid_request': 'Something you entered is not valid.',
  'error.invitations_unavailable': 'Invitations are not available for this application.',
  'error.email_domain_not_allowed': 'Invitations cannot go to this e-mail address’s domain.',
  'error.role_not_grantable': 'You may not invite people with this role.',
  'error.invitation_rate': 'Too many invitations in the last hour — try again later.',
  'error.invitation_cap.inviter':
    'You have reached your limit of open invitations — revoke one or wait for one to be accepted.',
  'error.invitation_cap.plugin': 'This application takes no more people by invitation.',
  'error.grant_reserve': 'No more people can be added by invitation right now.',
  'error.gatekeeper_unavailable': 'The service is not answering — try again shortly.',
  'error.authelia_storage_unavailable': 'The service is not answering — try again shortly.',
  'error.not_found': 'Invitation not found.',
  // `not_found` answering a new invitation: the application, not an invitation
  'error.not_found.create': 'Application not found.',
  'error.tooManyRequests': 'Too many requests — wait a moment and try again.',
  'error.generic': 'Something went wrong — try again later.',

  // The plugin's site when its web surface is not served (P8) …
  'unavailable.title': 'Not Available Right Now',
  'unavailable.text': 'This application is not available right now. Try again later.',
  // … and when Gatekeeper does not allow the request (P9)
  'forbidden.title': 'Not Allowed',
  'forbidden.text': 'You cannot open this page.',

  // Gatekeeper's access-request page (P6)
  'access.title': 'Access Required',
  'access.heading': 'Access Required',
  'access.noAccess': "You don't have access to {host}",
  'access.signedInAs': 'Signed in as {username}',
  'access.contact': 'Contact {admin} to request access. Copy a message template below:',
  // The `…Default` texts name no one: no operator-set name, so no placeholder
  // a language would have to put a suffix on.
  'access.contactDefault':
    'Contact your administrator to request access. Copy a message template below:',
  'access.defaultAdminSalutation': 'Administrator',
  'access.subjectLabel': 'Subject:',
  'access.labelEmail': 'Email',
  'access.copy': 'Copy',
  'access.copied': 'Copied',
  'contact.admin': 'Admin:',
  'contact.help': 'Help:',
  'template.subject': 'Access request for {resource}',
  'template.body':
    "Hi {admin},\n\nI'd like to request access to {resource}.\nMy username is: {username}\n\nThank you.",
  'template.chat': 'Hi, could I get access to `{resource}`? My username is `{username}`.',
  'template.whatsapp': 'Hi, I need access to {resource} (username: {username}). Thanks!',
  'template.generic':
    'Access request for {resource}\nUsername: {username}\nAdmin contact: {contact}',

  // Gatekeeper's domain refusal page (P7); `[…]` marks the sign-out link
  'refusal.title': 'Not allowed — {domain}',
  'refusal.notAllowedOn': 'Not allowed on {host}',
  'refusal.noDomainTitle': '{host} is not available',
  'refusal.notMember': 'Not a member of {domain}',
  'refusal.noDomain':
    "Your account is signed in, but this host is under none of this relay's domains, so nobody may open it.",
  'refusal.site':
    "Your account is signed in, but it may not open this site: it is not a member of {domain}, or not one of the site's users.",
  'refusal.domain':
    'Your account is signed in, but it is not a member of this domain, so none of its applications are open to it.',
  'refusal.ask': 'Ask {admin} to add you if you should have access.',
  'refusal.askDefault': 'Ask your administrator to add you if you should have access.',
  // A host under none of the relay's domains: adding the person cannot help
  'refusal.noDomainAsk': 'Tell {admin} if this address should work.',
  'refusal.noDomainAskDefault': 'Tell your administrator if this address should work.',
  'refusal.signOut': '[Sign out] to sign in with another account.',

  // What the forgot-password and change-password pages share
  'account.password': 'New password',
  'account.passwordHint': 'At least 8 characters',
  'account.confirmPassword': 'Confirm new password',
  'account.passwordShort': 'A password has at least 8 characters.',
  'account.passwordLong': 'A password has at most 128 characters.',
  'account.passwordMismatch': 'The passwords do not match.',
  'account.goToSignIn': 'Go to sign-in',
  // The link Lamaste adds to Authelia's portal
  'account.changePasswordLink': 'Change password',

  // The forgot-password page (/reset)
  'reset.title': 'Reset Password',
  'reset.loading': 'Loading…',
  'reset.requestTitle': 'Forgot Your Password?',
  'reset.requestText':
    'Enter your username or e-mail address. If it belongs to an account here, a link to set a new password is sent to its e-mail address.',
  'reset.identifier': 'Username or e-mail address',
  'reset.identifierRequired': 'Enter your username or e-mail address.',
  'reset.send': 'Send Link',
  'reset.sending': 'Sending…',
  'reset.sentTitle': 'Check Your E-mail',
  'reset.sent_one':
    'If an account matches, a link is on its way. It works once, for {minutes} minute.',
  'reset.sent_other':
    'If an account matches, a link is on its way. It works once, for {minutes} minutes.',
  'reset.setTitle': 'Set a New Password',
  'reset.setFor': 'For the account {username}.',
  'reset.totp': 'Authenticator code',
  'reset.totpHint': 'The six digits your authenticator app shows for this account now.',
  'reset.totpRule': 'Enter the six digits your authenticator app shows.',
  'reset.save': 'Set Password',
  'reset.saving': 'Saving…',
  'reset.doneTitle': 'Password Changed',
  'reset.done': 'You can sign in with your new password now.',
  'reset.requestAgain': 'Ask for a new link',
  'reset.unavailableTitle': 'Not Available',

  // The change-password page (/account/password)
  'password.title': 'Change Password',
  'password.loading': 'Loading…',
  'password.text': 'Enter your current password, then the new one.',
  'password.current': 'Current password',
  'password.currentRequired': 'Enter your current password.',
  'password.save': 'Change Password',
  'password.saving': 'Saving…',
  'password.doneTitle': 'Password Changed',
  'password.done': 'Your new password applies from your next sign-in.',

  // The refusals of the two account pages
  'error.reset_invalid': 'This link is not valid or has expired. Ask for a new one.',
  'error.reset_unavailable':
    'Password reset is not available here. Ask your administrator to set a new password.',
  'error.totp_invalid': 'The code is not correct. Check your authenticator app and try again.',
  'error.no_totp':
    'This account has no authenticator app set up, so its password cannot be reset by e-mail. Ask your administrator.',
  'error.current_password_invalid': 'The current password is not correct.',
  'error.password_unchanged': 'The new password is the same as the current one.',

  // The page Google's consent returns to (/mail/google/callback)
  'mailConsent.title': 'Mail Setup',
  'mailConsent.okTitle': 'Mail Is Set Up',
  'mailConsent.ok': 'The relay now sends its mail as {sender}. You may close this tab.',
  'mailConsent.failedTitle': 'Mail Was Not Set Up',
  'mailConsent.again': 'Start again from the panel’s Mail settings.',
  'mailConsent.reason.expired': 'This setup took too long, or its link was used already.',
  'mailConsent.reason.denied': 'Access was not granted on Google’s page.',
  'mailConsent.reason.sender':
    'This Google account cannot send as the sender address. Add it under “Send mail as” in the account’s Gmail settings.',
  'mailConsent.reason.token': 'Google did not hand out a token for this account.',
  'mailConsent.reason.generic': 'Something went wrong.',

  // The mails
  'mail.footer': 'Sent by {brand}.',
  'mail.ignore': 'If you did not expect this e-mail, you can ignore it.',
  'mail.invite.subject': 'Your invitation to {brand}',
  'mail.invite.subjectDelegated': 'Your invitation to {plugin}',
  'mail.invite.intro': 'You are invited to create an account on {brand}.',
  'mail.invite.introDelegated': '{inviter} invited you to {plugin} as {role}.',
  'mail.invite.introDelegatedAnonymous': 'You are invited to {plugin} as {role}.',
  'mail.invite.action': 'Accept the invitation',
  'mail.invite.expires': 'The link works once and expires on {date}.',
  'mail.reset.subject': 'Reset your password',
  'mail.reset.intro': 'Someone asked to reset the password of your account on {brand}.',
  'mail.reset.introMany':
    'Someone asked to reset the password of your accounts on {brand}. Each account has its own link.',
  'mail.reset.account': 'Account: {username}',
  'mail.reset.action': 'Set a new password',
  'mail.reset.expires_one': 'A link works once, for {minutes} minute.',
  'mail.reset.expires_other': 'A link works once, for {minutes} minutes.',
  'mail.reset.ignore':
    'If you did not ask for this, ignore this e-mail. Your password stays as it is.',
  'mail.changed.subject': 'Your password was changed',
  'mail.changed.text': 'The password of your account {username} on {brand} was changed on {date}.',
  'mail.changed.warning': 'If you did not do this, contact your administrator at once.',
  'mail.test.subject': 'Test e-mail from {brand}',
  'mail.test.text': 'This is a test. {brand} can send e-mail as {sender}.',
} as const satisfies Record<string, string>;

export type PageMessageKey = keyof typeof PAGE_MESSAGES_EN;

/** Every key, in the catalogue's order. */
export const PAGE_MESSAGE_KEYS = Object.freeze(Object.keys(PAGE_MESSAGES_EN) as PageMessageKey[]);

/**
 * Turkish (reviewed, §8 of the design): formal (siz), sentence case for
 * headings and buttons, Authelia's own terms where its screens use them
 * (_giriş yap_, _oturumu kapat_, _şifre_). A missing key is a compile error.
 */
export const PAGE_MESSAGES_TR: Readonly<Record<PageMessageKey, string>> = Object.freeze({
  'invite.title': 'Daveti kabul edin',
  'invite.loading': 'Davet yükleniyor…',
  'invite.invalidLink': 'Bu davet bağlantısı geçerli değil.',
  'invite.unavailableTitle': 'Davet kullanılamıyor',
  'invite.invitedTitle': 'Davet edildiniz',
  'invite.adminSubtitle': 'Hesabınızı oluşturmak için şifrenizi belirleyin.',
  'invite.delegatedBy': '{inviter} sizi {plugin} uygulamasına {role} olarak davet etti.',
  'invite.delegated': '{plugin} uygulamasına {role} olarak davet edildiniz.',
  'invite.username': 'Kullanıcı adı',
  'invite.usernameHint':
    'Giriş yaparken bu adı kullanacaksınız. Küçük harf, rakam, kısa çizgi (-) ve alt çizgi (_) içerebilir; ç, ğ, ı, ö, ş, ü kullanılamaz. Daha sonra değiştirilemez.',
  'invite.email': 'E-posta',
  'invite.expires': 'Son geçerlilik tarihi',
  'invite.yourName': 'Adınız soyadınız',
  'invite.password': 'Şifre',
  'invite.passwordHint': 'En az 8 karakter',
  'invite.confirmPassword': 'Şifre (tekrar)',
  'invite.create': 'Hesap oluştur',
  'invite.creating': 'Hesap oluşturuluyor…',
  'invite.usernameRule':
    'Kullanıcı adı {min}–{max} karakter uzunluğunda olmalıdır; yalnızca küçük harf, rakam, kısa çizgi (-) ve alt çizgi (_) içerebilir (ç, ğ, ı, ö, ş, ü kullanılamaz) ve bir harf ya da rakamla başlamalıdır.',
  'invite.nameRequired': 'Adınızı ve soyadınızı girin.',
  'invite.passwordShort': 'Şifre en az 8 karakter olmalıdır.',
  'invite.passwordLong': 'Şifre en fazla 128 karakter olabilir.',
  'invite.passwordMismatch': 'Şifreler eşleşmiyor.',
  'invite.createdTitle': 'Hesabınız oluşturuldu',
  'invite.created': 'Kullanıcı adınız: {username}',
  'invite.scanQr':
    'İki faktörlü kimlik doğrulamayı kurmak için bu QR kodunu kimlik doğrulama uygulamanızla tarayın.',
  'invite.qrAlt': 'İki faktörlü kimlik doğrulama QR kodu',
  'invite.manualEntry': 'Elle girilecek kod:',
  'invite.saveNow':
    'Sayfadan ayrılmadan önce kodu kimlik doğrulama uygulamanıza ekleyin; bir daha gösterilmeyecek.',
  'invite.askAdminTotp': 'İki faktörlü kimlik doğrulamanın kurulması için yöneticinize başvurun.',
  'invite.accessPending':
    'Erişiminiz hâlâ hazırlanıyor. Giriş yaptığınızda henüz bir şey görmüyorsanız bir dakika sonra yeniden deneyin.',
  'invite.goToSignIn': 'Giriş sayfasına git',

  'invitations.title': 'Kişi davet edin',
  'invitations.loading': 'Yükleniyor…',
  'invitations.notFoundTitle': 'Sayfa bulunamadı',
  'invitations.notFound': 'Burada bir davet sayfası yok.',
  'invitations.signInTitle': 'Hesabınızla devam edin',
  'invitations.signInText': 'Kişi davet etmek için giriş yapın.',
  'invitations.signIn': 'Giriş yap',
  'invitations.signInLoop':
    'Giriş yaptıktan sonra sürekli bu sayfaya geri dönüyorsanız tarayıcınızda bu sitenin çerezlerini temizleyip yeniden giriş yapın.',
  'invitations.unavailableTitle': 'Davetler kullanılamıyor',
  'invitations.unavailable':
    'Bu uygulamaya kişi davet etme yetkiniz yok ya da uygulamada davetler kapalı.',
  'invitations.errorTitle': 'Bir sorun oluştu',
  'invitations.loadFailed': 'Sayfa yüklenemedi. Lütfen daha sonra yeniden deneyin.',
  'invitations.unreachable': 'Sunucuya ulaşılamadı.',
  'invitations.to': 'Uygulama: {plugin}',
  'invitations.noRole': 'Rolünüz kimseyi davet etmenize izin vermiyor.',
  'invitations.email': 'E-posta adresi',
  'invitations.emailDomains': 'İzin verilen alan adları: {domains}',
  'invitations.theirName': 'Kişinin adı soyadı (isteğe bağlı)',
  'invitations.role': 'Rol',
  'invitations.bounds_one':
    'Her bağlantı yalnızca bir kez kullanılabilir; süresi {days} gün sonra dolar. Açık davetleriniz: {open}/{max}.',
  'invitations.bounds_other':
    'Her bağlantı yalnızca bir kez kullanılabilir; süresi {days} gün sonra dolar. Açık davetleriniz: {open}/{max}.',
  'invitations.create': 'Davet oluştur',
  'invitations.ready':
    'Davet hazır. Bu bağlantıyı kişiye kendiniz gönderin. Bağlantı yalnızca şimdi gösteriliyor ve onu ilk açan kişi daveti kabul edebilir.',
  'invitations.copy': 'Kopyala',
  'invitations.copied': 'Kopyalandı',
  'invitations.selected': 'Seçildi',
  'invitations.yours': 'Davetleriniz',
  'invitations.none': 'Henüz davet yok.',
  'invitations.back': '← {plugin} uygulamasına dön',
  'invitations.revoke': 'İptal et',
  'invitations.reallyRevoke': 'İptal edilsin mi?',
  'invitations.emailRequired': 'Bir e-posta adresi girin.',
  'invitations.emailInvalid': 'Geçerli bir e-posta adresi girin.',
  'status.pending': 'Bekliyor',
  'status.expired': 'Süresi doldu',
  'status.accepting': 'Kabul işlemi sürüyor',
  'status.accepted': 'Kabul edildi',
  'status.revoked': 'İptal edildi',

  'error.invitation_not_found': 'Bu davet bağlantısı geçerli değil.',
  'error.invitation_used': 'Bu davet daha önce kullanılmış.',
  'error.invitation_expired': 'Bu davetin süresi dolmuş.',
  'error.invitation_closed': 'Bu davet artık geçerli değil.',
  'error.invitation_revoked': 'Bu davet, kabul edilirken iptal edildi.',
  'error.invitation_accepting':
    'Bu davet şu anda başka bir yerde kabul ediliyor. Birkaç dakika sonra sayfayı yenileyin.',
  'error.invitation_unavailable':
    'Bu davet şu anda kabul edilemiyor. Lütfen daha sonra yeniden deneyin.',
  'error.username_unavailable': 'Bu kullanıcı adı kullanılamıyor. Başka bir kullanıcı adı deneyin.',
  'error.username_unavailable.admin': 'Bu kullanıcı adı zaten kullanılıyor.',
  'error.invalid_request.username': 'Kullanıcı adı geçersiz.',
  'error.invalid_request.password': 'Şifre geçersiz.',
  'error.invalid_request.displayName': 'Ad soyad geçersiz.',
  'error.invalid_request.email': 'E-posta adresi geçersiz.',
  'error.invalid_request.role': 'Rol geçersiz.',
  'error.invalid_request': 'Girdiğiniz bilgilerden biri geçersiz.',
  'error.invitations_unavailable': 'Bu uygulamada davetler kullanılamıyor.',
  'error.email_domain_not_allowed': 'Bu alan adındaki e-posta adresleri için davet oluşturulamaz.',
  'error.role_not_grantable': 'Bu rolle kişi davet edemezsiniz.',
  'error.invitation_rate':
    'Son bir saatte çok fazla davet oluşturdunuz. Lütfen daha sonra yeniden deneyin.',
  'error.invitation_cap.inviter':
    'Açık davet sınırınıza ulaştınız. Bir daveti iptal edin ya da davetlerden birinin kabul edilmesini bekleyin.',
  'error.invitation_cap.plugin': 'Bu uygulamaya davetle daha fazla kişi eklenemiyor.',
  'error.grant_reserve':
    'Şu anda davetle yeni kişi eklenemiyor. Lütfen daha sonra yeniden deneyin.',
  'error.gatekeeper_unavailable':
    'Hizmet şu anda yanıt vermiyor. Lütfen biraz sonra yeniden deneyin.',
  'error.authelia_storage_unavailable':
    'Hizmet şu anda yanıt vermiyor. Lütfen biraz sonra yeniden deneyin.',
  'error.not_found': 'Davet bulunamadı.',
  'error.not_found.create': 'Uygulama bulunamadı.',
  'error.tooManyRequests': 'Çok fazla istek gönderildi. Lütfen biraz bekleyip yeniden deneyin.',
  'error.generic': 'Bir sorun oluştu. Lütfen daha sonra yeniden deneyin.',

  'unavailable.title': 'Uygulama şu anda kullanılamıyor',
  'unavailable.text': 'Lütfen birkaç dakika sonra yeniden deneyin.',
  'forbidden.title': 'İzin verilmiyor',
  'forbidden.text': 'Bu sayfayı açma izniniz yok.',

  'access.title': 'Erişim izni gerekiyor',
  'access.heading': 'Erişim izni gerekiyor',
  'access.noAccess': '{host} adresine erişiminiz yok',
  'access.signedInAs': 'Giriş yapılan hesap: {username}',
  'access.contact':
    'Erişim istemek için {admin} ile iletişime geçin. Aşağıdaki mesaj şablonlarından birini kopyalayabilirsiniz:',
  'access.contactDefault':
    'Erişim istemek için yöneticinizle iletişime geçin. Aşağıdaki mesaj şablonlarından birini kopyalayabilirsiniz:',
  // Unused in Turkish: the e-mail body has no name (below).
  'access.defaultAdminSalutation': 'Yönetici',
  'access.subjectLabel': 'Konu:',
  'access.labelEmail': 'E-posta',
  'access.copy': 'Kopyala',
  'access.copied': 'Kopyalandı',
  'contact.admin': 'Yönetici:',
  'contact.help': 'Yardım:',
  'template.subject': '{resource} için erişim talebi',
  // No `{admin}`: a default administrator name reads oddly after "Merhaba",
  // and an operator-set name is not always a person's.
  'template.body':
    'Merhaba,\n\n{resource} adresine erişim talep ediyorum.\nKullanıcı adım: {username}\n\nTeşekkürler.',
  'template.chat':
    'Merhaba, {resource} adresine erişim izni verebilir misiniz? Kullanıcı adım: {username}.',
  'template.whatsapp':
    'Merhaba, {resource} adresine erişmem gerekiyor (kullanıcı adım: {username}). Teşekkürler!',
  'template.generic':
    '{resource} için erişim talebi\nKullanıcı adı: {username}\nYönetici iletişim bilgisi: {contact}',

  'refusal.title': 'İzin verilmiyor — {domain}',
  'refusal.notAllowedOn': '{host} adresine erişim izniniz yok',
  'refusal.noDomainTitle': '{host} adresi kullanılamıyor',
  'refusal.notMember': '{domain} üyesi değilsiniz',
  'refusal.noDomain':
    'Giriş yaptınız, ancak bu adres sunucunun hiçbir alan adına bağlı olmadığından kimse tarafından açılamaz.',
  'refusal.site':
    'Giriş yaptınız, ancak bu siteyi açma izniniz yok: {domain} üyesi değilsiniz ya da bu sitenin kullanıcıları arasında yer almıyorsunuz.',
  'refusal.domain':
    'Giriş yaptınız, ancak bu alan adının üyesi olmadığınız için buradaki uygulamaların hiçbirine erişemezsiniz.',
  'refusal.ask':
    'Erişiminiz olması gerekiyorsa {admin} ile iletişime geçip sizi eklemesini isteyin.',
  'refusal.askDefault':
    'Erişiminiz olması gerekiyorsa yöneticinizle iletişime geçip sizi eklemesini isteyin.',
  'refusal.noDomainAsk': 'Bu adresin çalışması gerekiyorsa {admin} ile iletişime geçin.',
  'refusal.noDomainAskDefault': 'Bu adresin çalışması gerekiyorsa yöneticinize bildirin.',
  'refusal.signOut': 'Başka bir hesapla giriş yapmak için [oturumu kapatın].',

  'account.password': 'Yeni şifre',
  'account.passwordHint': 'En az 8 karakter',
  'account.confirmPassword': 'Yeni şifre (tekrar)',
  'account.passwordShort': 'Şifre en az 8 karakter olmalıdır.',
  'account.passwordLong': 'Şifre en fazla 128 karakter olabilir.',
  'account.passwordMismatch': 'Şifreler eşleşmiyor.',
  'account.goToSignIn': 'Giriş sayfasına git',
  'account.changePasswordLink': 'Şifre değiştir',

  'reset.title': 'Şifre sıfırlama',
  'reset.loading': 'Yükleniyor…',
  'reset.requestTitle': 'Şifrenizi mi unuttunuz?',
  'reset.requestText':
    'Kullanıcı adınızı veya e-posta adresinizi girin. Burada bir hesaba aitse, hesabın e-posta adresine yeni şifre belirleme bağlantısı gönderilir.',
  'reset.identifier': 'Kullanıcı adı veya e-posta adresi',
  'reset.identifierRequired': 'Kullanıcı adınızı veya e-posta adresinizi girin.',
  'reset.send': 'Bağlantı gönder',
  'reset.sending': 'Gönderiliyor…',
  'reset.sentTitle': 'E-postanızı kontrol edin',
  'reset.sent_one':
    'Eşleşen bir hesap varsa bağlantı yola çıktı. Bağlantı bir kez ve {minutes} dakika boyunca geçerlidir.',
  'reset.sent_other':
    'Eşleşen bir hesap varsa bağlantı yola çıktı. Bağlantı bir kez ve {minutes} dakika boyunca geçerlidir.',
  'reset.setTitle': 'Yeni şifre belirleyin',
  'reset.setFor': 'Hesap: {username}',
  'reset.totp': 'Doğrulama kodu',
  'reset.totpHint': 'Doğrulama uygulamanızın bu hesap için şu anda gösterdiği altı haneli kod.',
  'reset.totpRule': 'Doğrulama uygulamanızın gösterdiği altı haneli kodu girin.',
  'reset.save': 'Şifreyi belirle',
  'reset.saving': 'Kaydediliyor…',
  'reset.doneTitle': 'Şifre değiştirildi',
  'reset.done': 'Artık yeni şifrenizle giriş yapabilirsiniz.',
  'reset.requestAgain': 'Yeni bağlantı isteyin',
  'reset.unavailableTitle': 'Kullanılamıyor',

  'password.title': 'Şifre değiştir',
  'password.loading': 'Yükleniyor…',
  'password.text': 'Önce mevcut şifrenizi, ardından yeni şifrenizi girin.',
  'password.current': 'Mevcut şifre',
  'password.currentRequired': 'Mevcut şifrenizi girin.',
  'password.save': 'Şifreyi değiştir',
  'password.saving': 'Kaydediliyor…',
  'password.doneTitle': 'Şifre değiştirildi',
  'password.done': 'Yeni şifreniz bir sonraki girişinizden itibaren geçerlidir.',

  'error.reset_invalid': 'Bu bağlantı geçerli değil veya süresi doldu. Yeni bir bağlantı isteyin.',
  'error.reset_unavailable':
    'Şifre sıfırlama burada kullanılamıyor. Yöneticinizden yeni şifre belirlemesini isteyin.',
  'error.totp_invalid': 'Kod doğru değil. Doğrulama uygulamanızı kontrol edip tekrar deneyin.',
  'error.no_totp':
    'Bu hesapta doğrulama uygulaması kurulu olmadığından şifresi e-postayla sıfırlanamaz. Yöneticinize başvurun.',
  'error.current_password_invalid': 'Mevcut şifre doğru değil.',
  'error.password_unchanged': 'Yeni şifre mevcut şifreyle aynı.',

  'mailConsent.title': 'E-posta kurulumu',
  'mailConsent.okTitle': 'E-posta kuruldu',
  'mailConsent.ok':
    'Sunucu artık e-postalarını şu adresten gönderiyor: {sender}. Bu sekmeyi kapatabilirsiniz.',
  'mailConsent.failedTitle': 'E-posta kurulamadı',
  'mailConsent.again': 'Panelin E-posta ayarlarından yeniden başlayın.',
  'mailConsent.reason.expired': 'Kurulum çok uzun sürdü veya bağlantısı zaten kullanıldı.',
  'mailConsent.reason.denied': 'Google sayfasında erişim izni verilmedi.',
  'mailConsent.reason.sender':
    'Bu Google hesabı gönderen adresiyle e-posta gönderemiyor. Adresi hesabın Gmail ayarlarında “Farklı adresten posta gönder” altına ekleyin.',
  'mailConsent.reason.token': 'Google bu hesap için bir anahtar vermedi.',
  'mailConsent.reason.generic': 'Bir sorun oluştu.',

  'mail.footer': 'Gönderen: {brand}',
  'mail.ignore': 'Bu e-postayı beklemiyorsanız dikkate almayabilirsiniz.',
  'mail.invite.subject': 'Davetiniz: {brand}',
  'mail.invite.subjectDelegated': 'Davetiniz: {plugin}',
  'mail.invite.intro': 'Şurada hesap oluşturmaya davet edildiniz: {brand}',
  'mail.invite.introDelegated': '{inviter} sizi {plugin} uygulamasına {role} olarak davet etti.',
  'mail.invite.introDelegatedAnonymous': '{plugin} uygulamasına {role} olarak davet edildiniz.',
  'mail.invite.action': 'Daveti kabul edin',
  'mail.invite.expires': 'Bağlantı bir kez kullanılabilir. Son geçerlilik tarihi: {date}',
  'mail.reset.subject': 'Şifrenizi sıfırlayın',
  'mail.reset.intro': 'Şuradaki hesabınızın şifresinin sıfırlanması istendi: {brand}',
  'mail.reset.introMany':
    'Şuradaki hesaplarınızın şifrelerinin sıfırlanması istendi: {brand}. Her hesabın kendi bağlantısı var.',
  'mail.reset.account': 'Hesap: {username}',
  'mail.reset.action': 'Yeni şifre belirleyin',
  'mail.reset.expires_one': 'Bir bağlantı bir kez ve {minutes} dakika boyunca geçerlidir.',
  'mail.reset.expires_other': 'Bir bağlantı bir kez ve {minutes} dakika boyunca geçerlidir.',
  'mail.reset.ignore': 'Bunu siz istemediyseniz bu e-postayı dikkate almayın. Şifreniz değişmez.',
  'mail.changed.subject': 'Şifreniz değiştirildi',
  'mail.changed.text':
    'Hesabınızın şifresi değiştirildi. Hesap: {username} ({brand}), tarih: {date}',
  'mail.changed.warning': 'Bunu siz yapmadıysanız hemen yöneticinize başvurun.',
  'mail.test.subject': 'Deneme e-postası: {brand}',
  'mail.test.text': 'Bu bir denemedir. {brand} şu adresten e-posta gönderebiliyor: {sender}',
});

/** Every language's catalogue. */
export const PAGE_MESSAGES: Readonly<
  Record<PageLanguage, Readonly<Record<PageMessageKey, string>>>
> = Object.freeze({ en: PAGE_MESSAGES_EN, tr: PAGE_MESSAGES_TR });

/**
 * Placeholders a translation may leave out — the text names each such
 * key and the placeholder, and why: everything else must carry exactly
 * the English placeholders.
 */
export const PAGE_MESSAGE_DROPPED_PLACEHOLDERS: Readonly<
  Partial<Record<PageLanguage, Partial<Record<PageMessageKey, readonly string[]>>>>
> = Object.freeze({ tr: { 'template.body': ['admin'] } });

// ---------------------------------------------------------------------------
// Each page's keys
// ---------------------------------------------------------------------------

/** The refusals the invitation page maps by code (§6). */
const INVITE_REFUSAL_KEYS = [
  'error.invitation_not_found',
  'error.invitation_used',
  'error.invitation_expired',
  'error.invitation_closed',
  'error.invitation_revoked',
  'error.invitation_accepting',
  'error.invitation_unavailable',
  'error.username_unavailable',
  'error.username_unavailable.admin',
  'error.invalid_request.username',
  'error.invalid_request.password',
  'error.invalid_request.displayName',
  'error.invalid_request',
  'error.gatekeeper_unavailable',
  'error.authelia_storage_unavailable',
  'error.tooManyRequests',
  'error.generic',
] as const satisfies readonly PageMessageKey[];

/** The invitation page's keys (P2): what its data block carries. */
export const INVITE_PAGE_KEYS: readonly PageMessageKey[] = Object.freeze([
  ...PAGE_MESSAGE_KEYS.filter((key) => key.startsWith('invite.')),
  ...INVITE_REFUSAL_KEYS,
]);

/** The inviter's page's keys (P1). */
export const INVITATIONS_PAGE_KEYS: readonly PageMessageKey[] = Object.freeze([
  ...PAGE_MESSAGE_KEYS.filter((key) => key.startsWith('invitations.') || key.startsWith('status.')),
  'error.invalid_request.email',
  'error.invalid_request.displayName',
  'error.invalid_request.role',
  'error.invalid_request',
  'error.invitations_unavailable',
  'error.email_domain_not_allowed',
  'error.role_not_grantable',
  'error.invitation_rate',
  'error.invitation_cap.inviter',
  'error.invitation_cap.plugin',
  'error.grant_reserve',
  'error.gatekeeper_unavailable',
  'error.not_found',
  'error.not_found.create',
  'error.tooManyRequests',
  'error.generic',
]);

/** The "not available" page of a plugin's site (P8). */
export const UNAVAILABLE_PAGE_KEYS: readonly PageMessageKey[] = Object.freeze([
  'unavailable.title',
  'unavailable.text',
]);

/** Gatekeeper's "not allowed" page (P9). */
export const FORBIDDEN_PAGE_KEYS: readonly PageMessageKey[] = Object.freeze([
  'forbidden.title',
  'forbidden.text',
]);

/** Gatekeeper's access-request page (P6). */
export const ACCESS_REQUEST_PAGE_KEYS: readonly PageMessageKey[] = Object.freeze(
  PAGE_MESSAGE_KEYS.filter(
    (key) => key.startsWith('access.') || key.startsWith('contact.') || key.startsWith('template.'),
  ),
);

/** Gatekeeper's domain refusal page (P7). */
export const DOMAIN_REFUSAL_PAGE_KEYS: readonly PageMessageKey[] = Object.freeze([
  ...PAGE_MESSAGE_KEYS.filter((key) => key.startsWith('refusal.') || key.startsWith('contact.')),
]);

/** The password words both account pages share. */
const ACCOUNT_PASSWORD_KEYS = [
  'account.password',
  'account.passwordHint',
  'account.confirmPassword',
  'account.passwordShort',
  'account.passwordLong',
  'account.passwordMismatch',
  'account.goToSignIn',
] as const satisfies readonly PageMessageKey[];

/** The forgot-password page's keys (`/reset`). */
export const RESET_PAGE_KEYS: readonly PageMessageKey[] = Object.freeze([
  ...PAGE_MESSAGE_KEYS.filter((key) => key.startsWith('reset.')),
  ...ACCOUNT_PASSWORD_KEYS,
  'error.reset_invalid',
  'error.reset_unavailable',
  'error.totp_invalid',
  'error.no_totp',
  'error.invalid_request.password',
  'error.invalid_request',
  'error.tooManyRequests',
  'error.generic',
]);

/** The change-password page's keys (`/account/password`). */
export const ACCOUNT_PASSWORD_PAGE_KEYS: readonly PageMessageKey[] = Object.freeze([
  ...PAGE_MESSAGE_KEYS.filter((key) => key.startsWith('password.')),
  ...ACCOUNT_PASSWORD_KEYS,
  'error.current_password_invalid',
  'error.password_unchanged',
  'error.invalid_request.password',
  'error.invalid_request',
  'error.tooManyRequests',
  'error.generic',
]);

/** One text of a language's catalogue. */
export function pageMessage(language: PageLanguage, key: PageMessageKey): string {
  return PAGE_MESSAGES[language][key];
}

/** The texts of `keys` in `language`, as a page's data block carries them. */
export function pageMessagesFor(
  language: PageLanguage,
  keys: readonly PageMessageKey[],
): Record<string, string> {
  const catalogue = PAGE_MESSAGES[language];
  const out: Record<string, string> = {};
  for (const key of keys) out[key] = catalogue[key];
  return out;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** A placeholder: `{name}`. */
const PLACEHOLDER_RE = /\{([A-Za-z]+)\}/g;

/** The placeholder names of a text, sorted, each once. */
export function messagePlaceholders(text: string): string[] {
  return [...new Set([...text.matchAll(PLACEHOLDER_RE)].map((m) => m[1] ?? ''))].sort();
}

/**
 * `template` with every `{name}` replaced by its value, **in one pass**: a
 * value is never scanned again, so a display name or role label holding
 * `{plugin}` stays text. A placeholder without a value is left as it is.
 */
export function formatMessage(
  template: string,
  values: Readonly<Record<string, string | number>>,
): string {
  return template.replace(PLACEHOLDER_RE, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : whole,
  );
}

/** A value for {@link formatMessageHtml}: plain text, or text wrapped in one element. */
export type HtmlMessageValue =
  | string
  | number
  | {
      readonly text: string | number;
      readonly tag: 'strong' | 'span';
      readonly className?: string;
    };

/** `value` as HTML text or attribute value: `&`, `<`, `>`, `"` and `'` escaped. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const CLASS_NAME_RE = /^[a-z][a-z0-9-]*$/;

/**
 * {@link formatMessage} as markup: the template's own text escaped, each
 * value escaped and — when given as `{ text, tag, className }` — wrapped
 * in that element. With `link`, the one `[…]` span of the template becomes
 * a link to `link.href` (escaped as an attribute). One pass, as
 * {@link formatMessage}: nothing a value holds is read as a template.
 */
export function formatMessageHtml(
  template: string,
  values: Readonly<Record<string, HtmlMessageValue>>,
  link?: { readonly href: string },
): string {
  const fill = (part: string): string =>
    part
      .split(/(\{[A-Za-z]+\})/)
      .map((piece) => {
        const match = /^\{([A-Za-z]+)\}$/.exec(piece);
        const name = match?.[1];
        if (name === undefined || !Object.prototype.hasOwnProperty.call(values, name)) {
          return escapeHtml(piece);
        }
        const value = values[name] as HtmlMessageValue;
        if (typeof value === 'string' || typeof value === 'number') {
          return escapeHtml(String(value));
        }
        if (value.className !== undefined && !CLASS_NAME_RE.test(value.className)) {
          throw new Error('A class name is lower-case letters, digits and hyphens');
        }
        const attrs = value.className === undefined ? '' : ` class="${value.className}"`;
        return `<${value.tag}${attrs}>${escapeHtml(String(value.text))}</${value.tag}>`;
      })
      .join('');
  if (link === undefined) return fill(template);
  const match = /^([^[\]]*)\[([^[\]]+)\]([^[\]]*)$/.exec(template);
  if (!match) throw new Error('A link template holds exactly one [ … ] span');
  return `${fill(match[1] ?? '')}<a href="${escapeHtml(link.href)}">${fill(match[2] ?? '')}</a>${fill(match[3] ?? '')}`;
}

/**
 * The key of the plural form of `base` for `count` in `language` —
 * `<base>_one` or `<base>_other` — by `Intl.PluralRules`. Every plural in
 * the catalogue has both forms; a category the catalogue lacks falls back
 * to `_other`.
 */
export function pluralKey(language: PageLanguage, base: string, count: number): string {
  const category = new Intl.PluralRules(language).select(count);
  return category === 'one' ? `${base}_one` : `${base}_other`;
}

/**
 * `text` with every character outside printable ASCII written as an HTML
 * numeric character reference (`ç` → `&#231;`): what a text must become
 * before it goes into an nginx vhost, whose validator refuses any byte
 * outside 0x20–0x7e (`lamaste-priv`). A control character is refused, not
 * encoded.
 */
export function htmlAsciiReferences(text: string): string {
  let out = '';
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) throw new Error('A control character is never encoded');
    out += code > 0x7e ? `&#${code};` : char;
  }
  return out;
}

/**
 * A page's data block: `{ lang, messages }` as JSON with `<`, `>`, `&`,
 * U+2028 and U+2029 escaped as `\u…`, so nothing in it can end the
 * `<script type="application/json">` element it sits in or be read as
 * markup.
 */
export function pageMessagesJson(
  language: PageLanguage,
  messages: Readonly<Record<string, string>>,
): string {
  return JSON.stringify({ lang: language, messages }).replace(
    /[<>&\u2028\u2029]/g,
    (char) => `\\u${(char.codePointAt(0) ?? 0).toString(16).padStart(4, '0')}`,
  );
}
