/**
 * Fixed bot messages in every supported language.
 *
 * These used to be written in English and machine-translated on every send.
 * That was slow, could fail, and - because the translator was told to keep
 * menu item names - left English product names inside Russian/Kazakh replies.
 * Static strings are instant, deterministic and let us insert the item names
 * in the customer's own language ourselves.
 *
 * Admin-editable text (welcome message, keyword replies, follow-up nudge,
 * button labels) is still translated with localizeMessage(), because the
 * admin can write anything there.
 *
 * NOTE: the Kazakh and Turkish wording deserves a read-through by a native
 * speaker before launch.
 */

export const SUPPORTED_LANGUAGES = ["en", "tr", "kk", "ru"];

const STRINGS = {
  en: {
    welcomePrompt: "What would you like to do?",
    orderStart: "Great, let's get your order started! What name should I put on it?",
    askName: "What name should I put on the order?",
    askNameRetry: "Sorry, what name should I put on the order?",
    nameTooLong: "That's a bit long — please send just a name (up to 40 characters).",
    askTable: "Thanks, {name}! What table number are you at?",
    askTableRetry: "What table number are you at?",
    tableTooLong: "Please send just your table number, for example 12 or A3.",
    askItems:
      'What would you like to order? Type it naturally, e.g. "2 classic simit and 1 baklava".\n\nSend "menu" to see the menu, "cart" to review your order, or "cancel" to start over.',
    itemsMatchFail:
      'I couldn\'t match that to anything on the menu — try naming the items again, or send "menu" to see what\'s available.',
    aiTrouble: "Sorry, I had trouble reading that — could you list the items again?",
    summaryHeader: "Here's your order so far:",
    total: "Total: {total} {currency}",
    unmatchedNote: '(I couldn\'t match "{text}" to anything on the menu, so I left it out.)',
    readyToSend: "Ready to send this to the kitchen?",
    btnConfirm: "✅ Confirm",
    btnModify: "✏️ Add / change",
    btnCancel: "❌ Cancel",
    modifyPrompt:
      'Sure — what would you like to add, remove or change? For example: "add 2 baklava", "remove the simit" or "make it 3".',
    cartEmptyAsk: "Looks like the cart's empty — what would you like to order?",
    placeError: "Sorry, something went wrong placing that order — please try confirming again.",
    orderPlaced:
      '🎉 Order placed! Your order code is {code}. We\'ll bring it to your table shortly.\n\nSend "status" any time to check on it.',
    placingWait: "One moment — I'm still sending your order to the kitchen.",
    cleared: 'No problem, I\'ve cleared that. Say "order" any time you\'re ready to start again 🙂',
    nothingToCancel:
      "There's nothing to cancel right now. If you've already sent an order and need to change it, please tell our staff.",
    draftExpired: 'Your earlier unfinished order timed out, so I cleared it. Send "order" to start a new one.',
    cartEmpty: "Your cart is empty.",
    cartHeader: "🛒 Your cart:",
    cartCleared: "Cart cleared. What would you like to order?",
    backNothing: 'Nothing to go back to — send "order" to start an order.',
    menuTitle: "🍽 Our menu",
    menuFooterIdle: 'To order, send "order".',
    menuFooterOrdering: "Just tell me what you'd like.",
    menuEmpty: "The menu isn't available right now — please try again in a moment.",
    statusHeader: "📦 Order {code}",
    statusLine: "Status: {status}",
    statusOnQueue: "⏳ In the queue",
    statusPreparing: "👨‍🍳 Being prepared",
    statusDelivered: "✅ Delivered to your table",
    statusCancelled: "❌ Cancelled",
    cancelReason: "Reason: {reason}",
    noRecentOrder:
      "I couldn't find a recent order. If you have an order code (like SIM-AB12CD), send it to me.",
    statusNotFound: "I couldn't find an order with code {code}. Please check it and try again.",
    notifPreparing: "👨‍🍳 Good news! Your order {code} is being prepared now.",
    notifDelivered: "✅ Your order {code} has been brought to your table. Enjoy your meal! 🥯",
    notifCancelled: "😔 Sorry, your order {code} was cancelled.\nReason: {reason}",
    help:
      'Here\'s what I can do:\n• "order" — start a new order\n• "menu" — see the menu and prices\n• "cart" — review what you\'ve added\n• "status" — check your order\n• "back" — go to the previous step\n• "cancel" — clear everything and start over\n\nWhile ordering you can type things like "add 2 baklava" or "remove the simit".',
    fallbackSorry:
      'Sorry, I didn\'t quite catch that. Send "order" to place an order, "menu" to see the menu, or ask me anything else!',
  },

  ru: {
    welcomePrompt: "Что бы вы хотели сделать?",
    orderStart: "Отлично, начинаем заказ! На какое имя оформить?",
    askName: "На какое имя оформить заказ?",
    askNameRetry: "Извините, на какое имя оформить заказ?",
    nameTooLong: "Слишком длинно — отправьте только имя (до 40 символов).",
    askTable: "Спасибо, {name}! За каким столом вы сидите?",
    askTableRetry: "За каким столом вы сидите?",
    tableTooLong: "Отправьте только номер стола, например 12 или A3.",
    askItems:
      "Что бы вы хотели заказать? Напишите как удобно, например: «2 классических симита и 1 баклава».\n\nОтправьте «меню», чтобы увидеть меню, «корзина» — чтобы проверить заказ, или «отмена» — чтобы начать заново.",
    itemsMatchFail:
      "Не удалось найти это в меню — назовите блюда ещё раз или отправьте «меню», чтобы увидеть, что есть.",
    aiTrouble: "Извините, я не смог это разобрать — не могли бы вы перечислить блюда ещё раз?",
    summaryHeader: "Ваш заказ на данный момент:",
    total: "Итого: {total} {currency}",
    unmatchedNote: "(Я не нашёл «{text}» в меню, поэтому пропустил.)",
    readyToSend: "Отправляем на кухню?",
    btnConfirm: "✅ Подтвердить",
    btnModify: "✏️ Изменить",
    btnCancel: "❌ Отмена",
    modifyPrompt:
      "Конечно — что добавить, убрать или изменить? Например: «добавь 2 баклавы», «убери симит» или «сделай 3».",
    cartEmptyAsk: "Похоже, корзина пуста — что вы хотите заказать?",
    placeError: "Извините, при оформлении заказа что-то пошло не так — попробуйте подтвердить ещё раз.",
    orderPlaced:
      "🎉 Заказ принят! Номер вашего заказа: {code}. Скоро принесём его к вашему столу.\n\nОтправьте «статус», чтобы проверить заказ.",
    placingWait: "Минуту — я всё ещё отправляю ваш заказ на кухню.",
    cleared: "Без проблем, я всё очистил. Напишите «заказ», когда будете готовы начать снова 🙂",
    nothingToCancel:
      "Сейчас нечего отменять. Если вы уже отправили заказ и хотите его изменить, сообщите нашим сотрудникам.",
    draftExpired:
      "Ваш предыдущий незавершённый заказ устарел, поэтому я его очистил. Напишите «заказ», чтобы начать новый.",
    cartEmpty: "Ваша корзина пуста.",
    cartHeader: "🛒 Ваша корзина:",
    cartCleared: "Корзина очищена. Что хотите заказать?",
    backNothing: "Возвращаться некуда — напишите «заказ», чтобы начать заказ.",
    menuTitle: "🍽 Наше меню",
    menuFooterIdle: "Чтобы заказать, напишите «заказ».",
    menuFooterOrdering: "Просто напишите, что вы хотите.",
    menuEmpty: "Меню сейчас недоступно — попробуйте чуть позже.",
    statusHeader: "📦 Заказ {code}",
    statusLine: "Статус: {status}",
    statusOnQueue: "⏳ В очереди",
    statusPreparing: "👨‍🍳 Готовится",
    statusDelivered: "✅ Доставлен к столу",
    statusCancelled: "❌ Отменён",
    cancelReason: "Причина: {reason}",
    noRecentOrder:
      "Недавних заказов не найдено. Если у вас есть номер заказа (например, SIM-AB12CD), отправьте его мне.",
    statusNotFound: "Заказ с номером {code} не найден. Проверьте номер и попробуйте снова.",
    notifPreparing: "👨‍🍳 Хорошие новости! Ваш заказ {code} уже готовится.",
    notifDelivered: "✅ Ваш заказ {code} доставлен к столу. Приятного аппетита! 🥯",
    notifCancelled: "😔 К сожалению, ваш заказ {code} отменён.\nПричина: {reason}",
    help:
      "Вот что я умею:\n• «заказ» — начать новый заказ\n• «меню» — посмотреть меню и цены\n• «корзина» — проверить, что вы добавили\n• «статус» — узнать статус заказа\n• «назад» — вернуться на шаг назад\n• «отмена» — всё очистить и начать заново\n\nВо время заказа можно писать: «добавь 2 баклавы» или «убери симит».",
    fallbackSorry:
      "Извините, я не совсем понял. Напишите «заказ», чтобы сделать заказ, «меню» — чтобы увидеть меню, или задайте любой другой вопрос!",
  },

  kk: {
    welcomePrompt: "Не істегіңіз келеді?",
    orderStart: "Тамаша, тапсырысты бастайық! Тапсырысқа қандай атты жазайын?",
    askName: "Тапсырысқа қандай атты жазайын?",
    askNameRetry: "Кешіріңіз, тапсырысқа қандай атты жазайын?",
    nameTooLong: "Тым ұзын — тек атыңызды жіберіңіз (40 таңбаға дейін).",
    askTable: "Рахмет, {name}! Қай үстелде отырсыз?",
    askTableRetry: "Қай үстелде отырсыз?",
    tableTooLong: "Тек үстел нөмірін жіберіңіз, мысалы 12 немесе A3.",
    askItems:
      "Не тапсырыс бергіңіз келеді? Еркін жазыңыз, мысалы: «2 қарапайым симит және 1 баклава».\n\nМәзірді көру үшін «мәзір», тапсырысты тексеру үшін «себет», қайта бастау үшін «бас тарту» деп жазыңыз.",
    itemsMatchFail:
      "Мұны мәзірден таба алмадым — тағамдарды қайта атаңыз немесе не бар екенін көру үшін «мәзір» деп жазыңыз.",
    aiTrouble: "Кешіріңіз, мұны түсіне алмадым — тағамдарды қайта тізіп жібере аласыз ба?",
    summaryHeader: "Қазіргі тапсырысыңыз:",
    total: "Барлығы: {total} {currency}",
    unmatchedNote: "(«{text}» мәзірден табылмады, сондықтан қалдырып кеттім.)",
    readyToSend: "Асханаға жібереміз бе?",
    btnConfirm: "✅ Растау",
    btnModify: "✏️ Өзгерту",
    btnCancel: "❌ Бас тарту",
    modifyPrompt:
      "Әрине — нені қосқыңыз, алып тастағыңыз немесе өзгерткіңіз келеді? Мысалы: «2 баклава қос», «симитті алып таста» немесе «3 етіп өзгерт».",
    cartEmptyAsk: "Себет бос сияқты — не тапсырыс бергіңіз келеді?",
    placeError: "Кешіріңіз, тапсырысты рәсімдеу кезінде қате болды — қайта растап көріңіз.",
    orderPlaced:
      "🎉 Тапсырыс қабылданды! Тапсырыс нөмірі: {code}. Жақын арада үстеліңізге әкелеміз.\n\nТапсырыс күйін білу үшін «күй» деп жазыңыз.",
    placingWait: "Бір сәт — тапсырысыңызды асханаға жіберіп жатырмын.",
    cleared: "Ештеңе етпейді, бәрін тазаладым. Қайта бастауға дайын болғанда «тапсырыс» деп жазыңыз 🙂",
    nothingToCancel:
      "Қазір бас тартатын ештеңе жоқ. Егер тапсырысты жіберіп қойсаңыз және өзгерткіңіз келсе, қызметкерлерге айтыңыз.",
    draftExpired:
      "Бұрынғы аяқталмаған тапсырысыңыздың уақыты өтіп кетті, сондықтан оны тазаладым. Жаңасын бастау үшін «тапсырыс» деп жазыңыз.",
    cartEmpty: "Себетіңіз бос.",
    cartHeader: "🛒 Сіздің себетіңіз:",
    cartCleared: "Себет тазаланды. Не тапсырыс бергіңіз келеді?",
    backNothing: "Қайтатын жер жоқ — тапсырыс бастау үшін «тапсырыс» деп жазыңыз.",
    menuTitle: "🍽 Біздің мәзір",
    menuFooterIdle: "Тапсырыс беру үшін «тапсырыс» деп жазыңыз.",
    menuFooterOrdering: "Не қалайтыныңызды жазыңыз.",
    menuEmpty: "Мәзір қазір қолжетімсіз — сәлден кейін қайталап көріңіз.",
    statusHeader: "📦 Тапсырыс {code}",
    statusLine: "Күйі: {status}",
    statusOnQueue: "⏳ Кезекте",
    statusPreparing: "👨‍🍳 Дайындалуда",
    statusDelivered: "✅ Үстелге жеткізілді",
    statusCancelled: "❌ Бас тартылды",
    cancelReason: "Себебі: {reason}",
    noRecentOrder:
      "Соңғы тапсырыс табылмады. Тапсырыс нөмірі (мысалы, SIM-AB12CD) болса, маған жіберіңіз.",
    statusNotFound: "{code} нөмірлі тапсырыс табылмады. Нөмірін тексеріп, қайталап көріңіз.",
    notifPreparing: "👨‍🍳 Жақсы жаңалық! {code} тапсырысыңыз дайындалып жатыр.",
    notifDelivered: "✅ {code} тапсырысыңыз үстеліңізге жеткізілді. Ас болсын! 🥯",
    notifCancelled: "😔 Кешіріңіз, {code} тапсырысыңыз бас тартылды.\nСебебі: {reason}",
    help:
      "Мен мыналарды істей аламын:\n• «тапсырыс» — жаңа тапсырыс бастау\n• «мәзір» — мәзір мен бағаларды көру\n• «себет» — қосқандарыңызды тексеру\n• «күй» — тапсырыс күйін білу\n• «артқа» — алдыңғы қадамға қайту\n• «бас тарту» — бәрін тазалап, қайта бастау\n\nТапсырыс беру кезінде «2 баклава қос» немесе «симитті алып таста» деп жаза аласыз.",
    fallbackSorry:
      "Кешіріңіз, толық түсінбедім. Тапсырыс беру үшін «тапсырыс», мәзірді көру үшін «мәзір» деп жазыңыз немесе басқа сұрақ қойыңыз!",
  },

  tr: {
    welcomePrompt: "Ne yapmak istersiniz?",
    orderStart: "Harika, siparişinizi başlatalım! Siparişe hangi ismi yazayım?",
    askName: "Siparişe hangi ismi yazayım?",
    askNameRetry: "Üzgünüm, siparişe hangi ismi yazayım?",
    nameTooLong: "Biraz uzun oldu — lütfen sadece adınızı yazın (en fazla 40 karakter).",
    askTable: "Teşekkürler, {name}! Hangi masadasınız?",
    askTableRetry: "Hangi masadasınız?",
    tableTooLong: "Lütfen sadece masa numaranızı yazın, örneğin 12 veya A3.",
    askItems:
      'Ne sipariş etmek istersiniz? Doğal şekilde yazabilirsiniz, örn. "2 klasik simit ve 1 baklava".\n\nMenüyü görmek için "menü", siparişinizi kontrol etmek için "sepet", baştan başlamak için "iptal" yazın.',
    itemsMatchFail:
      'Bunu menüde bulamadım — ürünleri tekrar yazın ya da neler olduğunu görmek için "menü" yazın.',
    aiTrouble: "Üzgünüm, bunu anlayamadım — ürünleri tekrar yazar mısınız?",
    summaryHeader: "Şu ana kadarki siparişiniz:",
    total: "Toplam: {total} {currency}",
    unmatchedNote: '("{text}" menüde bulunamadı, bu yüzden dışarıda bıraktım.)',
    readyToSend: "Mutfağa gönderelim mi?",
    btnConfirm: "✅ Onayla",
    btnModify: "✏️ Değiştir",
    btnCancel: "❌ İptal",
    modifyPrompt:
      'Tabii — neyi eklemek, çıkarmak veya değiştirmek istersiniz? Örneğin: "2 baklava ekle", "simiti çıkar" veya "3 yap".',
    cartEmptyAsk: "Sepet boş görünüyor — ne sipariş etmek istersiniz?",
    placeError: "Üzgünüm, siparişi verirken bir sorun oldu — lütfen tekrar onaylamayı deneyin.",
    orderPlaced:
      '🎉 Sipariş alındı! Sipariş kodunuz {code}. Kısa süre içinde masanıza getireceğiz.\n\nDurumunu kontrol etmek için "durum" yazın.',
    placingWait: "Bir saniye — siparişinizi hâlâ mutfağa gönderiyorum.",
    cleared: 'Sorun değil, hepsini temizledim. Yeniden başlamaya hazır olduğunuzda "sipariş" yazın 🙂',
    nothingToCancel:
      "Şu anda iptal edilecek bir şey yok. Siparişi zaten gönderdiyseniz ve değiştirmek istiyorsanız lütfen çalışanlarımıza söyleyin.",
    draftExpired:
      'Önceki tamamlanmamış siparişinizin süresi doldu, bu yüzden temizledim. Yeni bir sipariş için "sipariş" yazın.',
    cartEmpty: "Sepetiniz boş.",
    cartHeader: "🛒 Sepetiniz:",
    cartCleared: "Sepet temizlendi. Ne sipariş etmek istersiniz?",
    backNothing: 'Geri dönecek bir şey yok — sipariş başlatmak için "sipariş" yazın.',
    menuTitle: "🍽 Menümüz",
    menuFooterIdle: 'Sipariş vermek için "sipariş" yazın.',
    menuFooterOrdering: "Ne istediğinizi yazmanız yeterli.",
    menuEmpty: "Menü şu anda mevcut değil — lütfen biraz sonra tekrar deneyin.",
    statusHeader: "📦 Sipariş {code}",
    statusLine: "Durum: {status}",
    statusOnQueue: "⏳ Sırada",
    statusPreparing: "👨‍🍳 Hazırlanıyor",
    statusDelivered: "✅ Masanıza teslim edildi",
    statusCancelled: "❌ İptal edildi",
    cancelReason: "Sebep: {reason}",
    noRecentOrder:
      "Yakın zamanda verilmiş bir sipariş bulamadım. Sipariş kodunuz varsa (örn. SIM-AB12CD) bana gönderin.",
    statusNotFound: "{code} kodlu bir sipariş bulamadım. Lütfen kodu kontrol edip tekrar deneyin.",
    notifPreparing: "👨‍🍳 Güzel haber! {code} numaralı siparişiniz hazırlanıyor.",
    notifDelivered: "✅ {code} numaralı siparişiniz masanıza getirildi. Afiyet olsun! 🥯",
    notifCancelled: "😔 Üzgünüz, {code} numaralı siparişiniz iptal edildi.\nSebep: {reason}",
    help:
      'Şunları yapabilirim:\n• "sipariş" — yeni sipariş başlat\n• "menü" — menü ve fiyatları gör\n• "sepet" — eklediklerini kontrol et\n• "durum" — siparişinin durumunu öğren\n• "geri" — önceki adıma dön\n• "iptal" — her şeyi temizle ve baştan başla\n\nSipariş verirken "2 baklava ekle" veya "simiti çıkar" gibi yazabilirsiniz.',
    fallbackSorry:
      'Üzgünüm, tam anlayamadım. Sipariş vermek için "sipariş", menüyü görmek için "menü" yazın ya da başka bir şey sorun!',
  },
};

