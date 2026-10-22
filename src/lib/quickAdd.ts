import { guideTopicsForPrompt } from "@/lib/botGuide";
import { gigaChatComplete } from "@/lib/gigachat/client";
import { cleanTitle } from "@/lib/itemTitle";
import { sharesPrefix } from "@/lib/stem";
import { WEEKDAYS, addDays, isoDate, moscowToday, normalizeDeadline } from "@/lib/whenDate";

// Shared natural-language parsing used by both the web quick-add bar
// (/api/quick-add) and the Telegram bot (/api/telegram/webhook) — one
// prompt, one behavior, regardless of where the message came from.

// Free-tier models are unreliable at weekday arithmetic in their head — even
// a full calendar table in the prompt got ignored in testing. Handing over
// each weekday's *already-resolved next date* (computed here in code, not
// left for the model to work out) is what actually produced correct results.
export function nextWeekdayMap(now: Date): string {
  const map = new Map<number, string>();
  for (let i = 0; i < 7; i++) {
    const d = addDays(now, i);
    if (!map.has(d.getDay())) map.set(d.getDay(), isoDate(d));
  }
  return WEEKDAYS.map((_, wd) => `${WEEKDAYS[wd]} → ${map.get(wd)}`).join("\n");
}

function systemPrompt(now: Date, assignees: string[]) {
  return [
    `Сегодня ${isoDate(now)} (${WEEKDAYS[now.getDay()]}). Часовой пояс пользователя — Europe/Moscow.`,
    `«завтра» = ${isoDate(addDays(now, 1))}. «послезавтра» = ${isoDate(addDays(now, 2))}. «через неделю» = ${isoDate(addDays(now, 7))}.`,
    "Если в фразе назван день недели («в пятницу», «во вторник» и т.п.) — БЕРИ ГОТОВУЮ ДАТУ ИЗ ЭТОЙ ТАБЛИЦЫ, ни в коем случае не вычисляй сам:",
    nextWeekdayMap(now),
    `Список исполнителей, которых знает система: ${assignees.length ? assignees.join(", ") : "(пусто)"}.`,
    "Ты помогаешь быстро завести записи в личном таск-трекере по одной фразе на русском языке.",
    "Ответь РОВНО ОДНИМ JSON-МАССИВОМ объектов, без markdown-разметки, без пояснений до или после — только сам JSON, начиная с символа [.",
    "В одной фразе может быть НЕСКОЛЬКО разных поручений сразу (например: задача + две мысли + встреча одним сообщением) — тогда верни несколько элементов массива, по одному на каждое отдельное поручение. Если поручение одно — в массиве всё равно один элемент.",
    "Каждый элемент массива — отдельный JSON-объект, поле type определяет его структуру — используй ровно одну из двадцати пяти:",
    "",
    '1) {"type":"task","title":string,"description":string,"assignee":string,"executors":string[],"deadline":string,"repeat":string}',
    "   repeat: если дело ПОВТОРЯЕТСЯ — слова о повторе дословно («каждый понедельник», «по будням», «каждое 5 число»); иначе пустая строка.",
    "   — что-то, что нужно сделать. assignee: СКОПИРУЙ имя буква-в-букву из списка исполнителей выше. Если точного совпадения нет — пустая строка. Категорически запрещено писать любое имя, которого нет в списке дословно.",
    // Главная ошибка бота 21.09.2026: «Позвонить Паше Котову» уехало
    // ЧУЖОМУ человеку. Модель считает исполнителем любого, кто назван в
    // фразе, — а названный чаще всего тот, КОМУ звонят, а не тот, кто
    // звонит. Пишущий по умолчанию говорит о себе.
    "   assignee заполняется, ТОЛЬКО если сказано, кому поручают: «поручи Никите…», «пусть Наталья…», «Игорю — смету», «передай Сергею…».",
    "   Человек, о котором идёт речь ВНУТРИ дела, исполнителем НЕ является: «позвонить Паше», «встретиться с Игорем», «спросить у Натальи», «съездить к Сергею», «написать Оксане» — это дело самого пишущего, assignee оставь ПУСТЫМ, и имя из фразы оттуда не убирай (оно часть названия).",
    "   Сомневаешься, поручают это кому-то или делают сами, — assignee пустой. Пустой исполнитель означает «сам пишущий», и это правильный ответ по умолчанию.",
    "   executors: ОСТАЛЬНЫЕ исполнители той же задачи, если их несколько, теми же именами из списка. Обычно пустой массив.",
    "   ОДНА задача на нескольких человек — это ОДИН объект: первый исполнитель в assignee, остальные в executors. НИКОГДА не создавай несколько одинаковых задач, по одной на каждого человека.",
    "   deadline: дата из таблицы выше, РОВНО в формате YYYY-MM-DD. Пустая строка, если дата не названа. Слова «today», «tomorrow», «сегодня», «завтра» сюда писать нельзя — только дату числом.",
    "   title: КОРОТКО, что сделать — 2–7 слов, без обращения к тебе («создай», «поставь») и без имени ТОГО, КОМУ ПОРУЧЕНО, оно уже в assignee. Имя того, о ком идёт речь в самом деле («позвонить Паше Котову»), в названии остаётся. Подробности, если они были сказаны, положи в description, а не в название.",
    "",
    '2) {"type":"meeting","title":string,"date":string,"time":string,"participants":string[],"repeat":string,"agenda":string[]}',
    // 21.10.2026: повестка задаётся при создании любой встречи — и из бота
    // тоже, той же фразой, а не вторым сообщением.
    "   agenda: ПУНКТЫ ПОВЕСТКИ, если человек назвал, что обсудить: «повестка: смета, отпуска», «обсудим смету и график отпусков», «вопросы — закупки; склад» → [\"Смета\",\"График отпусков\"]. Каждый пункт — коротко, с большой буквы, как строка списка. Тема встречи в title, а не в agenda: «встреча по смете» без перечня пунктов → agenda: []. Не придумывай пунктов, которых не было.",
    "   repeat: если встреча ПОВТОРЯЕТСЯ — слова о повторе дословно («по вторникам», «раз в две недели»); иначе пустая строка. date — ближайшая такая встреча.",
    "   — явно названы дата/время встречи. date: YYYY-MM-DD из таблицы выше. time: HH:MM (24ч) или пустая строка. participants: имена буква-в-букву из списка выше, без придуманных.",
    "   title: КОРОТКАЯ ТЕМА, 2–6 слов, как строка в календаре. Не повторяй сказанную фразу и не начинай со слов «создай», «поставь», «запиши». Дата, время и имена участников уже разобраны в отдельные поля — в названии они не нужны. «Создай встречу на среду с Черкашиным по маркировке остатков обуви» → title: «Маркировка остатков обуви».",
    "",
    '3) {"type":"idea","text":string,"important":boolean}',
    "   — просто мысль/наблюдение без срока и исполнителя. important: true только если пользователь явно подчеркнул важность.",
    "",
    '4) {"type":"clarify","question":string}',
    "   — фразу целиком нельзя уверенно разобрать (например, не хватает ключевой детали) — короткий уточняющий вопрос вместо угадывания. Используй, только если ВСЯ фраза непонятна; если непонятна лишь часть многосоставной фразы — обработай понятные поручения, а неясную часть пропусти.",
    "",
    '5) {"type":"manage_item","action":"complete"|"success"|"no_result"|"reopen"|"delete","itemType":"task"|"meeting","query":string}',
    "   — просьба изменить УЖЕ СУЩЕСТВУЮЩУЮ задачу или встречу (не создать новую): отметить выполненной, отметить итог встречи, вернуть в работу/план или удалить.",
    "   action=\"complete\" — только itemType=\"task\" (отметить задачу сделанной).",
    "   action=\"success\"/\"no_result\" — только itemType=\"meeting\" (итог встречи).",
    "   action=\"reopen\" — вернуть завершённую задачу или состоявшуюся/несостоявшуюся встречу обратно в работу/план.",
    "   action=\"delete\" — удалить безвозвратно (задачу или встречу).",
    "   query: короткий фрагмент названия дословно, как назвал пользователь — НЕ придумывай и не дополняй его.",
    "",
    '6) {"type":"question","query":string}',
    "   — ВОПРОС о том, что уже есть в трекере: «что у меня сегодня/завтра», «что горит», «сколько задач на Наталье», «что там по опту», «когда встреча с Игорем», «что я записывал про склад».",
    "   query: вопрос пользователя дословно. Отвечать на него ты здесь не должен — на него ответит отдельный шаг, который видит данные трекера.",
    // 22.10.2026: шаг ответа видит только query. «А у Игоря?» после
    // «сколько задач на Наталье» без разговора — вопрос ни о чём.
    "   Если вопрос — ПРОДОЛЖЕНИЕ разговора («а у Игоря?», «а завтра?», «а просроченные?», «а встречи?»), собери в query ПОЛНЫЙ самостоятельный вопрос из недавнего разговора: после «сколько задач на Наталье» → «а у Игоря?» даёт query «сколько задач на Игоре».",
    "   Признак вопроса — пользователь ХОЧЕТ УЗНАТЬ что-то о своих делах, а не завести или изменить запись.",
    "",
    '7) {"type":"meeting_notes","text":string}',
    "   — пользователь ПЕРЕСКАЗЫВАЕТ прошедшую встречу/совещание/созвон и по ходу называет, что кому делать: «созвонились с отделом, договорились что Наталья доделает ленту к пятнице, а Никита пришлёт остатки».",
    "   Признаки: речь о встрече в ПРОШЕДШЕМ времени + несколько поручений подряд, часто разным людям. Обычно это длинный рассказ, а не одна фраза.",
    "   text: исходный рассказ пользователя целиком, дословно. Разбирать его на задачи здесь не нужно — это сделает отдельный шаг.",
    "",
    '8) {"type":"bulk_move","scope":"tasks"|"meetings"|"both","from":string,"to":string}',
    "   — просьба перенести СРАЗУ ВСЁ с одного дня на другой: «перенеси всё, что на пятницу, на понедельник», «сдвинь завтрашние встречи на среду».",
    "   ТОЛЬКО если сказано «всё», «все встречи», «все задачи», «всё, что на …». Если речь об ОДНОЙ встрече или задаче («перенеси эту встречу», «перенеси телемост», «сдвинь смету») — это type=move_item, а не bulk_move.",
    "   scope: что переносим — только задачи, только встречи или и то и другое (both, если не уточнено).",
    "   from и to — КОГДА, одним словом из списка: \"today\", \"tomorrow\", \"day_after\", \"next_week\", \"monday\", \"tuesday\", \"wednesday\", \"thursday\", \"friday\", \"saturday\", \"sunday\".",
    "   НИКОГДА не пиши сюда дату числом — только слово из списка, дату подставит система.",
    "",
    '9) {"type":"search","query":string}',
    "   — просьба НАЙТИ всё по теме или человеку: «найди всё про Севастополь», «что у меня было по опту», «покажи всё, что связано с Игорем».",
    "   query: ключевые слова темы (без слов «найди», «покажи»). Отличается от type=question тем, что нужен не ответ-рассуждение, а подборка записей по теме.",
    "",
    // 19.10.2026 «перенеси эту встречу на следующий понедельник» ушло в
    // массовый перенос (другого переноса не было), и семь попыток подряд
    // кончились «не понял». Дату здесь модель НЕ считает: она отдаёт слова
    // человека как есть, а число из них вычитывает код (lib/botWhen).
    '11) {"type":"move_item","itemType":"meeting"|"task"|"","query":string,"when":string}',
    "   — просьба перенести ОДНУ конкретную встречу (на другой день или время) или сдвинуть срок ОДНОЙ задачи: «перенеси телемост на 26.10», «встречу с Вадимом на понедельник в то же время», «сдвинь срок сметы на пятницу».",
    "   itemType: \"meeting\" для встречи, созвона, телемоста, совещания, планёрки; \"task\" для задачи и срока; пустая строка, если непонятно.",
    "   query: КАК НАЗВАЛИ эту встречу или задачу — слова названия дословно (\"телемост с Вадимом\", \"смета\"). Если пользователь говорит «эту встречу», «её», «перенеси» без названия — возьми название из сообщения, на которое он ответил, или из недавнего разговора ниже. Не придумывай: не знаешь — пустая строка.",
    "   when: слова пользователя о НОВОМ дне и времени ДОСЛОВНО, как сказаны: \"на следующий понедельник\", \"на 26.10 в то же время\", \"26 октября в 15:00\", \"на неделю\". НЕ переводи в дату и не вычисляй — дату посчитает система. Если в новом сообщении дня нет, а в разговоре выше он назван — возьми его оттуда.",
    "   Короткое сообщение-уточнение («только телемост», «на 26.10», «26.10», «в то же время») после разговора о переносе — это тоже move_item: собери query и when из разговора и нового сообщения вместе.",
    "",
    // 20.10.2026: «сделай отмену встречи словами». Раньше «отмени встречу»
    // уходило в manage_item delete — то есть молча стирало встречу, без
    // причины и без слова участникам.
    '12) {"type":"cancel_meeting","query":string,"reason":string}',
    "   — просьба ОТМЕНИТЬ встречу (она не состоится вовсе, а не переносится): «отмени встречу с банком, клиент заболел», «встречи с Вадимом не будет», «отбой планёрке — я в командировке».",
    "   query: как назвали встречу, дословно; «эту встречу» — название из сообщения, на которое ответили, или из разговора. Не знаешь — пустая строка.",
    "   reason: причина отмены словами пользователя («клиент заболел»), если названа; иначе пустая строка. Не придумывай причину.",
    "   Отменить встречу — это cancel_meeting, а НЕ manage_item delete. Перенести на другой день — это move_item.",
    "",
    // Десять умений 20.10.2026 (lib/botSkills). Во всех — query: как
    // назвали задачу/встречу/мысль дословно, «эту» — из сообщения, на
    // которое ответили, или из разговора; имена людей — как прозвучали.
    '13) {"type":"review_task","query":string,"verdict":"accept"|"return","comment":string}',
    "   — ПРИНЯТЬ сданную работу по задаче («смету принимаю», «работу по складу принял, всё ок») или ВЕРНУТЬ на доработку («верни смету — нет подписи директора»). comment: что доделать (для return), дословно; иначе пустая строка.",
    '14) {"type":"task_people","query":string,"executors":string[],"coexecutors":string[],"watchers":string[],"remove":string[],"replace":boolean}',
    "   — поменять ЛЮДЕЙ на существующей задаче: «подключи к смете Игоря» (coexecutors, если не сказано «исполнителем»), «пусть Наталья тоже следит за сметой» (watchers), «сними Игоря со сметы» (remove), «смету теперь ведёт Наталья» / «передай смету Наталье» (executors + replace=true).",
    '15) {"type":"meeting_people","query":string,"add":string[],"remove":string[]}',
    "   — поменять состав ВСТРЕЧИ: «добавь Макарова на телемост», «позови Игоря на планёрку», «убери Наталью с планёрки».",
    '16) {"type":"find_slot","participants":string[],"when":string}',
    "   — ВОПРОС, когда люди свободны, чтобы встретиться: «когда мы с Игорем и Натальей свободны в четверг?», «найди время с Котовым завтра». participants — названные люди (без самого пишущего). when — слова о дне дословно.",
    '17) {"type":"remind_me","what":string,"when":string}',
    "   — напомнить САМОМУ пишущему в мессенджере: «напомни завтра в 9 про смету», «через 2 часа напомни позвонить в банк». what — о чём напомнить, коротко; when — слова о времени ДОСЛОВНО («завтра в 9», «через 2 часа»). Это НЕ задача.",
    '18) {"type":"idea_to_task","query":string,"assignee":string,"when":string}',
    "   — сделать из УЖЕ ЗАПИСАННОЙ мысли задачу: «мысль про склад — задачей Игорю к пятнице». query — слова мысли; assignee — кому, если назван; when — срок словами.",
    '19) {"type":"agenda_add","query":string,"items":string[]}',
    "   — добавить пункты в ПОВЕСТКУ встречи: «на планёрку добавь пункт про закупки» → items:[\"Закупки\"].",
    '20) {"type":"checklist","query":string,"add":string[],"done":string[]}',
    "   — чек-лист ВНУТРИ задачи: «к смете пункты: цены, подпись, отправить в банк» → add; «по смете отметь подпись» → done.",
    '21) {"type":"nudge","query":string,"scope":"one"|"overdue"}',
    "   — ПОТОРОПИТЬ исполнителей: «напомни Игорю про смету», «поторопи по смете» (scope one); «поторопи всех по просроченным» (scope overdue, query пустой). «Напомни МНЕ» — это remind_me, а не nudge.",
    // Аудит ботов 20.10.2026: «как…?» о самом трекере уходило в question,
    // а шаг ответа знает ДАННЫЕ, не устройство трекера. Модель выбирает
    // только тему из списка — слова ответа пишет код (lib/botGuide).
    '22) {"type":"howto","topic":string}',
    "   — вопрос КАК ПОЛЬЗОВАТЬСЯ трекером или ботом, ЧТО он умеет: «как отложить задачу?», «можно ли позвать человека на встречу?», «как принять работу?», «что ты умеешь?», «как отправить мысль коллеге?».",
    "   topic — РОВНО ОДИН ключ из списка (только ключ, латиницей): " + guideTopicsForPrompt() + ". Не подходит ни один или спрашивают «что ты умеешь» вообще — topic пустая строка.",
    "   Отличие от question: question — о ДАННЫХ («что у меня завтра», «сколько задач на Наталье»); howto — о том, КАК что-то сделать или МОЖНО ЛИ.",
    '23) {"type":"snooze_task","query":string,"until":string,"back":boolean}',
    "   — ОТЛОЖИТЬ задачу с доски до дня: «отложи смету до понедельника», «убери отчёт с доски на неделю». until — слова о дне дословно. «верни смету на доску», «не откладывай смету» → back=true, until пустая строка.",
    '24) {"type":"away","until":string,"kind":"vacation"|"sick"|"trip"|"other","back":boolean}',
    "   — пишущего НЕ БУДЕТ на месте: «меня не будет до пятницы», «я в отпуске до 30.10», «на больничном до среды». until — слова о последнем дне дословно. «я вернулся», «я снова на месте» → back=true.",
    "",
    // 22.10.2026, «максимально общительная версия»: на «привет» и
    // «спасибо» бот отвечал «Не понял, что сделать». Живая реплика — не
    // непонятая фраза; отвечает на неё отдельный шаг (lib/botTalk).
    '25) {"type":"chat"}',
    "   — ЖИВАЯ РЕПЛИКА человека боту, а не поручение и не вопрос о данных: приветствие («привет», «доброе утро»), благодарность («спасибо», «отлично, спасибо»), «как дела?», «кто ты?», эмоция или усталость («устал», «завал сегодня», «ура, закрыл квартал»), похвала или упрёк боту («молодец», «ты тупишь»), прощание («пока», «до завтра»).",
    "   Если в той же фразе есть ещё и поручение или вопрос («привет, что у меня сегодня?», «спасибо, и поставь Игорю смету») — верни ТОЛЬКО поручение/вопрос, без chat: деловая часть важнее.",
    "",
    '10) {"type":"other"}',
    "   — фраза (или её часть, если поручений несколько) не является ни поручением, ни вопросом о трекере, ни живой репликой: бессмыслица, обрывок, текст не по адресу.",
    "   Никогда не повторяй и не пересказывай его сообщение.",
    "",
    "Примеры формы ответа:",
    'Одно поручение → [{"type":"task","title":"...","description":"","assignee":"","executors":[],"deadline":""}]',
    // Имена в примерах — подстановки, а не люди, и это не стиль.
    // 21.09.2026 модель на фразе «позвонить Паше Котову», где Паши в
    // списке нет, взяла имя ПРЯМО ОТСЮДА: тут стояло настоящее «Игорь
    // Витковский», и задача уехала ему. Пример учит форме ответа и не
    // должен подсказывать содержание.
    "«сделайте вдвоём» (одна задача, двое) → [{\"type\":\"task\",\"title\":\"...\",\"description\":\"\",\"assignee\":\"<первый из списка>\",\"executors\":[\"<второй из списка>\"],\"deadline\":\"\"}]",
    "«<имя А> — смету, <имя Б> — остатки» (два разных дела) → [{\"type\":\"task\",\"title\":\"смета\",...,\"assignee\":\"<имя А>\",\"executors\":[]}, {\"type\":\"task\",\"title\":\"остатки\",...,\"assignee\":\"<имя Б>\",\"executors\":[]}]",
    // Дело для себя — самый частый случай в личном боте, и до 21.09.2026
    // примера на него не было ни одного: все показывали поручение.
    '«позвонить Паше Котову» (дело для себя, Паша — тот, КОМУ звонят) → [{"type":"task","title":"Позвонить Паше Котову","description":"","assignee":"","executors":[],"deadline":""}]',
    'Несколько поручений одной фразой → [{"type":"task",...}, {"type":"idea",...}, {"type":"idea",...}, {"type":"meeting",...}]',
    // The question type needs its own example: without one the model kept
    // trying to *answer* counting questions ("сколько задач на Наталье?") in
    // prose instead of returning JSON, which failed the parse outright.
    'Вопрос о делах → [{"type":"question","query":"сколько задач на Наталье"}]',
    'Ещё вопрос → [{"type":"question","query":"что у меня завтра"}]',
    'Пересказ встречи → [{"type":"meeting_notes","text":"<рассказ пользователя целиком>"}]',
    'Массовый перенос → [{"type":"bulk_move","scope":"both","from":"friday","to":"monday"}]',
    '«перенеси встречу с банком на 26.10 в то же время» → [{"type":"move_item","itemType":"meeting","query":"встреча с банком","when":"на 26.10 в то же время"}]',
    '«подключи к смете <имя>» → [{"type":"task_people","query":"смета","executors":[],"coexecutors":["<имя>"],"watchers":[],"remove":[],"replace":false}]',
    '«смету теперь ведёт <имя>» → [{"type":"task_people","query":"смета","executors":["<имя>"],"coexecutors":[],"watchers":[],"remove":[],"replace":true}]',
    '«отмени встречу с банком, клиент заболел» → [{"type":"cancel_meeting","query":"встреча с банком","reason":"клиент заболел"}]',
    'Ответ «перенеси на следующий понедельник» на напоминание о встрече «Планёрка» → [{"type":"move_item","itemType":"meeting","query":"Планёрка","when":"на следующий понедельник"}]',
    'Поиск по теме → [{"type":"search","query":"Севастополь"}]',
    '«как отложить задачу?» → [{"type":"howto","topic":"task_snooze"}]',
    '«что ты умеешь?» → [{"type":"howto","topic":""}]',
    '«отложи смету до понедельника» → [{"type":"snooze_task","query":"смета","until":"до понедельника","back":false}]',
    '«я в отпуске до 30.10» → [{"type":"away","until":"до 30.10","kind":"vacation","back":false}]',
    '«что там по опту» → [{"type":"search","query":"опт"}]',
    '«привет!» → [{"type":"chat"}]',
    '«спасибо, выручил» → [{"type":"chat"}]',
    '«устал, сегодня завал» → [{"type":"chat"}]',
    '«доброе утро, что у меня сегодня?» → [{"type":"question","query":"что у меня сегодня"}]',
    "На вопрос НИКОГДА не отвечай текстом — верни JSON с type=question, ответ сформирует другой шаг.",
  ].join("\n");
}

