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
<img class="brand-logo" src="data:image/png;base64,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" alt="Планировщик задач">
      <div>
        <h1>РОКАС</h1>
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