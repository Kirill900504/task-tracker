(function(){
  "use strict";

  // ---------- Storage ----------
  // Tasks/meetings/ideas/assignees live in Supabase (see the sync section
  // below); LS_NOTIFIED stays in localStorage — it's just a per-device
  // "already showed this notification" cache with no reason to sync.
  var LS_NOTIFIED = "kkt_notified_v2";

  var DEFAULT_ASSIGNEES = [
    "Кирилл (я)",
    "Игорь Витковский", "Юра Нодберг",
    "Евгений Макаров", "Станислав Синецкий", "Наталья Мамакова",
    "Михаил Иванов",
    "Котов Михаил", "Сергей Титов",
    "Юрий Черкашин",
    "Никита Долгов",
    "Наталья Есина", "Оксана Нишкомаева",
    "Сергей Головань",
    "Зав. складом и логистикой"
  ];

  function load(key, fallback){
    try{
      var raw = localStorage.getItem(key);
      if(!raw) return fallback;
      return JSON.parse(raw);
    }catch(e){ return fallback; }
  }
  function save(key, val){
    try{ localStorage.setItem(key, JSON.stringify(val)); }catch(e){}
  }

  var tasks = [];
  var meetings = [];
  var ideas = [];
  var assignees = [];
  var notified = load(LS_NOTIFIED, {});

  function sanitizeAssigneeList(list){
    var out = [];
    (Array.isArray(list) ? list : []).forEach(function(a){
      var name = null;
      if(typeof a === "string") name = a.trim();
      else if(a && typeof a === "object"){
        name = String(a.name || a.title || a.label || a.assignee || "").trim();
      } else if(a !== null && a !== undefined && typeof a !== "object"){
        name = String(a).trim();
      }
      if(name && !/^\[object .*\]$/i.test(name) && out.indexOf(name) === -1) out.push(name);
    });
    return out;
  }

  // ---------- Supabase sync ----------
  // Every user action still mutates the in-memory tasks/meetings/ideas/assignees
  // arrays exactly as before and calls persistAll(). Only persistAll() itself
  // changed: instead of writing to localStorage, it diffs the current arrays
  // against the last-synced snapshot ("shadow") and pushes just the changed
  // rows to Supabase. Calls are chained on syncChain so they run in order.
  var db = null;
  var shadow = { tasks: [], meetings: [], ideas: [], assignees: [] };
  var syncChain = Promise.resolve();

  function taskToRow(t){
    return {
      id: t.id,
      title: t.title,
      description: t.desc || "",
      assignee: t.assignee || "",
      priority: t.priority,
      term: t.term,
      status: t.status,
      deadline: t.deadline || null,
      recur: t.recur || "none",
      recur_weekday: (t.recurWeekday !== "" && t.recurWeekday != null) ? Number(t.recurWeekday) : null,
      recur_monthday: (t.recurMonthday !== "" && t.recurMonthday != null) ? Number(t.recurMonthday) : null,
      recur_year_day: (t.recurYearDay !== "" && t.recurYearDay != null) ? Number(t.recurYearDay) : null,
      recur_year_month: (t.recurYearMonth !== "" && t.recurYearMonth != null) ? Number(t.recurYearMonth) : null,
      last_completed_on: t.lastCompletedOn || null
    };
  }
  function taskFromRow(r){
    return {
      id: r.id,
      title: r.title,
      desc: r.description || "",
      assignee: r.assignee || "",
      priority: r.priority,
      term: r.term,
      status: r.status,
      deadline: r.deadline || "",
      recur: r.recur || "none",
      recurWeekday: r.recur_weekday != null ? String(r.recur_weekday) : "1",
      recurMonthday: r.recur_monthday != null ? String(r.recur_monthday) : "",
      recurYearDay: r.recur_year_day != null ? String(r.recur_year_day) : "",
      recurYearMonth: r.recur_year_month != null ? String(r.recur_year_month) : "1",
      lastCompletedOn: r.last_completed_on || ""
    };
  }

  function meetingToRow(m){
    return {
      id: m.id,
      date: m.date,
      time: m.time || "",
      title: m.title,
      participants: sanitizeAssigneeList(m.participants),
      status: m.status || "planned",
      result: m.result || "",
      moved_to_date: m.movedToDate || null
    };
  }
  function meetingFromRow(r){
    return {
      id: r.id,
      date: r.date,
      time: r.time || "",
      title: r.title,
      participants: sanitizeAssigneeList(r.participants),
      status: r.status || "planned",
      result: r.result || "",
      movedToDate: r.moved_to_date || ""
    };
  }

  function ideaToRow(i){
    return { id: i.id, text: i.text, important: !!i.important, done: !!i.done };
  }
  function formatIdeaCreatedAt(iso){
    var d = new Date(iso);
    return pad(d.getDate()) + "." + pad(d.getMonth()+1) + "." + d.getFullYear() + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  function ideaFromRow(r){
    return { id: r.id, text: r.text, important: !!r.important, done: !!r.done, createdAt: formatIdeaCreatedAt(r.created_at) };
  }

  function sameJson(a, b){ return JSON.stringify(a) === JSON.stringify(b); }

  function diffAndSync(table, current, shadowList, toRow){
    var byIdCurrent = {}; current.forEach(function(x){ byIdCurrent[x.id] = x; });
    var byIdShadow = {}; shadowList.forEach(function(x){ byIdShadow[x.id] = x; });

    var upserts = [];
    current.forEach(function(x){
      var prev = byIdShadow[x.id];
      if(!prev || !sameJson(toRow(x), toRow(prev))) upserts.push(toRow(x));
    });
    var deletes = shadowList.filter(function(x){ return !byIdCurrent[x.id]; }).map(function(x){ return x.id; });

    var chain = Promise.resolve();
    if(upserts.length){
      chain = chain.then(function(){ return db.from(table).upsert(upserts); })
        .then(function(res){ if(res.error) throw res.error; });
    }
    if(deletes.length){
      chain = chain.then(function(){ return db.from(table).delete().in("id", deletes); })
        .then(function(res){ if(res.error) throw res.error; });
    }
    return chain;
  }

  function diffAndSyncAssignees(current, shadowList){
    var added = current.filter(function(name){ return shadowList.indexOf(name) === -1; });
    var removed = shadowList.filter(function(name){ return current.indexOf(name) === -1; });

    var chain = Promise.resolve();
    if(added.length){
      chain = chain.then(function(){
        return db.from("assignees").upsert(added.map(function(name){ return { name: name }; }), { onConflict: "user_id,name" });
      }).then(function(res){ if(res.error) throw res.error; });
    }
    if(removed.length){
      chain = chain.then(function(){ return db.from("assignees").delete().in("name", removed); })
        .then(function(res){ if(res.error) throw res.error; });
    }
    return chain;
  }

  function persistAll(){
    save(LS_NOTIFIED, notified);
    if(!db) return;

    var tasksNow = tasks.slice();
    var meetingsNow = meetings.slice();
    var ideasNow = ideas.slice();
    var assigneesNow = assignees.slice();

    syncChain = syncChain
      .then(function(){ return diffAndSync("tasks", tasksNow, shadow.tasks, taskToRow); })
      .then(function(){ shadow.tasks = tasksNow; })
      .then(function(){ return diffAndSync("meetings", meetingsNow, shadow.meetings, meetingToRow); })
      .then(function(){ shadow.meetings = meetingsNow; })
      .then(function(){ return diffAndSync("ideas", ideasNow, shadow.ideas, ideaToRow); })
      .then(function(){ shadow.ideas = ideasNow; })
      .then(function(){ return diffAndSyncAssignees(assigneesNow, shadow.assignees); })
      .then(function(){ shadow.assignees = assigneesNow; })
      .catch(function(err){
        console.error("Supabase sync error:", err);
        showToast("Не сохранилось в облако", (err && err.message) || "Проверьте интернет-соединение");
      });
  }

  // ---------- Helpers ----------
  function uid(){ return "t" + Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
  function pad(n){ return n < 10 ? "0"+n : ""+n; }
  function dateStr(d){ return d.getFullYear() + "-" + pad(d.getMonth()+1) + "-" + pad(d.getDate()); }
  function todayStr(){ return dateStr(new Date()); }
  function fmtDate(iso){
    if(!iso) return "";
    var p = iso.split("-");
    return p[2] + "." + p[1] + "." + p[0];
  }
  function weekdayName(n){
    return ["Вс","Пн","Вт","Ср","Чт","Пт","Сб"][n];
  }

  // ---------- Recurrence ----------
  function isDueToday(task){
    if(task.recur === "none") return task.deadline === todayStr();
    var t = new Date();
    if(task.recur === "daily") return true;
    if(task.recur === "weekly") return String(t.getDay()) === String(task.recurWeekday);
    if(task.recur === "monthly") return String(t.getDate()) === String(task.recurMonthday);
    if(task.recur === "yearly") return String(t.getDate()) === String(task.recurYearDay) && String(t.getMonth()+1) === String(task.recurYearMonth);
    return false;
  }

  function isTaskDueOnDate(task, d){
    if(task.recur === "none") return task.deadline === dateStr(d);
    if(task.recur === "daily") return true;
    if(task.recur === "weekly") return String(d.getDay()) === String(task.recurWeekday);
    if(task.recur === "monthly") return String(d.getDate()) === String(task.recurMonthday);
    if(task.recur === "yearly") return String(d.getDate()) === String(task.recurYearDay) && String(d.getMonth()+1) === String(task.recurYearMonth);
    return false;
  }

  function mostRecentOccurrence(task, ref){
    var y = ref.getFullYear(), m = ref.getMonth();
    if(task.recur === "daily"){
      return dateStr(ref);
    }
    if(task.recur === "weekly"){
      var wd = ref.getDay();
      var target = Number(task.recurWeekday);
      if(isNaN(target)) return null;
      var diff = (wd - target + 7) % 7;
      var dt = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() - diff);
      return dateStr(dt);
    }
    if(task.recur === "monthly"){
      var day = Number(task.recurMonthday);
      if(!day) return null;
      var candidate = new Date(y, m, day);
      if(candidate.getTime() > ref.getTime()){
        candidate = new Date(y, m - 1, day);
      }
      return dateStr(candidate);
    }
    if(task.recur === "yearly"){
      var yday = Number(task.recurYearDay), ymonth = Number(task.recurYearMonth) - 1;
      if(!yday) return null;
      var yc = new Date(y, ymonth, yday);
      if(yc.getTime() > ref.getTime()){
        yc = new Date(y - 1, ymonth, yday);
      }
      return dateStr(yc);
    }
    return null;
  }

  function refreshRecurringStatuses(){
    var now = new Date();
    var changed = false;
    tasks.forEach(function(t){
      if(t.recur === "none") return;
      if(t.status !== "done") return;
      var period = mostRecentOccurrence(t, now);
      if(!period) return;
      if(!t.lastCompletedOn || t.lastCompletedOn < period){
        t.status = "in_progress";
        changed = true;
      }
    });
    if(changed) persistAll();
  }

  function isOverdue(task){
    if(task.status === "done") return false;
    if(task.recur !== "none") return false;
    if(!task.deadline) return false;
    return task.deadline < todayStr();
  }

  function isDueTodayHighlight(task){
    if(task.status === "done") return false;
    if(task.recur === "none") return task.deadline === todayStr();
    return isDueToday(task);
  }

  // ---------- Render ----------
  var elListShort = document.getElementById("listShort");
  var elListLong = document.getElementById("listLong");
  var elListDone = document.getElementById("listDone");
  var calendarFilterDate = null;

  function populateSelect(sel, items, withAllOption, allLabel){
    var current = sel.value;
    sel.innerHTML = "";
    if(withAllOption){
      var o = document.createElement("option");
      o.value = "all"; o.textContent = allLabel;
      sel.appendChild(o);
    }
    items.forEach(function(it){
      var opt = document.createElement("option");
      opt.value = it; opt.textContent = it;
      sel.appendChild(opt);
    });
    if(current && items.concat(withAllOption?["all"]:[]).indexOf(current) !== -1){
      sel.value = current;
    }
  }

  function refreshSelectsGlobal(){
    assignees = sanitizeAssigneeList(assignees);
    populateSelect(document.getElementById("filterAssignee"), assignees, true, "Все исполнители");
    populateSelect(document.getElementById("fAssignee"), assignees, false);
  }

  function priorityLabel(p){ return p === "high" ? "Высокий" : "Средний"; }
  function priorityClass(p){ return p === "high" ? "pill-high" : "pill-med"; }
  function recurLabel(t){
    if(t.recur === "none") return "";
    if(t.recur === "daily") return "🔁 Ежедневно";
    if(t.recur === "weekly") return "🔁 По " + weekdayName(Number(t.recurWeekday)).toLowerCase() + "м";
    if(t.recur === "monthly") return "🔁 Каждое " + t.recurMonthday + " число";
    if(t.recur === "yearly") return "🔁 Ежегодно " + t.recurYearDay + "." + pad(Number(t.recurYearMonth));
    return "";
  }

  function matchesFilters(t){
    var assignee = document.getElementById("filterAssignee").value;
    var priority = document.getElementById("filterPriority").value;
    var q = document.getElementById("searchInput").value.trim().toLowerCase();

    if(assignee !== "all" && t.assignee !== assignee) return false;
    if(priority !== "all" && t.priority !== priority) return false;
    if(q){
      var hay = (t.title + " " + (t.desc||"")).toLowerCase();
      if(hay.indexOf(q) === -1) return false;
    }
    if(calendarFilterDate){
      var d = new Date(calendarFilterDate + "T00:00:00");
      if(!isTaskDueOnDate(t, d)) return false;
    }
    return true;
  }

  function taskCard(t){
    var div = document.createElement("div");
    div.className = "task"
      + (t.status === "done" ? " done" : "")
      + (t.priority === "high" ? " high" : "")
      + (isOverdue(t) ? " overdue" : "")
      + (!isOverdue(t) && isDueTodayHighlight(t) ? " due-today" : "");
    div.dataset.id = t.id;

    var check = document.createElement("div");
    check.className = "check" + (t.status === "done" ? " checked" : "");
    check.textContent = t.status === "done" ? "✓" : "";
    check.addEventListener("click", function(e){
      e.stopPropagation();
      if(t.status === "done"){
        t.status = "in_progress";
        t.lastCompletedOn = "";
      } else {
        t.status = "done";
        t.lastCompletedOn = todayStr();
      }
      persistAll(); render();
    });

    var body = document.createElement("div");
    body.className = "task-body";

    var title = document.createElement("div");
    title.className = "task-title";
    title.textContent = t.title;
    body.appendChild(title);

    var meta = document.createElement("div");
    meta.className = "task-meta";

    if(t.assignee){
      var asg = document.createElement("div");
      asg.className = "task-assignee";
      var arrow = document.createElement("span");
      arrow.className = "arrow"; arrow.textContent = "→";
      asg.appendChild(arrow);
      asg.appendChild(document.createTextNode(t.assignee));
      meta.appendChild(asg);
    }

    if(t.deadline){
      var dPill = document.createElement("span");
      dPill.className = "pill pill-date"
        + (isOverdue(t) ? " overdue-text" : "")
        + (!isOverdue(t) && isDueTodayHighlight(t) ? " due-today-text" : "");
      dPill.textContent = (isOverdue(t) ? "⚠ Просрочено: " : (isDueTodayHighlight(t) ? "● Сегодня: " : "до ")) + fmtDate(t.deadline);
      meta.appendChild(dPill);
    }

    if(!t.deadline && t.recur !== "none" && isDueTodayHighlight(t)){
      var tPill = document.createElement("span");
      tPill.className = "pill pill-date due-today-text";
      tPill.textContent = "● Выполнить сегодня";
      meta.appendChild(tPill);
    }

    var prPill = document.createElement("span");
    prPill.className = "pill " + priorityClass(t.priority); prPill.textContent = priorityLabel(t.priority);
    meta.appendChild(prPill);

    var rl = recurLabel(t);
    if(rl){
      var rPill = document.createElement("span");
      rPill.className = "pill pill-recur"; rPill.textContent = rl;
      meta.appendChild(rPill);
    }

    body.appendChild(meta);
    div.appendChild(check);
    div.appendChild(body);

    div.addEventListener("click", function(){ openModal(t.id); });
    return div;
  }

  function render(){
    refreshSelectsGlobal();

    var showDone = document.getElementById("showDoneCheckbox").checked;
    var filtered = tasks.filter(matchesFilters);
    var shortOpen = filtered.filter(function(t){ return t.term === "short" && t.status !== "done"; });
    var longOpen = filtered.filter(function(t){ return t.term === "long" && t.status !== "done"; });
    var doneList = filtered.filter(function(t){ return t.status === "done"; });

    // Порядок групп (сверху вниз):
    // 0 — просроченные (самые старые дедлайны — выше)
    // 1 — дедлайн сегодня (в т.ч. повторяющиеся, у которых сегодня день выполнения)
    // 2 — без указанного дедлайна
    // 3 — с дедлайном в будущем (ближайшие — выше, дальние — ниже)
    function rankOf(t){
      if(isOverdue(t)) return 0;
      if(isDueTodayHighlight(t)) return 1;
      if(!t.deadline) return 2;
      return 3;
    }
    function sortFn(a,b){
      var ao = rankOf(a), bo = rankOf(b);
      if(ao !== bo) return ao - bo;

      // Внутри группы "просрочено" и "будущий дедлайн" — сначала по дате (раньше дата = выше)
      if(ao === 0 || ao === 3){
        var ad = a.deadline || "", bd = b.deadline || "";
        if(ad !== bd) return ad < bd ? -1 : 1;
      }

      // Если дата совпадает (или дедлайна нет вовсе, группа 1/2) — тай-брейк:
      // 1) высокий приоритет выше среднего
      if(a.priority !== b.priority) return a.priority === "high" ? -1 : 1;
      // 2) из задач с одинаковым приоритетом — та, что заведена раньше (ждёт дольше), выше
      if(a.id !== b.id) return a.id < b.id ? -1 : 1;
      return 0;
    }
    shortOpen.sort(sortFn);
    longOpen.sort(sortFn);

    document.getElementById("countShort").textContent = shortOpen.length;
    document.getElementById("countLong").textContent = longOpen.length;
    document.getElementById("countDone").textContent = doneList.length;

    elListShort.innerHTML = "";
    if(shortOpen.length === 0){
      var e1 = document.createElement("div"); e1.className="empty"; e1.textContent="Нет краткосрочных задач по текущим фильтрам";
      elListShort.appendChild(e1);
    } else {
      shortOpen.forEach(function(t){ elListShort.appendChild(taskCard(t)); });
    }

    elListLong.innerHTML = "";
    if(longOpen.length === 0){
      var e2 = document.createElement("div"); e2.className="empty"; e2.textContent="Нет долгосрочных задач по текущим фильтрам";
      elListLong.appendChild(e2);
    } else {
      longOpen.forEach(function(t){ elListLong.appendChild(taskCard(t)); });
    }

    var doneWrap = document.getElementById("doneWrap");
    if(showDone){
      doneWrap.style.display = "";
      elListDone.innerHTML = "";
      if(doneList.length === 0){
        var e3 = document.createElement("div"); e3.className="empty"; e3.textContent="Нет завершённых задач по текущим фильтрам";
        elListDone.appendChild(e3);
      } else {
        doneList.sort(function(a,b){ var ad=a.deadline||"", bd=b.deadline||""; return ad<bd?1:ad>bd?-1:0; });
        doneList.forEach(function(t){ elListDone.appendChild(taskCard(t)); });
      }
    } else {
      doneWrap.style.display = "none";
    }

    renderCalFilterNote();
    renderAllMeetings();
  }

  // ---------- Side panels: toggle ----------
  // Раньше при скрытии колонки её ширина обнулялась (0px), но грид-зазор (gap)
  // вокруг неё оставался — получалась "пустая полоса" и сломанная раскладка.
  // Теперь при скрытии колонка убирается из grid-template-columns целиком,
  // а не просто схлопывается до 0.
  var calSide = document.getElementById("calSide");
  var calPanel = document.getElementById("calPanel");
  var ideasSide = document.getElementById("ideasSide");
  var layoutGrid = document.getElementById("layoutGrid");
  var calOpen = true, ideasOpen = true;

  function updateLayoutColumns(){
    // Левая колонка (300px) всегда зарезервирована — в ней всегда виден блок
    // "Встречи", даже если сам календарь скрыт кнопкой.
    var cols = ["300px", "1fr"];
    if(ideasOpen) cols.push("320px");
    layoutGrid.style.gridTemplateColumns = cols.join(" ");
    calPanel.style.display = calOpen ? "" : "none";
    ideasSide.style.display = ideasOpen ? "" : "none";
    document.getElementById("calToggleBtn").classList.toggle("active", calOpen);
    document.getElementById("ideasToggleBtn").classList.toggle("active", ideasOpen);
  }

  document.getElementById("ideasToggleBtn").addEventListener("click", function(){
    ideasOpen = !ideasOpen;
    updateLayoutColumns();
  });
  document.getElementById("calToggleBtn").addEventListener("click", function(){
    calOpen = !calOpen;
    updateLayoutColumns();
    if(calOpen) renderCalendar();
  });

  // Сворачивание колонок "Краткосрочные" / "Долгосрочные"
  ["colShort","colLong"].forEach(function(colId){
    var col = document.getElementById(colId);
    var title = col.querySelector(".section-title");
    var key = "kkt_collapsed_" + colId;
    try{ if(localStorage.getItem(key) === "1") col.classList.add("collapsed"); }catch(e){}
    title.addEventListener("click", function(){
      col.classList.toggle("collapsed");
      try{ localStorage.setItem(key, col.classList.contains("collapsed") ? "1" : "0"); }catch(e){}
    });
  });

  function renderIdeas(){
    var wrap = document.getElementById("ideaList");
    wrap.innerHTML = "";
    var showDone = document.getElementById("showDoneCheckbox").checked;
    var visible = ideas.filter(function(i){ return showDone || !i.done; });
    if(visible.length === 0){
      var e = document.createElement("div"); e.className = "empty";
      e.textContent = ideas.length === 0 ? "Пока пусто — запишите первую мысль" : "Нет активных мыслей";
      wrap.appendChild(e);
      return;
    }
    visible
      .slice()
      .reverse()
      .sort(function(a, b){ return (a.done === b.done) ? 0 : (a.done ? 1 : -1); })
      .forEach(function(idea){
      var row = document.createElement("div");
      row.className = "idea-item" + (idea.important ? " important" : "") + (idea.done ? " done" : "");
      var check = document.createElement("input");
      check.type = "checkbox"; check.className = "idea-done-check";
      check.checked = !!idea.done;
      check.title = idea.done ? "Вернуть в активные" : "Отметить завершённой";
      check.addEventListener("click", function(e){ e.stopPropagation(); });
      check.addEventListener("change", function(){
        idea.done = check.checked;
        persistAll(); renderIdeas();
      });
      var left = document.createElement("div");
      left.style.flex = "1"; left.style.minWidth = "0";
      var txt = document.createElement("div"); txt.className = "idea-text"; txt.textContent = idea.text;
      txt.title = "Нажмите, чтобы отредактировать";
      var meta = document.createElement("div"); meta.className = "idea-meta"; meta.textContent = idea.createdAt;
      left.appendChild(txt); left.appendChild(meta);

      txt.addEventListener("click", function(){
        var boxHeight = txt.getBoundingClientRect().height;
        var editInput = document.createElement("textarea");
        editInput.className = "idea-edit-input";
        editInput.value = idea.text;
        editInput.style.height = Math.max(boxHeight + 10, 44) + "px";
        left.replaceChild(editInput, txt);
        editInput.focus();
        editInput.setSelectionRange(editInput.value.length, editInput.value.length);
        var saved = false;
        function save(){
          if(saved) return; saved = true;
          var v = editInput.value.trim();
          if(v) idea.text = v;
          persistAll();
          renderIdeas();
        }
        editInput.addEventListener("blur", save);
        editInput.addEventListener("keydown", function(e){
          if(e.key === "Enter" && !e.shiftKey){ e.preventDefault(); editInput.blur(); }
          else if(e.key === "Escape"){ saved = true; renderIdeas(); }
        });
      });

      var actions = document.createElement("div");
      actions.className = "idea-actions";

      var flag = document.createElement("button");
      flag.className = "idea-flag" + (idea.important ? " active" : "");
      flag.textContent = "🚩";
      flag.title = idea.important ? "Снять пометку «Важно»" : "Отметить «Важно»";
      flag.addEventListener("click", function(e){
        e.stopPropagation();
        idea.important = !idea.important;
        persistAll(); renderIdeas();
      });

      var del = document.createElement("button");
      del.className = "idea-del"; del.textContent = "×"; del.title = "Удалить";
      del.addEventListener("click", function(e){
        e.stopPropagation();
        ideas = ideas.filter(function(i){ return i.id !== idea.id; });
        persistAll(); renderIdeas();
      });

      actions.appendChild(flag);
      actions.appendChild(del);
      row.appendChild(check);
      row.appendChild(left);
      row.appendChild(actions);
      wrap.appendChild(row);
    });
  }

  function addIdea(){
    var input = document.getElementById("ideaInput");
    var v = input.value.trim();
    if(!v) return;
    var d = new Date();
    ideas.push({
      id: uid(),
      text: v,
      important: false,
      done: false,
      createdAt: pad(d.getDate()) + "." + pad(d.getMonth()+1) + "." + d.getFullYear() + " " + pad(d.getHours()) + ":" + pad(d.getMinutes())
    });
    persistAll();
    input.value = "";
    renderIdeas();
  }
  document.getElementById("ideaAddBtn").addEventListener("click", addIdea);
  document.getElementById("ideaInput").addEventListener("keydown", function(e){
    if(e.key === "Enter"){ e.preventDefault(); addIdea(); }
  });

  // ---------- Calendar panel ----------
  var calViewDate = new Date();

  function renderCalendar(){
    var y = calViewDate.getFullYear(), m = calViewDate.getMonth();
    var monthNames = ["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"];
    document.getElementById("calMonthLabel").textContent = monthNames[m] + " " + y;

    var grid = document.getElementById("calGrid");
    grid.innerHTML = "";
    ["Пн","Вт","Ср","Чт","Пт","Сб","Вс"].forEach(function(wd){
      var el = document.createElement("div"); el.className = "cal-wd"; el.textContent = wd;
      grid.appendChild(el);
    });

    var firstOfMonth = new Date(y, m, 1);
    var startOffset = (firstOfMonth.getDay() + 6) % 7;
    var todayS = todayStr();

    var cellDate = new Date(y, m, 1 - startOffset);
    for(var i = 0; i < 42; i++){
      (function(cd){
        var ds = dateStr(cd);
        var cell = document.createElement("div");
        cell.className = "cal-day" + (cd.getMonth() !== m ? " other-month" : "") + (ds === todayS ? " today" : "") + (ds === calendarFilterDate ? " selected" : "");
        cell.textContent = cd.getDate();

        var dueTasks = tasks.filter(function(t){ return t.status !== "done" && isTaskDueOnDate(t, cd); });
        if(dueTasks.length){
          var hasHigh = dueTasks.some(function(t){ return t.priority === "high"; });
          var dot = document.createElement("div");
          dot.className = "cal-dot" + (hasHigh ? " high" : "");
          cell.appendChild(dot);
        }
        var dayMeetings = meetings.filter(function(m){ return m.date === ds; });
        if(dayMeetings.length){
          var mdot = document.createElement("div");
          mdot.className = "cal-dot meeting";
          mdot.style.marginTop = dueTasks.length ? "2px" : "3px";
          cell.appendChild(mdot);
        }

        cell.addEventListener("click", function(){
          calendarFilterDate = (calendarFilterDate === ds) ? null : ds;
          renderCalendar();
          render();
          renderAllMeetings();
        });
        grid.appendChild(cell);
      })(new Date(cellDate));
      cellDate.setDate(cellDate.getDate() + 1);
    }
  }

  function renderCalFilterNote(){
    var note = document.getElementById("calFilterNote");
    if(calendarFilterDate){
      note.style.display = "flex";
      document.getElementById("calFilterText").textContent = "Показаны задачи на " + fmtDate(calendarFilterDate);
    } else {
      note.style.display = "none";
    }
  }

  var peopleTooltip = document.getElementById("peopleTooltip");
  function showPeopleTooltip(anchorEl, names){
    peopleTooltip.innerHTML = "";
    names.forEach(function(p){
      var prow = document.createElement("div");
      prow.className = "prow";
      prow.textContent = p;
      peopleTooltip.appendChild(prow);
    });
    peopleTooltip.style.display = "block";
    var rect = anchorEl.getBoundingClientRect();
    var top = rect.bottom + 4;
    var left = Math.max(8, rect.right - peopleTooltip.offsetWidth);
    // Не даём подсказке уйти за нижний край окна — показываем её над элементом.
    if(top + peopleTooltip.offsetHeight > window.innerHeight - 8){
      top = rect.top - peopleTooltip.offsetHeight - 4;
    }
    peopleTooltip.style.top = top + "px";
    peopleTooltip.style.left = left + "px";
  }
  function hidePeopleTooltip(){
    peopleTooltip.style.display = "none";
  }

  function renderAllMeetings(){
    hidePeopleTooltip();
    var mwrap = document.getElementById("meetingsForDay");
    var sorted = meetings.slice().sort(function(a,b){
      var ak = (a.date||"") + " " + (a.time||"");
      var bk = (b.date||"") + " " + (b.time||"");
      return ak < bk ? -1 : (ak > bk ? 1 : 0);
    });
    document.getElementById("countMeetings").textContent = sorted.length;
    mwrap.innerHTML = "";
    if(sorted.length === 0){
      var e = document.createElement("div"); e.className = "empty"; e.textContent = "Встреч пока нет";
      mwrap.appendChild(e);
      return;
    }
    sorted.forEach(function(m){
      var chip = document.createElement("div");
      chip.className = "meeting-chip"
        + (m.date === calendarFilterDate ? " selected-day" : "")
        + (m.status && m.status !== "planned" ? " resolved" : "");
      var left = document.createElement("div");
      left.style.display = "flex"; left.style.minWidth = "0"; left.style.flex = "1"; left.style.gap = "8px";
      var when = document.createElement("span"); when.className = "mwhen";
      var date = document.createElement("span"); date.className = "mdate"; date.textContent = fmtDate(m.date);
      var time = document.createElement("span"); time.className = "mtime"; time.textContent = m.time || "--:--";
      when.appendChild(date); when.appendChild(time);
      var title = document.createElement("span"); title.className = "mtitle"; title.textContent = m.title;
      left.appendChild(when); left.appendChild(title);
      if(m.status === "success"){
        var okBadge = document.createElement("span"); okBadge.className = "mstatus success"; okBadge.textContent = "✅";
        okBadge.title = "Успешно завершена";
        left.appendChild(okBadge);
      } else if(m.status === "no_result"){
        var noBadge = document.createElement("span"); noBadge.className = "mstatus no_result"; noBadge.textContent = "🚫";
        noBadge.title = m.movedToDate ? "Перенесена на " + fmtDate(m.movedToDate) : "Без результата";
        left.appendChild(noBadge);
      }

      var people = document.createElement("span");
      var cleanParticipants = sanitizeAssigneeList(m.participants);
      if(cleanParticipants.length){
        people.className = "mpeople";
        people.textContent = "👥 " + cleanParticipants.length;
        people.addEventListener("mouseenter", function(){
          showPeopleTooltip(people, cleanParticipants);
        });
        people.addEventListener("mouseleave", hidePeopleTooltip);
      }

      var del = document.createElement("button");
      del.className = "meeting-del"; del.textContent = "×"; del.title = "Удалить встречу";
      del.addEventListener("click", function(e){
        e.stopPropagation();
        if(confirm("Удалить встречу «" + m.title + "»?")){
          meetings = meetings.filter(function(x){ return x.id !== m.id; });
          persistAll(); renderCalendar(); renderAllMeetings();
        }
      });
      chip.addEventListener("click", function(){ openMeetingModal(m); });
      chip.appendChild(left);
      if(cleanParticipants.length) chip.appendChild(people);
      chip.appendChild(del);
      mwrap.appendChild(chip);
    });
  }

  document.getElementById("calPrevBtn").addEventListener("click", function(){
    calViewDate.setMonth(calViewDate.getMonth() - 1);
    renderCalendar();
  });
  document.getElementById("calNextBtn").addEventListener("click", function(){
    calViewDate.setMonth(calViewDate.getMonth() + 1);
    renderCalendar();
  });
  document.getElementById("calClearBtn").addEventListener("click", function(){
    calendarFilterDate = null;
    renderCalendar();
    render();
  });
  document.getElementById("calAddMeetingBtn").addEventListener("click", function(){
    if(!calendarFilterDate) return;
    openMeetingModal(null, calendarFilterDate);
  });
  document.getElementById("addMeetingBtn").addEventListener("click", function(){
    openMeetingModal(null, calendarFilterDate || todayStr());
  });

  // ---------- Meeting modal ----------
  var meetingOverlay = document.getElementById("meetingOverlay");
  var participantsField = document.getElementById("participantsField");
  var participantsTrigger = document.getElementById("participantsTrigger");
  var participantsDropdown = document.getElementById("participantsDropdown");

  function updateParticipantsTriggerLabel(){
    var checked = Array.prototype.slice.call(document.querySelectorAll("#mParticipants input:checked")).map(function(cb){ return cb.value; });
    if(checked.length === 0){
      participantsTrigger.textContent = "Выберите участников";
    } else if(checked.length <= 2){
      participantsTrigger.textContent = checked.join(", ");
    } else {
      participantsTrigger.textContent = checked.length + " участников: " + checked.slice(0,2).join(", ") + "…";
    }
  }
  function openParticipantsDropdown(){
    participantsDropdown.classList.add("open");
    participantsTrigger.classList.add("open");
  }
  function closeParticipantsDropdown(){
    participantsDropdown.classList.remove("open");
    participantsTrigger.classList.remove("open");
  }
  participantsTrigger.addEventListener("click", function(e){
    e.stopPropagation();
    if(participantsDropdown.classList.contains("open")) closeParticipantsDropdown();
    else openParticipantsDropdown();
  });
  document.getElementById("participantsDoneBtn").addEventListener("click", closeParticipantsDropdown);
  document.getElementById("mParticipants").addEventListener("change", updateParticipantsTriggerLabel);
  // Клик вне поля участников закрывает выпадающий список (но не саму модалку).
  document.addEventListener("click", function(e){
    if(!participantsField.contains(e.target)) closeParticipantsDropdown();
  });

  function outcomeLabel(status){
    if(status === "success") return "✅ Успешно завершена";
    if(status === "no_result") return "🚫 Без результата";
    return "";
  }

  function openMeetingModal(m, dateForNew){
    document.getElementById("meetingModalTitle").textContent = m ? "Редактировать встречу" : "Новая встреча";
    document.getElementById("meetingId").value = m ? m.id : "";
    var date = m ? m.date : dateForNew;
    document.getElementById("mDate").value = date;
    document.getElementById("mTitle").value = m ? m.title : "";
    document.getElementById("mTime").value = m ? (m.time || "10:00") : "10:00";

    var pwrap = document.getElementById("mParticipants");
    pwrap.innerHTML = "";
    var selected = sanitizeAssigneeList(m ? m.participants : []);
    sanitizeAssigneeList(assignees).forEach(function(name){
      var row = document.createElement("label");
      row.className = "participant-row";
      var cb = document.createElement("input");
      cb.type = "checkbox"; cb.value = name;
      cb.checked = selected.indexOf(name) !== -1;
      var span = document.createElement("span"); span.textContent = name;
      row.appendChild(cb); row.appendChild(span);
      pwrap.appendChild(row);
    });
    closeParticipantsDropdown();
    updateParticipantsTriggerLabel();

    // Блок "Итог встречи" имеет смысл только для уже существующей встречи.
    var outcomeField = document.getElementById("outcomeField");
    var reopenBtn = document.getElementById("reopenMeetingBtn");
    var badge = document.getElementById("outcomeBadge");
    if(m){
      outcomeField.style.display = "";
      document.getElementById("mResult").value = m.result || "";
      document.getElementById("mRescheduleDate").value = "";
      if(m.status && m.status !== "planned"){
        badge.className = "outcome-badge show " + m.status;
        badge.textContent = outcomeLabel(m.status) + (m.movedToDate ? " · перенесено на " + fmtDate(m.movedToDate) : "");
        reopenBtn.style.display = "inline-block";
      } else {
        badge.className = "outcome-badge";
        badge.textContent = "";
        reopenBtn.style.display = "none";
      }
    } else {
      outcomeField.style.display = "none";
    }

    document.getElementById("deleteMeetingBtn").style.display = m ? "inline-block" : "none";
    meetingOverlay.classList.add("open");
  }
  function closeMeetingModal(){ meetingOverlay.classList.remove("open"); closeParticipantsDropdown(); }

  document.getElementById("meetingCancelBtn").addEventListener("click", closeMeetingModal);
  meetingOverlay.addEventListener("click", function(e){ if(e.target === meetingOverlay) closeMeetingModal(); });

  // Клик в любом месте поля даты — сразу открывает календарь выбора, не нужно
  // целиться в маленькую иконку.
  var mDateInput = document.getElementById("mDate");
  mDateInput.addEventListener("click", function(){
    if(mDateInput.showPicker){
      try{ mDateInput.showPicker(); }catch(e){}
    }
  });

  function setMeetingStatus(status){
    var id = document.getElementById("meetingId").value;
    if(!id) return;
    var m = meetings.find(function(x){ return x.id === id; });
    if(!m) return;
    m.status = status;
    m.result = document.getElementById("mResult").value.trim();
    if(status === "planned") m.movedToDate = "";
    persistAll();
    closeMeetingModal();
    renderCalendar();
    renderAllMeetings();
  }
  document.getElementById("markSuccessBtn").addEventListener("click", function(){ setMeetingStatus("success"); });
  document.getElementById("markNoResultBtn").addEventListener("click", function(){ setMeetingStatus("no_result"); });
  document.getElementById("reopenMeetingBtn").addEventListener("click", function(){ setMeetingStatus("planned"); });

  // "Перенести следующий этап на дату" — создаёт новую встречу (тот же состав
  // и название) на выбранную дату, а текущую помечает как перенесённую.
  document.getElementById("rescheduleBtn").addEventListener("click", function(){
    var id = document.getElementById("meetingId").value;
    if(!id) return;
    var m = meetings.find(function(x){ return x.id === id; });
    if(!m) return;
    var newDate = document.getElementById("mRescheduleDate").value;
    if(!newDate){ alert("Укажите дату следующего этапа"); return; }

    var followUp = {
      id: uid(),
      date: newDate,
      time: m.time || "",
      title: m.title,
      participants: m.participants.slice(),
      status: "planned",
      result: "",
      movedToDate: ""
    };
    meetings.push(followUp);

    m.status = "no_result";
    m.result = document.getElementById("mResult").value.trim() || "Перенесено на следующий этап";
    m.movedToDate = newDate;

    persistAll();
    closeMeetingModal();
    renderCalendar();
    renderAllMeetings();
  });

  document.getElementById("meetingSaveBtn").addEventListener("click", function(){
    var title = document.getElementById("mTitle").value.trim();
    if(!title){ alert("Укажите название встречи"); return; }
    var date = document.getElementById("mDate").value;
    if(!date){ alert("Укажите дату встречи"); return; }
    var id = document.getElementById("meetingId").value || uid();
    var participants = sanitizeAssigneeList(Array.prototype.slice.call(document.querySelectorAll("#mParticipants input:checked")).map(function(cb){ return cb.value; }));
    var existing = meetings.find(function(x){ return x.id === id; });

    var meeting = {
      id: id,
      date: date,
      time: document.getElementById("mTime").value || "",
      title: title,
      participants: participants,
      status: existing ? existing.status : "planned",
      result: existing ? document.getElementById("mResult").value.trim() : "",
      movedToDate: existing ? existing.movedToDate : ""
    };
    var idx = meetings.findIndex(function(x){ return x.id === id; });
    if(idx === -1) meetings.push(meeting); else meetings[idx] = meeting;

    persistAll();
    closeMeetingModal();
    renderCalendar();
    renderCalFilterNote();
    renderAllMeetings();
  });

  document.getElementById("deleteMeetingBtn").addEventListener("click", function(){
    var id = document.getElementById("meetingId").value;
    if(!id) return;
    if(confirm("Удалить эту встречу?")){
      meetings = meetings.filter(function(x){ return x.id !== id; });
      persistAll();
      closeMeetingModal();
      renderCalendar();
      renderCalFilterNote();
      renderAllMeetings();
    }
  });

  // ---------- Modal ----------
  var overlay = document.getElementById("overlay");

  function resetForm(){
    document.getElementById("taskId").value = "";
    document.getElementById("fTitle").value = "";
    document.getElementById("fDesc").value = "";
    document.getElementById("fPriority").value = "med";
    document.getElementById("fTerm").value = "short";
    document.getElementById("fDeadline").value = "";
    document.getElementById("fRecur").value = "none";
    document.getElementById("fRecurMonthday").value = "";
    document.getElementById("fRecurYearDay").value = "";
    updateRecurVisibility();
    document.getElementById("deleteTaskBtn").style.display = "none";
    document.getElementById("stopRecurRow").classList.remove("show");
    document.getElementById("modalTitle").textContent = "Новая задача";
  }

  document.getElementById("addAssigneeBtn").addEventListener("click", function(){
    var v = prompt("Имя нового исполнителя:");
    if(v){
      v = v.trim();
      if(v && assignees.indexOf(v) === -1){ assignees.push(v); persistAll(); }
      refreshSelectsGlobal();
      document.getElementById("fAssignee").value = v;
    }
  });

  document.getElementById("removeAssigneeBtn").addEventListener("click", function(){
    var sel = document.getElementById("fAssignee");
    var v = sel.value;
    if(!v) return;
    if(confirm("Удалить исполнителя «" + v + "» из списка? Уже созданные задачи сохранят его имя, но выбрать его для новых задач будет нельзя.")){
      assignees = assignees.filter(function(a){ return a !== v; });
      persistAll();
      refreshSelectsGlobal();
    }
  });

  function updateRecurVisibility(){
    var v = document.getElementById("fRecur").value;
    document.getElementById("recurWeekly").className = "recur-config" + (v === "weekly" ? " open" : "");
    document.getElementById("recurMonthly").className = "recur-config" + (v === "monthly" ? " open" : "");
    document.getElementById("recurYearly").className = "recur-config" + (v === "yearly" ? " open" : "");
    var stopRow = document.getElementById("stopRecurRow");
    var editingId = document.getElementById("taskId").value;
    if(editingId && v !== "none"){ stopRow.classList.add("show"); }
    else{ stopRow.classList.remove("show"); }
  }
  document.getElementById("fRecur").addEventListener("change", updateRecurVisibility);

  document.getElementById("stopRecurBtn").addEventListener("click", function(){
    var id = document.getElementById("taskId").value;
    if(!id) return;
    if(!confirm("Прекратить повторение этой задачи? Она останется как обычная разовая задача с текущим статусом.")) return;
    var t = tasks.find(function(x){ return x.id === id; });
    if(t){
      t.recur = "none";
      t.recurWeekday = "1"; t.recurMonthday = ""; t.recurYearDay = ""; t.recurYearMonth = "1";
      persistAll();
    }
    document.getElementById("fRecur").value = "none";
    updateRecurVisibility();
    render();
  });

  function openModal(taskId){
    refreshSelectsGlobal();
    if(taskId){
      var t = tasks.find(function(x){ return x.id === taskId; });
      if(!t) return;
      var fAssigneeSel = document.getElementById("fAssignee");
      if(t.assignee){
        var found = Array.prototype.some.call(fAssigneeSel.options, function(o){ return o.value === t.assignee; });
        if(!found){
          var opt = document.createElement("option");
          opt.value = t.assignee; opt.textContent = t.assignee + " (удалён из списка)";
          fAssigneeSel.appendChild(opt);
        }
      }
      document.getElementById("modalTitle").textContent = "Редактировать задачу";
      document.getElementById("taskId").value = t.id;
      document.getElementById("fTitle").value = t.title;
      document.getElementById("fDesc").value = t.desc || "";
      document.getElementById("fAssignee").value = t.assignee;
      document.getElementById("fPriority").value = t.priority;
      document.getElementById("fTerm").value = t.term;
      document.getElementById("fDeadline").value = t.deadline || "";
      document.getElementById("fRecur").value = t.recur || "none";
      document.getElementById("fRecurWeekday").value = t.recurWeekday || "1";
      document.getElementById("fRecurMonthday").value = t.recurMonthday || "";
      document.getElementById("fRecurYearDay").value = t.recurYearDay || "";
      document.getElementById("fRecurYearMonth").value = t.recurYearMonth || "1";
      updateRecurVisibility();
      document.getElementById("deleteTaskBtn").style.display = "inline-block";
    } else {
      resetForm();
    }
    overlay.classList.add("open");
  }
  function closeModal(){ overlay.classList.remove("open"); }

  document.getElementById("newTaskBtn").addEventListener("click", function(){ openModal(null); });
  document.getElementById("cancelBtn").addEventListener("click", closeModal);
  overlay.addEventListener("click", function(e){ if(e.target === overlay) closeModal(); });

  document.getElementById("saveTaskBtn").addEventListener("click", function(){
    var title = document.getElementById("fTitle").value.trim();
    if(!title){ alert("Укажите название задачи"); return; }
    var id = document.getElementById("taskId").value || uid();
    var existing = tasks.find(function(x){ return x.id === id; });

    var task = {
      id: id,
      title: title,
      desc: document.getElementById("fDesc").value.trim(),
      assignee: document.getElementById("fAssignee").value,
      priority: document.getElementById("fPriority").value,
      term: document.getElementById("fTerm").value,
      status: existing ? existing.status : "in_progress",
      deadline: document.getElementById("fDeadline").value,
      recur: document.getElementById("fRecur").value,
      recurWeekday: document.getElementById("fRecurWeekday").value,
      recurMonthday: document.getElementById("fRecurMonthday").value,
      recurYearDay: document.getElementById("fRecurYearDay").value,
      recurYearMonth: document.getElementById("fRecurYearMonth").value,
      lastCompletedOn: existing ? (existing.lastCompletedOn || "") : ""
    };

    var idx = tasks.findIndex(function(x){ return x.id === id; });
    if(idx === -1) tasks.push(task); else tasks[idx] = task;

    persistAll();
    closeModal();
    render();
  });

  document.getElementById("deleteTaskBtn").addEventListener("click", function(){
    var id = document.getElementById("taskId").value;
    if(!id) return;
    if(confirm("Удалить эту задачу?")){
      tasks = tasks.filter(function(x){ return x.id !== id; });
      persistAll();
      closeModal();
      render();
    }
  });

  // ---------- Filters ----------
  ["filterAssignee","filterPriority","searchInput","showDoneCheckbox"].forEach(function(id){
    document.getElementById(id).addEventListener("input", render);
    document.getElementById(id).addEventListener("change", render);
  });
  document.getElementById("showDoneCheckbox").addEventListener("change", renderIdeas);

  // ---------- Notifications ----------
  var toastStack = document.getElementById("toast-stack");
  function showToast(title, body){
    var el = document.createElement("div");
    el.className = "toast";
    var closeBtn = document.createElement("span");
    closeBtn.className = "close"; closeBtn.textContent = "×";
    var b = document.createElement("b"); b.textContent = title;
    el.appendChild(closeBtn);
    el.appendChild(b);
    el.appendChild(document.createTextNode(body));
    closeBtn.addEventListener("click", function(){ el.remove(); });
    toastStack.appendChild(el);
    setTimeout(function(){ if(el.parentNode) el.remove(); }, 15000);
  }

  function browserNotify(title, body){
    if(window.Notification && Notification.permission === "granted"){
      try{ new Notification(title, { body: body }); }catch(e){}
    }
  }

  var notifPermBtn = document.getElementById("notifPermBtn");
  function refreshPermBtn(){
    if(!window.Notification){ notifPermBtn.style.display = "none"; return; }
    if(Notification.permission === "granted"){
      notifPermBtn.textContent = "🔔 Уведомления включены";
    } else {
      notifPermBtn.textContent = "🔔 Включить уведомления";
    }
  }
  notifPermBtn.addEventListener("click", function(){
    if(window.Notification && Notification.permission !== "granted"){
      Notification.requestPermission().then(function(){
        refreshPermBtn();
        // Разрешение только что выдали — сразу дошлём нативные пуши по всему,
        // что уже "на сегодня", но раньше не долетело как нативное (см. пометки ниже).
        checkDueTasks();
        checkMeetingReminders();
      });
    }
  });
  refreshPermBtn();

  // ВАЖНО про пометки "уже уведомили": раньше toast и нативный пуш отмечались
  // ОДНИМ и тем же ключом. Если пуш ещё не был разрешён в момент срабатывания —
  // toast показывался, ключ помечался как "использован", и после включения
  // уведомлений нативный пуш по этой же задаче/встрече уже никогда не приходил
  // (до следующего дня). Поэтому toast и нативный пуш теперь помечаются
  // отдельными ключами — можно разрешить уведомления в любой момент, и по всему,
  // что ещё актуально сегодня, придёт нативный пуш.
  function checkDueTasks(){
    refreshRecurringStatuses();

    var today = todayStr();
    var overdueCount = 0;
    var dueTodayItems = [];

    tasks.forEach(function(t){
      if(t.status === "done") return;
      var due = false, label = "";
      if(t.recur === "none"){
        if(t.deadline === today){ due = true; label = t.title; }
        if(isOverdue(t)) overdueCount++;
      } else if(isDueToday(t)){
        due = true; label = t.title + " (повторяющаяся)";
      }
      if(due){
        dueTodayItems.push(t);
        var toastKey = "toast_" + t.id + "_" + today;
        var nativeKey = "native_" + t.id + "_" + today;
        if(!notified[toastKey]){
          notified[toastKey] = true;
          showToast("Задача на сегодня", label + (t.assignee ? " — " + t.assignee : ""));
        }
        if(!notified[nativeKey]){
          browserNotify("Задача на сегодня: " + t.title, t.assignee ? t.assignee : "");
          if(window.Notification && Notification.permission === "granted"){
            notified[nativeKey] = true;
          }
        }
      }
    });

    var banner = document.getElementById("notifBanner");
    if(overdueCount > 0 || dueTodayItems.length > 0){
      var parts = [];
      if(overdueCount > 0) parts.push(overdueCount + " просроченных");
      if(dueTodayItems.length > 0) parts.push(dueTodayItems.length + " на сегодня");
      banner.textContent = "⚠ " + parts.join(", ") + " — проверьте список задач.";
      banner.classList.add("show");
    } else {
      banner.classList.remove("show");
    }
    persistAll();
    render();
  }

  // ---------- Meeting reminders ----------
  function minutesNow(){
    var d = new Date();
    return d.getHours()*60 + d.getMinutes();
  }
  function timeToMinutes(hhmm){
    if(!hhmm) return null;
    var p = hhmm.split(":");
    return Number(p[0])*60 + Number(p[1]);
  }
  function checkMeetingReminders(){
    var today = todayStr();
    var now = minutesNow();
    meetings.forEach(function(m){
      if(m.date !== today || !m.time) return;
      var mMin = timeToMinutes(m.time);
      if(mMin === null) return;
      var who = m.participants && m.participants.length ? (" · " + m.participants.join(", ")) : "";

      // за 15 минут до начала
      if(now >= mMin - 15 && now < mMin){
        fireOnce("toast_meet15_" + m.id + "_" + today, function(){
          showToast("Встреча через 15 минут", m.time + " — " + m.title + who);
        });
        fireOnce("native_meet15_" + m.id + "_" + today, function(){
          browserNotify("Через 15 минут: " + m.title, m.time + who);
        }, true);
      }
      // в момент начала (и в пределах ближайшей минуты после)
      if(now >= mMin && now <= mMin + 1){
        fireOnce("toast_meet0_" + m.id + "_" + today, function(){
          showToast("Встреча начинается", m.time + " — " + m.title + who);
        });
        fireOnce("native_meet0_" + m.id + "_" + today, function(){
          browserNotify("Встреча сейчас: " + m.title, m.time + who);
        }, true);
      }
    });
    persistAll();
  }
  // Выполняет fn один раз для данного ключа. Если requireGranted=true — засчитывает
  // ключ как "выполнено" только когда разрешение реально выдано (та же логика,
  // что и в checkDueTasks, чтобы будущее включение уведомлений не "съело" пуш).
  function fireOnce(key, fn, requireGranted){
    if(notified[key]) return;
    fn();
    if(!requireGranted || (window.Notification && Notification.permission === "granted")){
      notified[key] = true;
    }
  }

  // ---------- Clock ----------
  function updateClock(){
    var d = new Date();
    var days = ["воскресенье","понедельник","вторник","среда","четверг","пятница","суббота"];
    document.getElementById("dateNow").textContent =
      pad(d.getDate()) + "." + pad(d.getMonth()+1) + "." + d.getFullYear() + ", " + days[d.getDay()] + " · " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  // ---------- Hotkey: N — новая задача (по физической клавише, не зависит от раскладки) ----------
  document.addEventListener("keydown", function(e){
    if(e.code !== "KeyN") return;
    if(e.ctrlKey || e.metaKey || e.altKey) return;
    var tag = (document.activeElement && document.activeElement.tagName || "").toLowerCase();
    if(tag === "input" || tag === "textarea" || tag === "select") return;
    if(document.activeElement && document.activeElement.isContentEditable) return;
    if(overlay.classList.contains("open")) return;
    e.preventDefault();
    openModal(null);
  });

  // ---------- Init ----------
  // window.supabase is created by a React bootstrap component that runs
  // independently of this script tag; poll briefly rather than assume
  // load order between the two.
  function waitForSupabaseClient(){
    return new Promise(function(resolve){
      (function poll(){
        if(window.supabase) resolve(window.supabase);
        else setTimeout(poll, 20);
      })();
    });
  }

  function showLoadError(message){
    document.body.insertAdjacentHTML("afterbegin",
      '<div style="padding:16px;background:#4A2E28;color:#E07A5F;font-family:sans-serif;">' +
      'Не удалось загрузить данные из облака: ' + message + '. Обновите страницу или проверьте интернет.</div>');
  }

  async function boot(){
    db = await waitForSupabaseClient();

    var authRes = await db.auth.getSession();
    if(!authRes.data.session){
      window.location.href = "/login";
      return;
    }

    var signOutBtn = document.getElementById("signOutBtn");
    if(signOutBtn){
      signOutBtn.addEventListener("click", function(){
        db.auth.signOut().then(function(){ window.location.href = "/login"; });
      });
    }

    var results;
    try{
      results = await Promise.all([
        db.from("tasks").select("*"),
        db.from("meetings").select("*"),
        db.from("ideas").select("*").order("created_at", { ascending: true }),
        db.from("assignees").select("*").order("created_at", { ascending: true })
      ]);
    }catch(e){
      showLoadError(e && e.message || String(e));
      return;
    }
    var failed = results.find(function(r){ return r.error; });
    if(failed){
      console.error("Supabase load error:", failed.error);
      showLoadError(failed.error.message || "");
      return;
    }

    tasks = results[0].data.map(taskFromRow);
    meetings = results[1].data.map(meetingFromRow);
    ideas = results[2].data.map(ideaFromRow);
    assignees = sanitizeAssigneeList(results[3].data.map(function(r){ return r.name; }));

    // Baseline "already in the database" snapshot — taken before any of the
    // startup reconciliation below, so persistAll() only pushes what's new.
    shadow = { tasks: tasks.slice(), meetings: meetings.slice(), ideas: ideas.slice(), assignees: assignees.slice() };

    if(assignees.length === 0){
      assignees = DEFAULT_ASSIGNEES.slice();
    }
    tasks.forEach(function(t){
      if(t.assignee && assignees.indexOf(t.assignee) === -1) assignees.push(t.assignee);
    });
    persistAll();

    refreshSelectsGlobal();
    refreshRecurringStatuses();
    updateLayoutColumns();
    renderIdeas();
    renderCalendar();
    renderAllMeetings();
    render();
    updateClock();
    checkDueTasks();
    checkMeetingReminders();
    setInterval(updateClock, 30000);
    setInterval(checkDueTasks, 60000);
    setInterval(checkMeetingReminders, 60000);
  }

  boot();

})();