/** Language code -> the language's name, for prompts sent to the AI. */
export const LANGUAGE_NAMES = { en: "English", tr: "Turkish", kk: "Kazakh", ru: "Russian" };

export function normalizeLanguage(language) {
  return SUPPORTED_LANGUAGES.includes(language) ? language : "en";
}

/** Look up a fixed message, filling {placeholders}. Falls back to English. */
export function t(language, key, vars = {}) {
  const lang = normalizeLanguage(language);
  const template = STRINGS[lang][key] ?? STRINGS.en[key];
  if (template === undefined) throw new Error(`Missing bot string: ${key}`);
  return template.replace(/\{(\w+)\}/g, (match, name) => (vars[name] !== undefined ? String(vars[name]) : match));
}

/**
 * Pick the text for one language out of a {en, tr, kk, ru} object.
 * Falls back to English, then to any available language, then to "".
 */
export function pickName(field, language) {
  if (!field) return "";
  if (typeof field === "string") return field;
  return field[language] || field.en || Object.values(field).find(Boolean) || "";
}

const WEIGHT_UNITS = {
  en: { kg: "kg", g: "g", portion: "portions" },
  ru: { kg: "кг", g: "г", portion: "порций" },
  kk: { kg: "кг", g: "г", portion: "порция" },
  tr: { kg: "kg", g: "g", portion: "porsiyon" },
};

/** Weight notes are stored in English ("1 kg", "12 portions") - localize the unit. */
export function localizeWeightNote(note, language) {
  if (!note) return "";
  const units = WEIGHT_UNITS[normalizeLanguage(language)];
  return String(note)
    .replace(/\bportions?\b/gi, units.portion)
    .replace(/\bkg\b/gi, units.kg)
    .replace(/(\d)\s*g\b/gi, `$1 ${units.g}`);
}

// Exposed for tests: make sure every language defines every key.
export const _STRINGS_FOR_TESTS = STRINGS;