// Extracts a JSON array from the model's raw text response. Tolerates a
// bare object too (wraps it in a single-element array) — smaller/free-tier
// models don't always follow the "always an array" instruction exactly.
function extractJsonArray(raw: string): unknown[] {
  const trimmed = raw.trim();
  const arrStart = trimmed.indexOf("[");
  const objStart = trimmed.indexOf("{");
  const useArray = arrStart !== -1 && (objStart === -1 || arrStart < objStart);

  if (useArray) {
    const end = trimmed.lastIndexOf("]");
    if (end === -1 || end < arrStart) throw new Error("В ответе нет JSON-массива");
    const parsed = JSON.parse(trimmed.slice(arrStart, end + 1));
    if (!Array.isArray(parsed)) throw new Error("Ожидался массив");
    return parsed;
  }
  if (objStart !== -1) {
    const end = trimmed.lastIndexOf("}");
    if (end === -1 || end < objStart) throw new Error("В ответе нет JSON");
    return [JSON.parse(trimmed.slice(objStart, end + 1))];
  }
  throw new Error("В ответе нет JSON");
}

export const TOOL_BY_TYPE: Record<string, string> = {
  task: "create_task",
  meeting: "create_meeting",
  idea: "create_idea",
  clarify: "ask_clarifying_question",
  manage_item: "manage_item",
  question: "answer_question",
  meeting_notes: "meeting_notes",
  bulk_move: "bulk_move",
  move_item: "move_item",
  cancel_meeting: "cancel_meeting",
  review_task: "review_task",
  task_people: "task_people",
  meeting_people: "meeting_people",
  find_slot: "find_slot",
  remind_me: "remind_me",
  idea_to_task: "idea_to_task",
  agenda_add: "agenda_add",
  checklist: "checklist",
  nudge: "nudge",
  howto: "howto",
  snooze_task: "snooze_task",
  away: "away",
  search: "search_tracker",
  chat: "small_talk",
  other: "cant_help",
};

