export const TRACKER_BODY_HTML = `

<div id="toast-stack"></div>
<div id="syncStatus"></div>
<div class="people-tooltip" id="peopleTooltip"></div>
<div class="date-popover" id="datePopover">
  <button type="button" class="date-popover-btn" id="datePopoverTaskBtn">+ Задача</button>
  <button type="button" class="date-popover-btn" id="datePopoverMeetingBtn">+ Встреча</button>
</div>

<header>
  <div class="header-row">
    <div class="brand">
<svg class="brand-logo" width="44" height="44" viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Планировщик задач">
  <rect width="44" height="44" rx="11" fill="url(#logoGrad)"/>
  <path d="M13 22.5l6 6 12-13" stroke="#F3F8FA" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  <defs>
    <linearGradient id="logoGrad" x1="0" y1="0" x2="44" y2="44" gradientUnits="userSpaceOnUse">
      <stop stop-color="#4FA8D8"/>
      <stop offset="1" stop-color="#2C6B85"/>
    </linearGradient>
  </defs>
</svg>
      <div>
        <h1>Планировщик задач</h1>
        <div class="subtitle" id="dateNow"></div>
      </div>
    </div>
    <div class="header-quote">
      <div class="hqline">Есть десятилетия, за которые ничего не случается, <b>и есть недели, за которые случаются десятилетия.</b></div>
    </div>
    <div class="header-btns" style="display:flex; gap:6px; flex-wrap:wrap;">
      <button class="btn active" id="ideasToggleBtn">💡 Идеи</button>
      <button class="btn active" id="calToggleBtn">📅 Календарь</button>
      <button class="btn" id="notifPermBtn">🔔 Уведомления</button>
      <button class="btn" id="resetLayoutBtn" style="display:none;" title="Панели вернутся на исходные места">↺ Сбросить расположение</button>
      <button class="btn btn-primary" id="installAppBtn" style="display:none;">📥 Установить</button>
      <button class="btn" id="telegramLinkBtn">🔗 Telegram</button>
      <button class="btn" id="signOutBtn">Выйти</button>
    </div>
  </div>
</header>

<div class="layout" id="layoutGrid">

  <!-- Left zone -->
  <div class="dash-zone" id="zoneLeft" data-zone="left">
    <div class="panel dash-panel" id="calPanel" data-panel-id="calPanel">
      <div class="dash-panel-head">
        <span class="dash-drag-handle" draggable="true" title="Перетащить панель">⠿⠿</span>
        <div class="panel-title">Календарь</div>
      </div>
      <div class="cal-nav">
        <button class="btn btn-small" id="calPrevBtn">←</button>
        <div class="cal-month" id="calMonthLabel"></div>
        <button class="btn btn-small" id="calNextBtn">→</button>
      </div>
      <div class="cal-grid" id="calGrid"></div>
      <div class="cal-filter-note" id="calFilterNote" style="display:none;">
        <span id="calFilterText"></span>
        <button class="btn btn-small" id="calAddMeetingBtn">+ Встреча</button>
        <button class="btn btn-small" id="calClearBtn">Показать все даты</button>
      </div>
    </div>

    <div class="panel dash-panel" id="meetingsPanel" data-panel-id="meetingsPanel">
      <div class="dash-panel-head">
        <span class="dash-drag-handle" draggable="true" title="Перетащить панель">⠿⠿</span>
        <div class="panel-title">Встречи <span class="count" id="countMeetings">0</span></div>
        <button class="btn btn-primary btn-small" id="addMeetingBtn">+</button>
      </div>
      <div id="meetingsForDay"></div>
    </div>
  </div>

  <!-- Center zone -->
  <div class="dash-zone" id="zoneCenter" data-zone="center">
    <div class="main-col dash-panel" id="mainCol" data-panel-id="mainCol">
      <div class="dash-panel-head">
        <span class="dash-drag-handle" draggable="true" title="Перетащить панель">⠿⠿</span>
        <div class="panel-title">Задачи</div>
      </div>
      <div class="notif-banner" id="notifBanner"></div>
      <div class="notif-banner" id="syncErrorBanner" style="display:none;"></div>

      <div class="toolbar">
        <button class="btn btn-primary" id="newTaskBtn">+ Новая задача</button>
        <div class="search-wrap" id="quickAddSlot"></div>
        <select id="filterSection"><option value="all">Все разделы</option></select>
        <select id="filterAssignee"><option value="all">Все исполнители</option></select>
        <select id="filterPriority">
          <option value="all">Любой приоритет</option>
          <option value="high">Высокий</option>
          <option value="med">Средний</option>
        </select>
        <label class="check-wrap"><input type="checkbox" id="showDoneCheckbox"> Показывать завершённые</label>
      </div>

      <div class="columns">
        <div class="column" id="colShort">
          <div class="section-title" id="titleShort">Краткосрочные <span class="count" id="countShort">0</span><span class="collapse-arrow">▾</span></div>
          <div id="listShort"></div>
        </div>
        <div class="column" id="colLong">
          <div class="section-title" id="titleLong">Долгосрочные <span class="count" id="countLong">0</span><span class="collapse-arrow">▾</span></div>
          <div id="listLong"></div>
        </div>
      </div>

      <div class="done-wrap" id="doneWrap" style="display:none;">
        <div class="section-title">Завершённые <span class="count" id="countDone">0</span></div>
        <div id="listDone"></div>
      </div>
    </div>
  </div>

  <!-- Right zone -->
  <div class="dash-zone" id="zoneRight" data-zone="right">
    <div class="panel dash-panel" id="ideasPanel" data-panel-id="ideasPanel">
      <div class="dash-panel-head">
        <span class="dash-drag-handle" draggable="true" title="Перетащить панель">⠿⠿</span>
        <div class="panel-title">Идеи и мысли <span class="count" id="countIdeas">0</span></div>
      </div>
      <div class="idea-add">
        <input type="text" id="ideaInput" placeholder="Мысль, идея… Enter — сохранить">
        <button class="btn btn-primary btn-small" id="ideaAddBtn">+</button>
      </div>
      <div id="ideaList"></div>
    </div>
  </div>

</div>

<!-- Modal -->
<div class="overlay" id="overlay">
  <div class="modal">
    <h2 id="modalTitle">Новая задача</h2>
    <input type="hidden" id="taskId">

    <div class="field">
      <label>Название задачи</label>
      <input type="text" id="fTitle" placeholder="Например: Согласовать прайс с поставщиком">
    </div>

    <div class="field">
      <label>Описание (необязательно)</label>
      <textarea id="fDesc" placeholder="Детали, контекст…"></textarea>
    </div>

    <div class="field">
      <label>Исполнитель</label>
      <div class="select-with-add">
        <select id="fAssignee"></select>
        <button class="btn" id="addAssigneeBtn" type="button" title="Добавить исполнителя">+</button>
        <button class="btn btn-danger-ghost" id="removeAssigneeBtn" type="button" title="Удалить выбранного исполнителя">−</button>
      </div>
    </div>

    <div class="field">
      <label>Раздел</label>
      <div class="select-with-add">
        <select id="fSection"><option value="">Без раздела</option></select>
        <button class="btn" id="addSectionBtn" type="button" title="Добавить раздел">+</button>
        <button class="btn btn-danger-ghost" id="removeSectionBtn" type="button" title="Удалить выбранный раздел">−</button>
      </div>
    </div>

    <div class="row2">
      <div class="field">
        <label>Приоритет</label>
        <select id="fPriority">
          <option value="high">Высокий</option>
          <option value="med" selected>Средний</option>
        </select>
      </div>
      <div class="field">
        <label>Срочность</label>
        <select id="fTerm">
          <option value="short">Краткосрочная</option>
          <option value="long">Долгосрочная</option>
        </select>
      </div>
    </div>

    <div class="field">
      <label>Дедлайн / дата</label>
      <input type="date" id="fDeadline">
    </div>

    <div class="field">
      <label>Повторение задачи</label>
      <select id="fRecur">
        <option value="none">Не повторяется</option>
        <option value="daily">Каждый день</option>
        <option value="weekly">Каждую неделю (день недели)</option>
        <option value="monthly">Каждый месяц (число)</option>
        <option value="yearly">Каждый год (число и месяц)</option>
      </select>

      <div class="recur-config" id="recurWeekly">
        <label>День недели</label>
        <select id="fRecurWeekday">
          <option value="1">Понедельник</option>
          <option value="2">Вторник</option>
          <option value="3">Среда</option>
          <option value="4">Четверг</option>
          <option value="5">Пятница</option>
          <option value="6">Суббота</option>
          <option value="0">Воскресенье</option>
        </select>
      </div>
      <div class="recur-config" id="recurMonthly">
        <label>Число месяца</label>
        <input type="text" id="fRecurMonthday" placeholder="Например: 5 или 28">
      </div>
      <div class="recur-config" id="recurYearly">
        <label>День и месяц</label>
        <div class="row2">
          <input type="text" id="fRecurYearDay" placeholder="Число (напр. 15)">
          <select id="fRecurYearMonth">
            <option value="1">Январь</option><option value="2">Февраль</option><option value="3">Март</option>
            <option value="4">Апрель</option><option value="5">Май</option><option value="6">Июнь</option>
            <option value="7">Июль</option><option value="8">Август</option><option value="9">Сентябрь</option>
            <option value="10">Октябрь</option><option value="11">Ноябрь</option><option value="12">Декабрь</option>
          </select>
        </div>
      </div>

      <div class="stop-recur-row" id="stopRecurRow">
        <button class="btn btn-danger-ghost btn-small" id="stopRecurBtn" type="button">⏹ Прекратить повторение</button>
      </div>
    </div>

    <div class="modal-actions">
      <div class="left">
        <button class="btn btn-danger-ghost" id="deleteTaskBtn" style="display:none;">Удалить</button>
      </div>
      <div class="left">
        <button class="btn" id="cancelBtn">Отмена</button>
        <button class="btn btn-primary" id="saveTaskBtn">Сохранить</button>
      </div>
    </div>
  </div>
</div>

<!-- Meeting modal -->
<div class="overlay" id="meetingOverlay">
  <div class="modal">
    <h2 id="meetingModalTitle">Новая встреча</h2>
    <input type="hidden" id="meetingId">

    <div class="field">
      <label>Дата</label>
      <input type="date" id="mDate">
    </div>

    <div class="field">
      <label>Название встречи</label>
      <input type="text" id="mTitle" placeholder="Например: Совещание по опту">
    </div>

    <div class="field">
      <label>Время</label>
      <input type="time" id="mTime" value="10:00">
    </div>

    <div class="field participants-field" id="participantsField">
      <label>Состав участников</label>
      <button type="button" class="participants-trigger" id="participantsTrigger">Выберите участников</button>
      <div class="participants-dropdown" id="participantsDropdown">
        <div class="participants-list" id="mParticipants"></div>
        <div class="participants-dropdown-footer">
          <button type="button" class="btn btn-small btn-primary" id="participantsDoneBtn">Готово</button>
        </div>
      </div>
    </div>

    <div class="field outcome-field" id="outcomeField" style="display:none;">
      <label>Итог встречи</label>
      <div class="outcome-badge" id="outcomeBadge"></div>
      <textarea id="mResult" rows="2" placeholder="Кратко: что решили, что дальше…"></textarea>
      <div class="outcome-actions">
        <button type="button" class="btn btn-small outcome-btn-success" id="markSuccessBtn">✅ Успешно</button>
        <button type="button" class="btn btn-small outcome-btn-noresult" id="markNoResultBtn">🚫 Без результата</button>
        <button type="button" class="btn btn-small" id="reopenMeetingBtn" style="display:none;">↺ Вернуть в план</button>
      </div>
      <div class="reschedule-row">
        <input type="date" id="mRescheduleDate">
        <input type="time" id="mRescheduleTime" value="10:00">
        <button type="button" class="btn btn-small" id="rescheduleBtn">📅 Перенести следующий этап</button>
      </div>
    </div>

    <div class="modal-actions">
      <div class="left">
        <button class="btn btn-danger-ghost" id="deleteMeetingBtn" style="display:none;">Удалить</button>
      </div>
      <div class="left">
        <button class="btn" id="meetingCancelBtn">Отмена</button>
        <button class="btn btn-primary" id="meetingSaveBtn">Сохранить</button>
      </div>
    </div>
  </div>
</div>

<!-- Generic date+time confirmation, used instead of the browser's native
     prompt() for drag-to-reschedule and the quick "📅" icon on meeting chips. -->
<div class="overlay" id="confirmDateTimeOverlay">
  <div class="modal" style="max-width:360px;">
    <h2>Подтвердите действие</h2>
    <p class="confirm-dt-question" id="confirmDateTimeQuestion"></p>
    <div class="row2">
      <div class="field">
        <label>Дата</label>
        <input type="date" id="confirmDateTimeDate">
      </div>
      <div class="field">
        <label>Время</label>
        <input type="time" id="confirmDateTimeTime">
      </div>
    </div>
    <div class="modal-actions">
      <div class="left"></div>
      <div class="left">
        <button class="btn" id="confirmDateTimeCancelBtn">Отмена</button>
        <button class="btn btn-primary" id="confirmDateTimeOkBtn">ОК</button>
      </div>
    </div>
  </div>
</div>

`;