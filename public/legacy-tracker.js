(function(){
  "use strict";

  // ---------- Install prompt (PWA) ----------
  // Registered at top level, before boot()'s async data load, so we don't
  // miss the event if Chrome fires it early. installAppBtn is part of the
  // static markup, already in the DOM by the time this script runs.
  var deferredInstallPrompt = null;
  var installAppBtn = document.getElementById("installAppBtn");
  window.addEventListener("beforeinstallprompt", function(e){
    e.preventDefault();
    deferredInstallPrompt = e;
    if(installAppBtn) installAppBtn.style.display = "inline-block";
  });
  window.addEventListener("appinstalled", function(){
    if(installAppBtn) installAppBtn.style.display = "none";
    deferredInstallPrompt = null;
  });
  if(installAppBtn){
    installAppBtn.addEventListener("click", function(){
      if(!deferredInstallPrompt) return;
      deferredInstallPrompt.prompt();
      deferredInstallPrompt.userChoice.then(function(){
        deferredInstallPrompt = null;
        installAppBtn.style.display = "none";
      });
    });
  }

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
  var sections = [];
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
  var shadow = { tasks: [], meetings: [], ideas: [], assignees: [], sections: [] };
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
      last_completed_on: t.lastCompletedOn || null,
      section_id: t.sectionId || null,
      manual_order: (t.manualOrder != null && t.manualOrder !== "") ? Number(t.manualOrder) : null
      // deleted_at is deliberately NOT part of this row — an ordinary
      // upsert (edit, drag reorder, a stale tab resyncing) must never touch
      // it, or it would silently resurrect a row someone else deleted in
      // the meantime. Delete/undo go through softDeleteRow()/restoreRow()
      // instead, which touch only that one column.
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
      lastCompletedOn: r.last_completed_on || "",
      sectionId: r.section_id || "",
      manualOrder: r.manual_order != null ? r.manual_order : null
    };
  }

  function sectionToRow(s){
    return { id: s.id, name: s.name, kind: s.kind || "work", sort_order: s.sortOrder || 0 };
  }
  function sectionFromRow(r){
    return { id: r.id, name: r.name, kind: r.kind || "work", sortOrder: r.sort_order || 0 };
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

  // Snapshots a list for `shadow` as independent copies of each item, not
  // just a new array of the SAME object references. Root cause of a real
  // "edits silently never reach the database" bug: most in-place edits
  // (the done checkbox, a meeting outcome button, the daily recurring-task
  // reset) do `t.status = "done"` on the exact object already sitting in
  // both `tasks` and `shadow.tasks` — `tasks.slice()`/`tasksNow` only copies
  // the ARRAY, so shadow held the same objects, not a frozen snapshot. That
  // mutation was then visible through shadow's reference too, so the next
  // persistAll() diffed a task against an "old" snapshot that had quietly
  // already changed to match it — sameJson() said "no difference", no
  // upsert was ever sent, and the edit was never persisted at all (not a
  // timing race — permanently, silently dropped). Reloading later shows
  // whatever was last actually written, i.e. the change looks "undone".
  function snapshotList(list){
    return list.map(function(x){ return JSON.parse(JSON.stringify(x)); });
  }

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

  var syncPendingCount = 0;
  var syncStatusHideTimer = null;
  function setSyncStatus(text, autoHide){
    var el = document.getElementById("syncStatus");
    if(!el) return;
    clearTimeout(syncStatusHideTimer);
    el.textContent = text;
    el.classList.add("show");
    if(autoHide){
      syncStatusHideTimer = setTimeout(function(){ el.classList.remove("show"); }, 2000);
    }
  }

  function persistAll(){
    save(LS_NOTIFIED, notified);
    if(!db) return;

    var tasksNow = tasks.slice();
    var meetingsNow = meetings.slice();
    var ideasNow = ideas.slice();
    var assigneesNow = assignees.slice();
    var sectionsNow = sections.slice();

    syncPendingCount++;
    setSyncStatus("Сохраняю…", false);
    var hadError = false;

    syncChain = syncChain
      .then(function(){ return diffAndSync("sections", sectionsNow, shadow.sections, sectionToRow); })
      .then(function(){ shadow.sections = snapshotList(sectionsNow); })
      .then(function(){ return diffAndSync("tasks", tasksNow, shadow.tasks, taskToRow); })
      .then(function(){ shadow.tasks = snapshotList(tasksNow); })
      .then(function(){ return diffAndSync("meetings", meetingsNow, shadow.meetings, meetingToRow); })
      .then(function(){ shadow.meetings = snapshotList(meetingsNow); })
      .then(function(){ return diffAndSync("ideas", ideasNow, shadow.ideas, ideaToRow); })
      .then(function(){ shadow.ideas = snapshotList(ideasNow); })
      .then(function(){ return diffAndSyncAssignees(assigneesNow, shadow.assignees); })
      .then(function(){ shadow.assignees = assigneesNow; })
      .catch(function(err){
        hadError = true;
        console.error("Supabase sync error:", err);
        showToast("Не сохранилось в облако", (err && err.message) || "Проверьте интернет-соединение");
        // Best-effort durable record — a toast disappears with the tab, this
        // survives so a later session can surface "you had a sync failure".
        try{
          db.from("sync_errors").insert({ message: (err && err.message) || String(err) });
        }catch(e){}
      })
      .then(function(){
        syncPendingCount--;
        if(syncPendingCount <= 0) syncPendingCount = 0;
        setSyncStatus(hadError ? "⚠ Ошибка сохранения" : "✓ Сохранено", true);
      });
  }

  // Safety net for the general case the signOutBtn fix above doesn't cover —
  // closing the tab, hitting browser-back, or reloading while a write from
  // persistAll()/softDeleteRow()/restoreRow()/savePanelLayout() is still in
  // flight. Can't await anything here (beforeunload can't block on a
  // promise), but showing the browser's native "leave site?" prompt gives
  // the user a chance to cancel and let the save finish instead of losing
  // it silently.
  window.addEventListener("beforeunload", function(e){
    if(syncPendingCount > 0){
      e.preventDefault();
      e.returnValue = "";
    }
  });

  // Soft delete (spec-audit recommendation #4): marks the row instead of
  // physically removing it, so it stays recoverable indefinitely rather
  // than only within a 6-second undo-toast window. Deliberately bypasses
  // the diffAndSync()/shadow mechanism above — that path treats "missing
  // from the current array" as "hard delete", which is exactly what this
  // needs to NOT do. Callers remove the item from both the live array and
  // `shadow` themselves so it isn't re-synced as a delete afterward.
  //
  // Chained onto syncChain (same queue persistAll() uses) and counted via
  // syncPendingCount instead of firing as an untracked, independent
  // promise: previously this call was fire-and-forget, so clicking "Выйти"
  // right after deleting/completing something could navigate away (killing
  // the in-flight request — browsers abort pending fetches on unload)
  // before it ever reached Supabase. Next login then loaded the old,
  // never-deleted row back — the exact "closed items came back" bug.
  // Routing every write through syncChain lets signOutBtn's handler (and
  // beforeunload) wait for the same queue persistAll() already waits on.
  function softDeleteRow(table, id){
    if(!db) return;
    syncPendingCount++;
    setSyncStatus("Сохраняю…", false);
    syncChain = syncChain.then(function(){
      return db.from(table).update({ deleted_at: new Date().toISOString() }).eq("id", id);
    }).then(function(res){
      if(res.error){
        console.error("Soft delete error:", res.error);
        showToast("Не удалось удалить", res.error.message);
      }
    }).catch(function(err){
      console.error("Soft delete error:", err);
      showToast("Не удалось удалить", (err && err.message) || String(err));
    }).then(function(){
      syncPendingCount = Math.max(0, syncPendingCount - 1);
      setSyncStatus(syncPendingCount ? "Сохраняю…" : "✓ Сохранено", syncPendingCount === 0);
    });
  }
  // Explicit counterpart to softDeleteRow(), used only by "Отменить" undo
  // buttons. persistAll()'s upsert never touches deleted_at (see toRow()
  // comments above), so clearing it back to null has to be its own call.
  // Same syncChain/syncPendingCount tracking as softDeleteRow(), and for
  // the same reason.
  function restoreRow(table, id){
    if(!db) return;
    syncPendingCount++;
    setSyncStatus("Сохраняю…", false);
    syncChain = syncChain.then(function(){
      return db.from(table).update({ deleted_at: null }).eq("id", id);
    }).then(function(res){
      if(res.error) console.error("Restore error:", res.error);
    }).catch(function(err){
      console.error("Restore error:", err);
    }).then(function(){
      syncPendingCount = Math.max(0, syncPendingCount - 1);
      setSyncStatus(syncPendingCount ? "Сохраняю…" : "✓ Сохранено", syncPendingCount === 0);
    });
  }

  // ---------- Realtime: pick up changes made from another tab/device ----------
  // Supabase pushes row changes over a websocket; we merge them into the
  // same in-memory arrays + shadow snapshot that persistAll() diffs against,
  // then re-render. Debounced so a burst of changes (e.g. a bulk edit
  // elsewhere) doesn't thrash the DOM with one redraw per row.
  function upsertById(list, item){
    var idx = list.findIndex(function(x){ return x.id === item.id; });
    if(idx === -1) list.push(item); else list[idx] = item;
  }
  function removeById(list, id){
    var idx = list.findIndex(function(x){ return x.id === id; });
    if(idx !== -1) list.splice(idx, 1);
  }
  function debounce(fn, ms){
    var t = null;
    return function(){ clearTimeout(t); t = setTimeout(fn, ms); };
  }
  var scheduleTasksRerender = debounce(function(){ render(); renderCalendar(); }, 150);
  var scheduleMeetingsRerender = debounce(function(){ renderCalendar(); renderAllMeetings(); }, 150);
  var scheduleIdeasRerender = debounce(function(){
    // A full renderIdeas() replaces the DOM, which would blow away an
    // in-progress inline edit — skip for now, the edit's own save/cancel
    // handler calls renderIdeas() anyway and will pick up this data then.
    if(document.querySelector(".idea-edit-input")) return;
    renderIdeas();
  }, 150);
  var scheduleAssigneesRerender = debounce(function(){ refreshSelectsGlobal(); }, 150);
  var scheduleSectionsRerender = debounce(function(){ refreshSelectsGlobal(); render(); }, 150);

  function setupRealtime(userId){
    var filter = "user_id=eq." + userId;
    db.channel("tracker-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks", filter: filter }, function(payload){
        try{
          // A soft delete arrives here as an UPDATE (deleted_at now set),
          // not a DELETE — treat it the same as one, or it would silently
          // resurrect on every other open tab/device.
          if(payload.eventType === "DELETE" || payload.new.deleted_at){
            removeById(tasks, payload.old ? payload.old.id : payload.new.id);
            removeById(shadow.tasks, payload.old ? payload.old.id : payload.new.id);
          } else {
            var t = taskFromRow(payload.new);
            upsertById(tasks, t);
            // A clone, not the same object `t` — see snapshotList()'s
            // comment above persistAll(): sharing this reference with
            // `tasks` would let a later in-place edit (the done checkbox
            // etc.) silently "pre-sync" shadow through the shared object,
            // so persistAll() would see no diff and never push the edit.
            upsertById(shadow.tasks, JSON.parse(JSON.stringify(t)));
          }
          scheduleTasksRerender();
        }catch(e){ console.error("Realtime tasks error:", e); }
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "meetings", filter: filter }, function(payload){
        try{
          if(payload.eventType === "DELETE" || payload.new.deleted_at){
            removeById(meetings, payload.old ? payload.old.id : payload.new.id);
            removeById(shadow.meetings, payload.old ? payload.old.id : payload.new.id);
          } else {
            var m = meetingFromRow(payload.new);
            upsertById(meetings, m);
            upsertById(shadow.meetings, JSON.parse(JSON.stringify(m)));
          }
          scheduleMeetingsRerender();
        }catch(e){ console.error("Realtime meetings error:", e); }
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "ideas", filter: filter }, function(payload){
        try{
          if(payload.eventType === "DELETE" || payload.new.deleted_at){
            removeById(ideas, payload.old ? payload.old.id : payload.new.id);
            removeById(shadow.ideas, payload.old ? payload.old.id : payload.new.id);
          } else {
            var i = ideaFromRow(payload.new);
            upsertById(ideas, i);
            upsertById(shadow.ideas, JSON.parse(JSON.stringify(i)));
          }
          scheduleIdeasRerender();
        }catch(e){ console.error("Realtime ideas error:", e); }
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "assignees", filter: filter }, function(payload){
        try{
          if(payload.eventType === "DELETE"){
            var name = payload.old.name;
            var idx = assignees.indexOf(name);
            if(idx !== -1) assignees.splice(idx, 1);
            var sidx = shadow.assignees.indexOf(name);
            if(sidx !== -1) shadow.assignees.splice(sidx, 1);
          } else {
            var newName = payload.new.name;
            if(assignees.indexOf(newName) === -1) assignees.push(newName);
            if(shadow.assignees.indexOf(newName) === -1) shadow.assignees.push(newName);
          }
          scheduleAssigneesRerender();
        }catch(e){ console.error("Realtime assignees error:", e); }
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "sections", filter: filter }, function(payload){
        try{
          if(payload.eventType === "DELETE"){
            removeById(sections, payload.old.id);
            removeById(shadow.sections, payload.old.id);
          } else {
            var s = sectionFromRow(payload.new);
            upsertById(sections, s);
            upsertById(shadow.sections, s);
          }
          scheduleSectionsRerender();
        }catch(e){ console.error("Realtime sections error:", e); }
      })
      .subscribe();
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
  // Adds n days to a YYYY-MM-DD string, built from local calendar fields
  // (not UTC) so it doesn't drift near month/DST boundaries.
  function addDaysIso(iso, n){
    var p = iso.split("-").map(Number);
    return dateStr(new Date(p[0], p[1]-1, p[2]+n));
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

  // ---------- Task drag-and-drop: move between short/long, freely reorder ----------
  // A brief highlight on a just-created/just-converted card so the result of
  // a drag is obvious, not just a silent DOM update.
  function flashNewItem(id){
    var el = document.querySelector('[data-id="' + id + '"]');
    if(!el) return;
    el.classList.add("just-created");
    setTimeout(function(){ el.classList.remove("just-created"); }, 1200);
  }
  function getDragAfterElement(container, y){
    var els = Array.prototype.slice.call(container.querySelectorAll(".task:not(.dragging)"));
    var closest = { offset: -Infinity, element: null };
    els.forEach(function(child){
      var box = child.getBoundingClientRect();
      var offset = y - box.top - box.height / 2;
      if(offset < 0 && offset > closest.offset) closest = { offset: offset, element: child };
    });
    return closest.element;
  }
  // Assigns sequential manual_order values matching the given visual
  // order — once any task in a column has been dragged, sortFn() (below)
  // makes that column's order fully explicit instead of automatic.
  function reorderColumn(orderedIds){
    orderedIds.forEach(function(id, i){
      var t = tasks.find(function(x){ return x.id === id; });
      if(t) t.manualOrder = i;
    });
  }
  // Draws a thin insertion line showing exactly where the card will land —
  // recomputed on every dragover, not just shown as a generic "you're over
  // the column" outline.
  function updateDropIndicator(container, after){
    Array.prototype.slice.call(container.querySelectorAll(".drag-indicator")).forEach(function(el){
      el.classList.remove("drag-indicator");
    });
    container.classList.remove("drag-indicator-end");
    if(after) after.classList.add("drag-indicator");
    else container.classList.add("drag-indicator-end");
  }
  function clearDropIndicator(container){
    Array.prototype.slice.call(container.querySelectorAll(".drag-indicator")).forEach(function(el){
      el.classList.remove("drag-indicator");
    });
    container.classList.remove("drag-indicator-end");
  }
  function setupTaskDragDrop(container, term){
    container.addEventListener("dragover", function(e){
      if(!e.dataTransfer.types.includes("application/x-task-id")) return;
      e.preventDefault();
      container.classList.add("drag-over");
      updateDropIndicator(container, getDragAfterElement(container, e.clientY));
    });
    // e.target is whatever element the pointer is over, which is usually a
    // child card, not the container itself — checking relatedTarget (where
    // the pointer is headed) instead of target is what makes this fire only
    // when the drag genuinely leaves the container, not on every child edge.
    container.addEventListener("dragleave", function(e){
      if(!container.contains(e.relatedTarget)){
        container.classList.remove("drag-over");
        clearDropIndicator(container);
      }
    });
    container.addEventListener("drop", function(e){
      var id = e.dataTransfer.getData("application/x-task-id");
      if(!id) return;
      e.preventDefault();
      container.classList.remove("drag-over");
      clearDropIndicator(container);
      var dragged = tasks.find(function(x){ return x.id === id; });
      if(!dragged) return;

      var after = getDragAfterElement(container, e.clientY);
      var siblingIds = Array.prototype.slice.call(container.children)
        .filter(function(el){ return el.classList.contains("task") && el.dataset.id !== id; })
        .map(function(el){ return el.dataset.id; });
      var insertAt = after ? siblingIds.indexOf(after.dataset.id) : -1;
      if(insertAt === -1) insertAt = siblingIds.length;
      siblingIds.splice(insertAt, 0, id);

      dragged.term = term;
      reorderColumn(siblingIds);
      persistAll();
      render();
    });
  }
  setupTaskDragDrop(elListShort, "short");
  setupTaskDragDrop(elListLong, "long");

  // ---------- Idea -> task/meeting: drag an idea card onto a column or the
  // meetings panel to convert it, instead of retyping it there by hand.
  function convertIdeaToTask(ideaId, term){
    var idx = ideas.findIndex(function(i){ return i.id === ideaId; });
    if(idx === -1) return;
    var idea = ideas[idx];
    ideas = ideas.filter(function(i){ return i.id !== ideaId; });
    shadow.ideas = shadow.ideas.filter(function(i){ return i.id !== ideaId; });
    softDeleteRow("ideas", ideaId);

    var task = {
      id: uid(), title: idea.text, desc: "", assignee: "", sectionId: "",
      priority: idea.important ? "high" : "med", term: term, status: "in_progress",
      deadline: "", recur: "none", recurWeekday: "1", recurMonthday: "",
      recurYearDay: "", recurYearMonth: "1", lastCompletedOn: "", manualOrder: null
    };
    tasks.push(task);
    persistAll();
    renderIdeas();
    render();
    flashNewItem(task.id);

    showToast("Идея превращена в задачу", task.title, function(){
      tasks = tasks.filter(function(x){ return x.id !== task.id; });
      shadow.tasks = shadow.tasks.filter(function(x){ return x.id !== task.id; });
      softDeleteRow("tasks", task.id);
      ideas.splice(Math.min(idx, ideas.length), 0, idea);
      restoreRow("ideas", idea.id);
      persistAll();
      renderIdeas(); render();
    });
  }

  function convertIdeaToMeeting(ideaId){
    var idx = ideas.findIndex(function(i){ return i.id === ideaId; });
    if(idx === -1) return;
    var idea = ideas[idx];
    promptDateTime("Встреча «" + idea.text + "» на:", todayStr(), "10:00").then(function(result){
      if(!result) return;
      ideas = ideas.filter(function(i){ return i.id !== ideaId; });
      shadow.ideas = shadow.ideas.filter(function(i){ return i.id !== ideaId; });
      softDeleteRow("ideas", ideaId);

      var meeting = {
        id: uid(), date: result.date, time: result.time || "", title: idea.text,
        participants: [], status: "planned", result: "", movedToDate: ""
      };
      meetings.push(meeting);
      persistAll();
      renderIdeas();
      renderCalendar();
      renderAllMeetings();
      flashNewItem(meeting.id);

      showToast("Идея превращена во встречу", meeting.title, function(){
        meetings = meetings.filter(function(x){ return x.id !== meeting.id; });
        shadow.meetings = shadow.meetings.filter(function(x){ return x.id !== meeting.id; });
        softDeleteRow("meetings", meeting.id);
        ideas.splice(Math.min(idx, ideas.length), 0, idea);
        restoreRow("ideas", idea.id);
        persistAll();
        renderIdeas(); renderCalendar(); renderAllMeetings();
      });
    });
  }

  function setupIdeaDrop(container, onDrop){
    container.addEventListener("dragover", function(e){
      if(!e.dataTransfer.types.includes("application/x-idea-id")) return;
      e.preventDefault();
      container.classList.add("drag-over");
    });
    container.addEventListener("dragleave", function(e){
      if(!container.contains(e.relatedTarget)) container.classList.remove("drag-over");
    });
    container.addEventListener("drop", function(e){
      var ideaId = e.dataTransfer.getData("application/x-idea-id");
      if(!ideaId) return;
      e.preventDefault();
      container.classList.remove("drag-over");
      onDrop(ideaId);
    });
  }
  setupIdeaDrop(elListShort, function(ideaId){ convertIdeaToTask(ideaId, "short"); });
  setupIdeaDrop(elListLong, function(ideaId){ convertIdeaToTask(ideaId, "long"); });
  setupIdeaDrop(document.getElementById("meetingsForDay"), convertIdeaToMeeting);

  // ---------- Panel constructor: drag whole panels (Календарь, Встречи,
  // Задачи, Идеи) between and within the three layout zones. Persisted to
  // Supabase (one row per user) so a custom arrangement survives reloads
  // and follows the account across devices, same as everything else here.
  var zoneLeft = document.getElementById("zoneLeft");
  var zoneCenter = document.getElementById("zoneCenter");
  var zoneRight = document.getElementById("zoneRight");
  var allZones = [zoneLeft, zoneCenter, zoneRight];
  var resetLayoutBtn = document.getElementById("resetLayoutBtn");
  var DEFAULT_PANEL_LAYOUT = {
    left: ["calPanel", "meetingsPanel"],
    center: ["mainCol"],
    right: ["ideasPanel"]
  };

  function currentPanelLayout(){
    var layout = {};
    allZones.forEach(function(zone){
      layout[zone.dataset.zone] = Array.prototype.slice.call(zone.children)
        .filter(function(el){ return el.classList.contains("dash-panel"); })
        .map(function(el){ return el.dataset.panelId; });
    });
    return layout;
  }
  function sameLayout(a, b){ return JSON.stringify(a) === JSON.stringify(b); }
  function refreshResetLayoutBtn(){
    resetLayoutBtn.style.display = sameLayout(currentPanelLayout(), DEFAULT_PANEL_LAYOUT) ? "none" : "";
  }
  function applyPanelLayout(layout){
    var zonesByName = { left: zoneLeft, center: zoneCenter, right: zoneRight };
    ["left", "center", "right"].forEach(function(zoneName){
      var zone = zonesByName[zoneName];
      (layout[zoneName] || []).forEach(function(panelId){
        var el = document.getElementById(panelId);
        if(el) zone.appendChild(el);
      });
    });
    refreshResetLayoutBtn();
  }
  function savePanelLayout(){
    var layout = currentPanelLayout();
    refreshResetLayoutBtn();
    updateLayoutColumns();
    if(!db) return;
    // Chained onto syncChain, same reasoning as softDeleteRow()/restoreRow()
    // above — an untracked write here could just as easily be silently
    // dropped by a sign-out that navigates away before it lands.
    syncPendingCount++;
    setSyncStatus("Сохраняю…", false);
    syncChain = syncChain.then(function(){
      return db.from("user_prefs").upsert({ panel_layout: layout, updated_at: new Date().toISOString() });
    }).then(function(res){
      if(res.error) console.error("Save layout error:", res.error);
    }).catch(function(err){
      console.error("Save layout error:", err);
    }).then(function(){
      syncPendingCount = Math.max(0, syncPendingCount - 1);
      setSyncStatus(syncPendingCount ? "Сохраняю…" : "✓ Сохранено", syncPendingCount === 0);
    });
  }
  resetLayoutBtn.addEventListener("click", function(){
    applyPanelLayout(DEFAULT_PANEL_LAYOUT);
    savePanelLayout();
  });

  function getPanelAfterElement(zone, y){
    var els = Array.prototype.slice.call(zone.querySelectorAll(".dash-panel:not(.dragging)"));
    var closest = { offset: -Infinity, element: null };
    els.forEach(function(child){
      var box = child.getBoundingClientRect();
      var offset = y - box.top - box.height / 2;
      if(offset < 0 && offset > closest.offset) closest = { offset: offset, element: child };
    });
    return closest.element;
  }
  function updatePanelDropIndicator(zone, after){
    document.querySelectorAll(".dash-panel.drag-indicator").forEach(function(el){ el.classList.remove("drag-indicator"); });
    allZones.forEach(function(z){ z.classList.remove("drag-indicator-end"); });
    if(after) after.classList.add("drag-indicator");
    else zone.classList.add("drag-indicator-end");
  }
  function clearPanelDropIndicator(){
    document.querySelectorAll(".dash-panel.drag-indicator").forEach(function(el){ el.classList.remove("drag-indicator"); });
    allZones.forEach(function(z){ z.classList.remove("drag-indicator-end", "drag-over"); });
  }
  function setupPanelZoneDrop(zone){
    zone.addEventListener("dragover", function(e){
      if(!e.dataTransfer.types.includes("application/x-panel-id")) return;
      e.preventDefault();
      zone.classList.add("drag-over");
      updatePanelDropIndicator(zone, getPanelAfterElement(zone, e.clientY));
    });
    zone.addEventListener("dragleave", function(e){
      if(!zone.contains(e.relatedTarget)) zone.classList.remove("drag-over");
    });
    zone.addEventListener("drop", function(e){
      var id = e.dataTransfer.getData("application/x-panel-id");
      if(!id) return;
      e.preventDefault();
      clearPanelDropIndicator();
      var panel = document.getElementById(id);
      if(!panel) return;
      var after = getPanelAfterElement(zone, e.clientY);
      if(after) zone.insertBefore(panel, after); else zone.appendChild(panel);
      savePanelLayout();
    });
  }
  allZones.forEach(setupPanelZoneDrop);

  Array.prototype.slice.call(document.querySelectorAll(".dash-drag-handle")).forEach(function(handle){
    var panel = handle.closest(".dash-panel");
    if(!panel) return;
    handle.addEventListener("dragstart", function(e){
      e.dataTransfer.setData("application/x-panel-id", panel.id);
      e.dataTransfer.effectAllowed = "move";
      setTimeout(function(){ panel.classList.add("dragging"); }, 0);
    });
    handle.addEventListener("dragend", function(){
      panel.classList.remove("dragging");
      clearPanelDropIndicator();
    });
  });

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

  function populateSectionSelect(sel, withAllOption, allLabel, withNoneOption){
    var current = sel.value;
    sel.innerHTML = "";
    if(withAllOption){
      var o = document.createElement("option");
      o.value = "all"; o.textContent = allLabel;
      sel.appendChild(o);
    }
    if(withNoneOption){
      var n = document.createElement("option");
      n.value = ""; n.textContent = "Без раздела";
      sel.appendChild(n);
    }
    sections.slice().sort(function(a,b){ return (a.sortOrder||0) - (b.sortOrder||0); }).forEach(function(s){
      var opt = document.createElement("option");
      opt.value = s.id; opt.textContent = s.name;
      sel.appendChild(opt);
    });
    var validValues = sections.map(function(s){ return s.id; });
    if(withAllOption) validValues.push("all");
    if(withNoneOption) validValues.push("");
    if(validValues.indexOf(current) !== -1) sel.value = current;
  }

  function refreshSelectsGlobal(){
    assignees = sanitizeAssigneeList(assignees);
    populateSelect(document.getElementById("filterAssignee"), assignees, true, "Все исполнители");
    populateSelect(document.getElementById("fAssignee"), assignees, false);
    populateSectionSelect(document.getElementById("filterSection"), true, "Все разделы", false);
    populateSectionSelect(document.getElementById("fSection"), false, "", true);
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

  function sectionById(id){
    if(!id) return null;
    return sections.find(function(s){ return s.id === id; }) || null;
  }

  function matchesFilters(t){
    var assignee = document.getElementById("filterAssignee").value;
    var priority = document.getElementById("filterPriority").value;
    var section = document.getElementById("filterSection").value;

    if(assignee !== "all" && t.assignee !== assignee) return false;
    if(priority !== "all" && t.priority !== priority) return false;
    if(section !== "all" && (t.sectionId || "") !== section) return false;
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
    div.draggable = true;
    div.addEventListener("dragstart", function(e){
      e.dataTransfer.setData("application/x-task-id", t.id);
      e.dataTransfer.effectAllowed = "move";
      setTimeout(function(){ div.classList.add("dragging"); }, 0);
    });
    div.addEventListener("dragend", function(){ div.classList.remove("dragging"); });

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

    var section = sectionById(t.sectionId);
    if(section){
      var secPill = document.createElement("span");
      secPill.className = "pill pill-section" + (section.kind === "personal" ? " pill-section-personal" : "");
      secPill.textContent = section.name;
      meta.appendChild(secPill);
    }

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
      // Manual drag order (if the user has ever dragged anything in this
      // column) always wins over the automatic urgency sort below — tasks
      // never manually placed sort after all the ones that have been.
      var am = a.manualOrder != null, bm = b.manualOrder != null;
      if(am && bm) return a.manualOrder - b.manualOrder;
      if(am !== bm) return am ? -1 : 1;

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
  var calPanel = document.getElementById("calPanel");
  var ideasPanel = document.getElementById("ideasPanel");
  var layoutGrid = document.getElementById("layoutGrid");
  var calOpen = true, ideasOpen = true;

  // A zone's column only needs to reserve width while it actually has a
  // visible panel in it — which panel(s) that is can change now that
  // panels can be dragged between zones, so this is computed from the
  // DOM each time rather than assumed fixed (previously the left zone's
  // 300px was hardcoded as "always reserved" because Встречи always lived
  // there; that stopped being guaranteed once panels became rearrangeable).
  function zoneHasVisiblePanel(zone){
    return Array.prototype.some.call(zone.children, function(el){
      return el.classList && el.classList.contains("dash-panel") && el.style.display !== "none";
    });
  }
  function updateLayoutColumns(){
    calPanel.style.display = calOpen ? "" : "none";
    ideasPanel.style.display = ideasOpen ? "" : "none";
    var cols = [
      zoneHasVisiblePanel(zoneLeft) ? "300px" : "0px",
      "1fr",
      zoneHasVisiblePanel(zoneRight) ? "320px" : "0px"
    ];
    layoutGrid.style.gridTemplateColumns = cols.join(" ");
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
    document.getElementById("countIdeas").textContent = visible.length;
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
      row.draggable = true;
      row.addEventListener("dragstart", function(e){
        e.dataTransfer.setData("application/x-idea-id", idea.id);
        e.dataTransfer.effectAllowed = "move";
        setTimeout(function(){ row.classList.add("dragging"); }, 0);
      });
      row.addEventListener("dragend", function(){ row.classList.remove("dragging"); });
      // Custom check (matches the task-list checkbox styling) instead of a
      // native <input type=checkbox>, whose default rendering looked
      // inconsistent with the rest of the app.
      var check = document.createElement("div");
      check.className = "check idea-check" + (idea.done ? " checked" : "");
      check.textContent = idea.done ? "✓" : "";
      check.title = idea.done ? "Вернуть в активные" : "Отметить завершённой";
      check.addEventListener("click", function(e){
        e.stopPropagation();
        idea.done = !idea.done;
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
        // No confirm() dialog here on purpose — undo is faster for the
        // common case, and this was previously one click with NO safety net
        // at all, which is worse.
        var removedAt = ideas.findIndex(function(i){ return i.id === idea.id; });
        var removed = idea;
        ideas = ideas.filter(function(i){ return i.id !== idea.id; });
        shadow.ideas = shadow.ideas.filter(function(i){ return i.id !== idea.id; });
        softDeleteRow("ideas", idea.id);
        renderIdeas();
        showToast("Идея удалена", removed.text.slice(0, 60), function(){
          ideas.splice(Math.min(removedAt, ideas.length), 0, removed);
          restoreRow("ideas", removed.id);
          persistAll(); renderIdeas();
        });
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

        cell.addEventListener("click", function(e){
          e.stopPropagation();
          openDatePopover(cell, ds);
        });

        // Drop target for dragging a meeting chip onto a new date.
        cell.addEventListener("dragover", function(e){
          e.preventDefault();
          cell.classList.add("drag-over");
        });
        cell.addEventListener("dragleave", function(e){
          if(!cell.contains(e.relatedTarget)) cell.classList.remove("drag-over");
        });
        cell.addEventListener("drop", function(e){
          e.preventDefault();
          cell.classList.remove("drag-over");
          var id = e.dataTransfer.getData("text/plain");
          if(!id) return;
          var meeting = meetings.find(function(x){ return x.id === id; });
          if(!meeting) return;
          promptDateTime("Перенести встречу «" + meeting.title + "» на:", ds, meeting.time || "10:00").then(function(result){
            if(!result) return;
            var prevDate = meeting.date, prevTime = meeting.time;
            meeting.date = result.date;
            if(result.time) meeting.time = result.time;
            persistAll();
            renderCalendar();
            renderCalFilterNote();
            renderAllMeetings();
            showToast("Встреча перенесена", meeting.title, function(){
              meeting.date = prevDate; meeting.time = prevTime;
              persistAll(); renderCalendar(); renderCalFilterNote(); renderAllMeetings();
            });
          });
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

  // Клик по дате в календаре предлагает сразу завести задачу или встречу на
  // эту дату, а не фильтрует список (так решили — быстрое создание нужнее).
  var datePopover = document.getElementById("datePopover");
  var datePopoverDate = null;
  function openDatePopover(anchorEl, ds){
    datePopoverDate = ds;
    datePopover.style.display = "flex";
    var rect = anchorEl.getBoundingClientRect();
    var top = rect.bottom + 4;
    var left = Math.max(8, Math.min(rect.left, window.innerWidth - datePopover.offsetWidth - 8));
    if(top + datePopover.offsetHeight > window.innerHeight - 8){
      top = rect.top - datePopover.offsetHeight - 4;
    }
    datePopover.style.top = top + "px";
    datePopover.style.left = left + "px";
  }
  function closeDatePopover(){
    datePopover.style.display = "none";
    datePopoverDate = null;
  }
  document.addEventListener("click", function(e){
    if(datePopover.style.display !== "none" && !datePopover.contains(e.target)) closeDatePopover();
  });
  document.getElementById("datePopoverTaskBtn").addEventListener("click", function(){
    var ds = datePopoverDate;
    closeDatePopover();
    openModal(null, ds);
  });
  document.getElementById("datePopoverMeetingBtn").addEventListener("click", function(){
    var ds = datePopoverDate;
    closeDatePopover();
    openMeetingModal(null, ds);
  });

  function renderAllMeetings(){
    hidePeopleTooltip();
    var mwrap = document.getElementById("meetingsForDay");
    var showResolved = document.getElementById("showDoneCheckbox").checked;
    var sorted = meetings
      .filter(function(m){ return showResolved || !m.status || m.status === "planned"; })
      .sort(function(a,b){
        var ak = (a.date||"") + " " + (a.time||"");
        var bk = (b.date||"") + " " + (b.time||"");
        return ak < bk ? -1 : (ak > bk ? 1 : 0);
      });
    document.getElementById("countMeetings").textContent = sorted.length;
    mwrap.innerHTML = "";
    if(sorted.length === 0){
      var e = document.createElement("div"); e.className = "empty";
      e.textContent = meetings.length === 0 ? "Встреч пока нет" : "Нет запланированных встреч";
      mwrap.appendChild(e);
      return;
    }
    sorted.forEach(function(m){
      var chip = document.createElement("div");
      chip.className = "meeting-chip"
        + (m.date === calendarFilterDate ? " selected-day" : "")
        + (m.status && m.status !== "planned" ? " resolved" : "");
      chip.draggable = true;
      chip.addEventListener("dragstart", function(e){
        e.dataTransfer.setData("text/plain", m.id);
        e.dataTransfer.effectAllowed = "move";
      });
      var left = document.createElement("div");
      // flex-basis:100% forces date/title onto their own full-width row —
      // otherwise, squeezed alongside the delete/quick-action buttons on a
      // narrow screen, the title could be left so little room that
      // word-break:break-word wraps it one character per line.
      left.style.display = "flex"; left.style.minWidth = "0"; left.style.flex = "1 1 100%"; left.style.gap = "8px";
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
          var idx = meetings.findIndex(function(x){ return x.id === m.id; });
          meetings = meetings.filter(function(x){ return x.id !== m.id; });
          shadow.meetings = shadow.meetings.filter(function(x){ return x.id !== m.id; });
          softDeleteRow("meetings", m.id);
          renderCalendar(); renderAllMeetings();
          showToast("Встреча удалена", m.title, function(){
            meetings.splice(Math.min(idx, meetings.length), 0, m);
            restoreRow("meetings", m.id);
            persistAll(); renderCalendar(); renderAllMeetings();
          });
        }
      });
      chip.addEventListener("click", function(){ openMeetingModal(m); });
      chip.appendChild(left);
      if(cleanParticipants.length) chip.appendChild(people);

      if(!m.status || m.status === "planned"){
        var quickActions = document.createElement("div");
        quickActions.className = "meeting-quick-actions";

        var successBtn = document.createElement("button");
        successBtn.className = "meeting-icon-btn success"; successBtn.textContent = "✅"; successBtn.title = "Успешно";
        successBtn.addEventListener("click", function(e){
          e.stopPropagation();
          var prevStatus = m.status;
          m.status = "success";
          persistAll(); renderCalendar(); renderAllMeetings();
          showToast("Встреча отмечена успешной", m.title, function(){
            m.status = prevStatus;
            persistAll(); renderCalendar(); renderAllMeetings();
          });
        });

        var noResultBtn = document.createElement("button");
        noResultBtn.className = "meeting-icon-btn noresult"; noResultBtn.textContent = "🚫"; noResultBtn.title = "Без результата";
        noResultBtn.addEventListener("click", function(e){
          e.stopPropagation();
          var prevStatus = m.status;
          m.status = "no_result";
          persistAll(); renderCalendar(); renderAllMeetings();
          showToast("Встреча отмечена без результата", m.title, function(){
            m.status = prevStatus;
            persistAll(); renderCalendar(); renderAllMeetings();
          });
        });

        var rescheduleQuickBtn = document.createElement("button");
        rescheduleQuickBtn.className = "meeting-icon-btn reschedule"; rescheduleQuickBtn.textContent = "📅"; rescheduleQuickBtn.title = "Перенести";
        rescheduleQuickBtn.addEventListener("click", function(e){
          e.stopPropagation();
          var suggestedDate = addDaysIso(m.date, 1);
          promptDateTime("Перенести встречу «" + m.title + "» на:", suggestedDate, m.time || "10:00").then(function(result){
            if(!result) return;
            var undo = performReschedule(m, result.date, result.time, m.result);
            showToast("Встреча перенесена", m.title, undo);
          });
        });

        quickActions.appendChild(successBtn);
        quickActions.appendChild(noResultBtn);
        quickActions.appendChild(rescheduleQuickBtn);
        chip.appendChild(quickActions);
      }

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
  // Styled date+time confirmation, matching the rest of the UI, instead of
  // the browser's native prompt() (which the calendar drag-to-reschedule
  // and the meeting chip's quick "📅" icon used to rely on).
  var confirmDateTimeOverlay = document.getElementById("confirmDateTimeOverlay");
  var activeDateTimeCancel = null; // lets the Escape handler below close this too
  function promptDateTime(question, defaultDate, defaultTime){
    return new Promise(function(resolve){
      document.getElementById("confirmDateTimeQuestion").textContent = question;
      var dateInput = document.getElementById("confirmDateTimeDate");
      var timeInput = document.getElementById("confirmDateTimeTime");
      dateInput.value = defaultDate || "";
      timeInput.value = defaultTime || "";
      confirmDateTimeOverlay.classList.add("open");

      var okBtn = document.getElementById("confirmDateTimeOkBtn");
      var cancelBtn = document.getElementById("confirmDateTimeCancelBtn");
      function cleanup(){
        confirmDateTimeOverlay.classList.remove("open");
        okBtn.removeEventListener("click", onOk);
        cancelBtn.removeEventListener("click", onCancel);
        confirmDateTimeOverlay.removeEventListener("click", onOverlayClick);
        activeDateTimeCancel = null;
      }
      function onOk(){
        var date = dateInput.value;
        var time = timeInput.value;
        cleanup();
        if(!date){ resolve(null); return; }
        resolve({ date: date, time: time });
      }
      function onCancel(){ cleanup(); resolve(null); }
      function onOverlayClick(e){ if(e.target === confirmDateTimeOverlay) onCancel(); }
      okBtn.addEventListener("click", onOk);
      cancelBtn.addEventListener("click", onCancel);
      confirmDateTimeOverlay.addEventListener("click", onOverlayClick);
      activeDateTimeCancel = onCancel;
    });
  }

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
      // Предлагаем конкретную дату — следующий день после встречи — вместо
      // пустого поля, которое приходилось заполнять вручную.
      document.getElementById("mRescheduleDate").value = addDaysIso(m.date, 1);
      document.getElementById("mRescheduleTime").value = m.time || "10:00";
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
    var prevStatus = m.status, prevResult = m.result, prevMovedToDate = m.movedToDate;
    m.status = status;
    m.result = document.getElementById("mResult").value.trim();
    if(status === "planned") m.movedToDate = "";
    persistAll();
    closeMeetingModal();
    renderCalendar();
    renderAllMeetings();
    showToast(status === "planned" ? "Встреча возвращена в план" : "Итог встречи сохранён", m.title, function(){
      m.status = prevStatus; m.result = prevResult; m.movedToDate = prevMovedToDate;
      persistAll(); renderCalendar(); renderAllMeetings();
    });
  }
  document.getElementById("markSuccessBtn").addEventListener("click", function(){ setMeetingStatus("success"); });
  document.getElementById("markNoResultBtn").addEventListener("click", function(){ setMeetingStatus("no_result"); });
  document.getElementById("reopenMeetingBtn").addEventListener("click", function(){ setMeetingStatus("planned"); });

  // "Перенести следующий этап на дату" — создаёт новую встречу (тот же состав
  // и название) на выбранную дату, а текущую помечает как перенесённую.
  // Общая с иконкой "📅" на карточке встречи (renderAllMeetings) логика.
  // Returns an undo function (used to back a showToast "Отменить" button).
  function performReschedule(m, newDate, newTime, resultNote){
    var prevStatus = m.status, prevResult = m.result, prevMovedToDate = m.movedToDate;
    var followUp = {
      id: uid(),
      date: newDate,
      time: newTime || m.time || "",
      title: m.title,
      participants: m.participants.slice(),
      status: "planned",
      result: "",
      movedToDate: ""
    };
    meetings.push(followUp);

    m.status = "no_result";
    m.result = (resultNote || "").trim() || "Перенесено на следующий этап";
    m.movedToDate = newDate;

    persistAll();
    renderCalendar();
    renderCalFilterNote();
    renderAllMeetings();

    return function undo(){
      meetings = meetings.filter(function(x){ return x.id !== followUp.id; });
      m.status = prevStatus; m.result = prevResult; m.movedToDate = prevMovedToDate;
      persistAll();
      renderCalendar();
      renderCalFilterNote();
      renderAllMeetings();
    };
  }

  document.getElementById("rescheduleBtn").addEventListener("click", function(){
    var id = document.getElementById("meetingId").value;
    if(!id) return;
    var m = meetings.find(function(x){ return x.id === id; });
    if(!m) return;
    var newDate = document.getElementById("mRescheduleDate").value;
    if(!newDate){ alert("Укажите дату следующего этапа"); return; }
    var newTime = document.getElementById("mRescheduleTime").value || m.time || "10:00";
    var undo = performReschedule(m, newDate, newTime, document.getElementById("mResult").value);
    closeMeetingModal();
    showToast("Встреча перенесена", m.title, undo);
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
      var idx = meetings.findIndex(function(x){ return x.id === id; });
      var removed = meetings[idx];
      meetings = meetings.filter(function(x){ return x.id !== id; });
      shadow.meetings = shadow.meetings.filter(function(x){ return x.id !== id; });
      softDeleteRow("meetings", id);
      closeMeetingModal();
      renderCalendar();
      renderCalFilterNote();
      renderAllMeetings();
      showToast("Встреча удалена", removed.title, function(){
        meetings.splice(Math.min(idx, meetings.length), 0, removed);
        restoreRow("meetings", removed.id);
        persistAll(); renderCalendar(); renderCalFilterNote(); renderAllMeetings();
      });
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
    document.getElementById("fSection").value = "";
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

  document.getElementById("addSectionBtn").addEventListener("click", function(){
    var name = prompt("Название нового раздела:");
    if(!name) return;
    name = name.trim();
    if(!name) return;
    var isPersonal = confirm("Это личный раздел (не рабочий)? ОК — личный, Отмена — рабочий.");
    var section = { id: uid(), name: name, kind: isPersonal ? "personal" : "work", sortOrder: sections.length };
    sections.push(section);
    persistAll();
    refreshSelectsGlobal();
    document.getElementById("fSection").value = section.id;
  });

  document.getElementById("removeSectionBtn").addEventListener("click", function(){
    var sel = document.getElementById("fSection");
    var id = sel.value;
    if(!id) return;
    var section = sectionById(id);
    if(!section) return;
    if(confirm("Удалить раздел «" + section.name + "»? Задачи в нём останутся, но без раздела.")){
      sections = sections.filter(function(s){ return s.id !== id; });
      // Clear the reference locally too, so the UI updates immediately
      // instead of waiting on a round trip through Realtime.
      tasks.forEach(function(t){ if(t.sectionId === id) t.sectionId = ""; });
      persistAll();
      refreshSelectsGlobal();
      render();
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

  function openModal(taskId, presetDeadline){
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
      document.getElementById("fSection").value = t.sectionId || "";
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
      if(presetDeadline) document.getElementById("fDeadline").value = presetDeadline;
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
      sectionId: document.getElementById("fSection").value,
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
      var idx = tasks.findIndex(function(x){ return x.id === id; });
      var removed = tasks[idx];
      tasks = tasks.filter(function(x){ return x.id !== id; });
      shadow.tasks = shadow.tasks.filter(function(x){ return x.id !== id; });
      softDeleteRow("tasks", id);
      closeModal();
      render();
      renderCalendar();
      showToast("Задача удалена", removed.title, function(){
        tasks.splice(Math.min(idx, tasks.length), 0, removed);
        restoreRow("tasks", removed.id);
        persistAll(); render(); renderCalendar();
      });
    }
  });

  // ---------- Filters ----------
  ["filterAssignee","filterSection","filterPriority","showDoneCheckbox"].forEach(function(id){
    document.getElementById(id).addEventListener("input", render);
    document.getElementById(id).addEventListener("change", render);
  });
  document.getElementById("showDoneCheckbox").addEventListener("change", renderIdeas);
  document.getElementById("showDoneCheckbox").addEventListener("change", renderAllMeetings);

  // ---------- Notifications ----------
  var toastStack = document.getElementById("toast-stack");
  // undoFn, when passed, adds an "Отменить" button and shortens the
  // auto-dismiss window (an undo offer that lingers 15s is more confusing
  // than useful — the user has either already moved on or already decided).
  function showToast(title, body, undoFn){
    var el = document.createElement("div");
    el.className = "toast";
    var closeBtn = document.createElement("span");
    closeBtn.className = "close"; closeBtn.textContent = "×";
    var b = document.createElement("b"); b.textContent = title;
    el.appendChild(closeBtn);
    el.appendChild(b);
    el.appendChild(document.createTextNode(body));
    if(undoFn){
      var undoBtn = document.createElement("button");
      undoBtn.className = "toast-undo"; undoBtn.textContent = "Отменить";
      undoBtn.addEventListener("click", function(){
        undoFn();
        el.remove();
      });
      el.appendChild(undoBtn);
    }
    closeBtn.addEventListener("click", function(){ el.remove(); });
    toastStack.appendChild(el);
    setTimeout(function(){ if(el.parentNode) el.remove(); }, undoFn ? 6000 : 15000);
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
    if(e.key === "Escape"){
      if(overlay.classList.contains("open")) closeModal();
      if(meetingOverlay.classList.contains("open")) closeMeetingModal();
      if(datePopover.style.display !== "none") closeDatePopover();
      if(activeDateTimeCancel) activeDateTimeCancel();
      return;
    }
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
    var currentUserId = authRes.data.session.user.id;

    var signOutBtn = document.getElementById("signOutBtn");
    if(signOutBtn){
      signOutBtn.addEventListener("click", function(){
        // Wait for every queued write (persistAll's diffAndSync, plus
        // softDeleteRow/restoreRow/savePanelLayout, all chained onto the
        // same syncChain) to actually reach Supabase before navigating.
        // Navigating first was the root cause of "I deleted/completed
        // things, signed out, signed back in, and they were back" — the
        // browser aborts any still-in-flight request on page unload, so an
        // action taken right before clicking "Выйти" could be discarded
        // before it was ever saved.
        signOutBtn.disabled = true;
        setSyncStatus("Сохраняю перед выходом…", false);
        Promise.resolve(syncChain).then(function(){
          return db.auth.signOut();
        }).then(function(){
          window.location.href = "/login";
        }).catch(function(err){
          console.error("Sign out error:", err);
          signOutBtn.disabled = false;
          setSyncStatus("⚠ Не удалось сохранить перед выходом, попробуйте ещё раз", true);
        });
      });
    }

    var telegramLinkBtn = document.getElementById("telegramLinkBtn");
    if(telegramLinkBtn){
      telegramLinkBtn.addEventListener("click", function(){
        fetch("/api/telegram/link-code", { method: "POST" })
          .then(function(r){ return r.json(); })
          .then(function(data){
            if(data.error){ alert("Не получилось: " + data.error); return; }
            var bot = data.botUsername ? "@" + data.botUsername : "боту";
            alert(
              "Откройте в Telegram " + bot + " и отправьте:\n\n" +
              "/start " + data.code + "\n\n" +
              "Код действует 15 минут."
            );
          })
          .catch(function(e){ alert("Не получилось: " + e); });
      });
      // Already linked — no need for this button to sit in the header
      // permanently, it's a one-time setup action.
      db.from("telegram_accounts").select("telegram_chat_id").limit(1).then(function(res){
        if(res.data && res.data.length) telegramLinkBtn.style.display = "none";
      });
    }

    var results;
    try{
      results = await Promise.all([
        db.from("tasks").select("*").is("deleted_at", null),
        db.from("meetings").select("*").is("deleted_at", null),
        db.from("ideas").select("*").is("deleted_at", null).order("created_at", { ascending: true }),
        db.from("assignees").select("*").order("created_at", { ascending: true }),
        db.from("sections").select("*").order("sort_order", { ascending: true })
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
    sections = results[4].data.map(sectionFromRow);

    // Best-effort, not part of the critical Promise.all above — a missing
    // migration or a hiccup loading saved panel positions shouldn't block
    // the rest of the app from booting, it should just fall back to the
    // default layout.
    try{
      var prefsRes = await db.from("user_prefs").select("panel_layout").maybeSingle();
      applyPanelLayout((prefsRes.data && prefsRes.data.panel_layout) || DEFAULT_PANEL_LAYOUT);
    }catch(e){
      console.error("Load panel layout error:", e);
      applyPanelLayout(DEFAULT_PANEL_LAYOUT);
    }

    // Baseline "already in the database" snapshot — taken before any of the
    // startup reconciliation below, so persistAll() only pushes what's new.
    shadow = { tasks: snapshotList(tasks), meetings: snapshotList(meetings), ideas: snapshotList(ideas), assignees: assignees.slice(), sections: snapshotList(sections) };

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
    checkSyncErrors();
    setupRealtime(currentUserId);
  }

  // Surfaces sync failures that happened in a *previous* session (the toast
  // at the time is long gone once a tab is closed) — a dismissable banner
  // listing how many, and the most recent message.
  function checkSyncErrors(){
    db.from("sync_errors").select("id, message, created_at").eq("acknowledged", false)
      .order("created_at", { ascending: false }).limit(20)
      .then(function(res){
        if(res.error || !res.data || !res.data.length) return;
        var banner = document.getElementById("syncErrorBanner");
        var ids = res.data.map(function(r){ return r.id; });
        var latest = res.data[0];
        banner.innerHTML = "";
        var text = document.createElement("span");
        text.textContent = "⚠ Не всё сохранилось в облако (" + res.data.length + "): " + latest.message;
        var dismiss = document.createElement("button");
        dismiss.className = "btn btn-small"; dismiss.textContent = "Скрыть"; dismiss.style.marginLeft = "10px";
        dismiss.addEventListener("click", function(){
          banner.classList.remove("show");
          db.from("sync_errors").update({ acknowledged: true }).in("id", ids);
        });
        banner.appendChild(text); banner.appendChild(dismiss);
        banner.style.display = "flex";
        banner.classList.add("show");
      })
      .catch(function(){});
  }

  // ---------- Bridge for the quick-add bar (separate React component) ----------
  // Reuses the exact same fields/status defaults and save/render calls as the
  // manual "+ Новая задача"/"+" forms, so quick-added items behave identically.
  window.trackerAPI = {
    getAssignees: function(){ return assignees.slice(); },
    // Opens the real "new task" modal pre-filled with Claude's guess, so the
    // user reviews/fixes fields in the exact same UI as manual entry, then
    // saves or cancels with the modal's own buttons.
    prefillNewTask: function(f){
      resetForm();
      refreshSelectsGlobal();
      document.getElementById("fTitle").value = f.title || "";
      document.getElementById("fDesc").value = f.description || "";
      if (f.assignee) document.getElementById("fAssignee").value = f.assignee;
      document.getElementById("fPriority").value = f.priority === "high" ? "high" : "med";
      document.getElementById("fTerm").value = f.term === "long" ? "long" : "short";
      document.getElementById("fDeadline").value = f.deadline || "";
      overlay.classList.add("open");
    },
    prefillNewMeeting: function(f){
      openMeetingModal(null, f.date || todayStr());
      document.getElementById("mTitle").value = f.title || "";
      if (f.time) document.getElementById("mTime").value = f.time;
      var wanted = sanitizeAssigneeList(f.participants || []);
      Array.prototype.forEach.call(document.querySelectorAll("#mParticipants input"), function(cb){
        cb.checked = wanted.indexOf(cb.value) !== -1;
      });
      updateParticipantsTriggerLabel();
    },
    createTask: function(f){
      var task = {
        id: uid(),
        title: f.title,
        desc: f.description || "",
        assignee: f.assignee || "",
        priority: f.priority === "high" ? "high" : "med",
        term: f.term === "long" ? "long" : "short",
        status: "in_progress",
        deadline: f.deadline || "",
        recur: "none",
        recurWeekday: "1",
        recurMonthday: "",
        recurYearDay: "",
        recurYearMonth: "1",
        lastCompletedOn: ""
      };
      tasks.push(task);
      persistAll();
      render();
      return task;
    },
    createMeeting: function(f){
      var meeting = {
        id: uid(),
        date: f.date,
        time: f.time || "",
        title: f.title,
        participants: sanitizeAssigneeList(f.participants || []),
        status: "planned",
        result: "",
        movedToDate: ""
      };
      meetings.push(meeting);
      persistAll();
      renderCalendar();
      renderAllMeetings();
      return meeting;
    },
    createIdea: function(f){
      var d = new Date();
      var idea = {
        id: uid(),
        text: f.text,
        important: !!f.important,
        done: false,
        createdAt: pad(d.getDate()) + "." + pad(d.getMonth()+1) + "." + d.getFullYear() + " " + pad(d.getHours()) + ":" + pad(d.getMinutes())
      };
      ideas.push(idea);
      persistAll();
      renderIdeas();
      return idea;
    }
  };

  boot();

})();