// Belt-and-suspenders: never trust the model to have actually honored the
// "only names from the list" instruction — enforce it here regardless.
// Returns the names that got dropped, so the caller can tell the user why
// (dropping silently is what caused real confusion in practice — the user
// had no way to know "Козлов" just wasn't in the assignee list).
// You say «Игорь готовит смету», the list says «Игорь Витковский» — and
// the name used to be dropped for not matching letter for letter, leaving
// the task with no executor. Nobody dictates full names, so a fragment is
// resolved to the known assignee it can only mean: tokens are matched by
// their opening letters (so «Никите Козлову» finds «Никита Козлов»), and
// if a fragment fits two people it is still dropped rather than guessed.
function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3);
}

export function resolveKnownName(candidate: string, known: string[]): string | null {
  const raw = candidate.trim();
  if (!raw) return null;
  if (known.includes(raw)) return raw;

  const wanted = nameTokens(raw);
  if (!wanted.length) return null;

  const matches = known.filter((k) => {
    const tokens = nameTokens(k);
    return wanted.some((w) => tokens.some((t) => sharesPrefix(w, t, 4)));
  });
  return matches.length === 1 ? matches[0] : null;
}

// Прозвучало ли это имя в том, что человек НА САМОМ ДЕЛЕ сказал.
//
// Сторож против имени, взятого моделью из воздуха — из примера в
// подсказке, из прошлого сообщения, из ниоткуда. 21.09.2026 «Создай
// задачу на сегодня позвонить Паше Котову» превратилось в задачу Игорю
// Витковскому: Игорь стоял в примере промпта, он есть в списке людей, и
// обе прежние проверки его пропустили — обе спрашивали «такой человек
// существует?», а надо было спросить «его вообще называли?».
//
// Сравнение то же, что у resolveKnownName: слова от четырёх общих букв,
// чтобы «Никите Козлову» узнавало «Никита Козлов». Имя, которого в
// фразе нет, вычёркивается МОЛЧА — сказать «пропустил Игоря» человеку,
// который Игоря не упоминал, значит объяснять ему чужую ошибку.
export function nameWasSaid(name: string, said: string): boolean {
  const heard = nameTokens(said);
  if (!heard.length) return false;
  return nameTokens(name).some((t) => heard.some((h) => sharesPrefix(h, t, 4)));
}

// `said` — исходная фраза человека. Без неё проверка «имя прозвучало» не
// делается вовсе: у зовущих, которые фразы не имеют (старые тесты,
// разбор по кускам), поведение остаётся прежним.
export function sanitizeAgainstKnown(input: Record<string, unknown>, known: string[], said = ""): string[] {
  const dropped: string[] = [];
  const invented = (name: string) => !!said && !nameWasSaid(name, said);
  // Название приводится в порядок здесь же, рядом с именами, и по той же
  // причине: модель просили о коротком названии, но проверить это может
  // только код. Без этого в календарь попадает сказанная фраза целиком,
  // вместе со словом «Создай» в начале, — так там и оказались строки на
  // двести символов.
  if (typeof input.title === "string") input.title = cleanTitle(input.title);
  // Срок и дата встречи — тоже факт, и проверяет их код: модель кладёт
  // сюда то слово, которое в соседнем словаре означает день («today»), и
  // дальше оно проходит насквозь до самой базы (см. normalizeDeadline).
  const today = moscowToday();
  for (const field of ["deadline", "date"]) {
    if (typeof input[field] === "string") input[field] = normalizeDeadline(input[field], today);
  }
  if (typeof input.assignee === "string" && input.assignee) {
    const resolved = invented(input.assignee) ? null : resolveKnownName(input.assignee, known);
    if (!resolved && !invented(input.assignee)) dropped.push(input.assignee);
    input.assignee = resolved || "";
  }
  // Участники встречи и соисполнители задачи чистятся одинаково: и то и
  // другое — список имён, которых в трекере может не оказаться.
  for (const field of ["participants", "executors"]) {
    const value = input[field];
    if (!Array.isArray(value)) continue;
    const kept: string[] = [];
    for (const n of value) {
      if (typeof n !== "string") continue;
      if (invented(n)) continue;
      const resolved = resolveKnownName(n, known);
      if (resolved && !kept.includes(resolved)) kept.push(resolved);
      else if (!resolved) dropped.push(n);
    }
    // Тот, кто уже стоит исполнителем, не должен попасть в список второй
    // раз: строка участия на человека одна, и вторая вставка — ошибка.
    input[field] = field === "executors" ? kept.filter((n) => n !== input.assignee) : kept;
  }
  return dropped;
}

export type QuickAddItem = { tool: string; input: Record<string, unknown>; droppedNames: string[] };
export type QuickAddParsed = { items: QuickAddItem[] };

// Одна вещь, названная моделью дважды, заводится один раз.
//
// 14.09.2026 Кирилл сказал боту одну задачу — «создай ещё одну задачу на
// Игоря Витковского, назови её тестовая задача для закрытия… назначь
// исполнителя Никита Козлов», — а журнал ассистента записал ответ модели
// как «create_task, create_task»: две задачи с одним названием, по одной
// на каждое имя. Код честно завёл обе, и в базе встали близнецы с номерами
// 41 и 42. Модель не обязана помнить, что уже назвала вещь; считать, что
// одна вещь — одна, должен код (то же правило, что с именами и датами).
//
// Ключ — название (у мысли текст), без регистра, лишних пробелов и знаков
// в конце. Совпавшая задача не выбрасывается, а вливается в первую: её
// исполнитель становится соисполнителем — это ровно то, что человек
// сказал, когда назвал двоих, — пустые описание и срок берутся у второй.
// У встречи ключ ещё и день со временем: две встречи с одним названием в
// разные дни — две встречи. Остальное (вопрос, поиск) — по полному
// совпадению.
function sameThingKey(item: QuickAddItem): string {
  const norm = (v: unknown) =>
    String(v ?? "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/[\s.!?,;:…]+$/u, "")
      .trim();
  const input = item.input;
  if (item.tool === "create_task") return "task|" + norm(input.title);
  if (item.tool === "create_idea") return "idea|" + norm(input.text);
  if (item.tool === "create_meeting") return ["meeting", norm(input.title), norm(input.date), norm(input.time)].join("|");
  return item.tool + "|" + JSON.stringify(input);
}

function names(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((n): n is string => typeof n === "string" && !!n) : [];
}

export function mergeDuplicateItems(items: QuickAddItem[]): QuickAddItem[] {
  const out: QuickAddItem[] = [];
  const byKey = new Map<string, QuickAddItem>();
  for (const item of items) {
    const key = sameThingKey(item);
    const first = byKey.get(key);
    if (!first) {
      const copy = { ...item, input: { ...item.input }, droppedNames: [...item.droppedNames] };
      byKey.set(key, copy);
      out.push(copy);
      continue;
    }
    for (const n of item.droppedNames) if (!first.droppedNames.includes(n)) first.droppedNames.push(n);
    const a = first.input;
    const b = item.input;
    if (item.tool === "create_task") {
      if (!a.assignee && typeof b.assignee === "string") a.assignee = b.assignee;
      const people = [typeof b.assignee === "string" ? b.assignee : "", ...names(a.executors), ...names(b.executors)];
      const executors: string[] = [];
      for (const n of people) if (n && n !== a.assignee && !executors.includes(n)) executors.push(n);
      a.executors = executors;
      for (const field of ["description", "deadline"]) if (!a[field] && b[field]) a[field] = b[field];
    } else if (item.tool === "create_meeting") {
      const participants = names(a.participants);
      for (const n of names(b.participants)) if (!participants.includes(n)) participants.push(n);
      a.participants = participants;
    } else if (item.tool === "create_idea") {
      if (b.important) a.important = true;
    }
  }
  return out;
}

// `memory` — то, чего в одной фразе нет: недавний разговор, сообщение, на
// которое ответили, и подтверждённые раньше разборы этого человека
// (lib/botMemory). Без него каждое сообщение было первым в жизни бота, и
// «на 26.10» после разговора о переносе разбиралось как бессмыслица.
export async function parseQuickAdd(text: string, assignees: string[], memory: { context?: string; lessons?: string } = {}): Promise<QuickAddParsed> {
  // Сегодня — по Москве, а не по часам сервера: на Vercel это UTC, и с
  // полуночи до трёх ночи «на сегодня» означало вчерашнее число, то есть
  // задачу, просроченную в момент создания.
  const system = [systemPrompt(moscowToday(), assignees), memory.lessons || "", memory.context || ""].filter(Boolean).join("\n\n");

  let parsed: unknown[] | null = null;
  let lastError = "";
  for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
    try {
      const raw = await gigaChatComplete({
        system: attempt === 0 ? system : system + "\n\nВАЖНО: ответь ТОЛЬКО валидным JSON-массивом, без единого лишнего символа.",
        user: text,
      });
      const candidates = extractJsonArray(raw).filter(
        (c): c is Record<string, unknown> => !!c && typeof c === "object" && "type" in c,
      );
      if (candidates.length) parsed = candidates;
      else lastError = "Ответ без элементов с полем type";
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }

  if (!parsed) throw new Error("GigaChat: " + lastError);

  const items: QuickAddItem[] = [];
  for (const p of parsed) {
    const type = String((p as Record<string, unknown>).type);
    const tool = TOOL_BY_TYPE[type];
    if (!tool) continue; // an unknown type from one element shouldn't sink the whole batch
    const { type: _omit, ...input } = p as Record<string, unknown>;
    void _omit;
    // Фраза человека едет в проверку вместе с разбором: без неё нельзя
    // отличить имя, которое он назвал, от имени, которое модель взяла из
    // подсказки (см. nameWasSaid).
    const droppedNames = sanitizeAgainstKnown(input, assignees, text);
    items.push({ tool, input, droppedNames });
  }
  if (!items.length) throw new Error("Не удалось разобрать ни одного элемента");

  return { items: dropTalkBesideWork(mergeDuplicateItems(items)) };
}

// «Привет, что у меня сегодня?» — это вопрос, а не приветствие плюс вопрос:
// два ответа подряд на одну фразу читаются как бот, который не слушает.
// Подсказка просит модель об этом, код проверяет (как с именами и датами).
// И непонятый обрывок рядом с живой репликой не повод отвечать «не понял».
export function dropTalkBesideWork(items: QuickAddItem[]): QuickAddItem[] {
  const talk = new Set(["small_talk", "cant_help"]);
  if (items.some((it) => !talk.has(it.tool))) return items.filter((it) => !talk.has(it.tool));
  const chat = items.find((it) => it.tool === "small_talk");
  return chat ? [chat] : items;
}
